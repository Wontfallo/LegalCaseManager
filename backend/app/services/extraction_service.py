"""
ExtractionService – AI-Driven Chronology Extraction (The Intelligence Layer).

Core function: extract_timeline_events(text_payload, timestamp_context, case_id, source_id)

Uses the active LLM provider (GitHub Copilot, Gemini, OpenAI, Mistral, LM Studio, Ollama)
via the llm_provider abstraction to:
1. Identify distinct actions, events, deadlines, and historical facts.
2. Resolve relative dates using the provided timestamp_context.
3. Return a strict JSON array with absolute_date, description, and confidence.
4. Populate the TimelineEventModel with linked_source_id.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.document import Document
from app.models.timeline_event import TimelineEvent
from app.services.llm_provider import chat_completion, get_active_chat_provider

logger = get_logger("extraction_service")


# ── LLM Response Schema ─────────────────────────────────
class ExtractedEvent(BaseModel):
    """Schema for a single event extracted by the LLM."""

    absolute_date: str = Field(
        ...,
        description="ISO 8601 formatted date or datetime string.",
    )
    description: str = Field(
        ...,
        description="Concise description of the event.",
        min_length=1,
        max_length=2000,
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0.",
    )

    @field_validator("absolute_date")
    @classmethod
    def validate_iso_date(cls, v: str) -> str:
        """Ensure the date string is parseable as ISO 8601."""
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            # Try common date formats
            for fmt in (
                "%Y-%m-%d",
                "%m/%d/%Y",
                "%d/%m/%Y",
                "%B %d, %Y",
                "%Y-%m-%dT%H:%M:%S",
            ):
                try:
                    datetime.strptime(v, fmt)
                    return v
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse date: {v}")
        return v


# ── System Prompt ────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert legal analyst. Review the provided text. Identify any distinct actions, events, deadlines, or historical facts. You must resolve any relative dates (e.g., 'next Tuesday') using the provided timestamp_context. Return your analysis EXCLUSIVELY as a valid JSON array of objects, where each object contains exactly three keys: absolute_date (ISO 8601 format), description (concise string), and confidence (float between 0.0 and 1.0).

Rules:
- Output ONLY the JSON array. No markdown, no explanations, no code fences.
- If no events are found, return an empty array: []
- Dates must be in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
- Confidence of 1.0 = explicitly stated date. 0.5-0.9 = inferred/resolved date. Below 0.5 = uncertain.
- Each event description must be self-contained and understandable without the source text.
- Limit to the 50 most important events if the text contains many."""


def _build_user_prompt(text_payload: str, timestamp_context: str | None) -> str:
    """Build the user message for the LLM."""
    context_line = ""
    if timestamp_context:
        context_line = f"\n\nTimestamp context (use this to resolve relative dates): {timestamp_context}"

    return f"""Analyze the following text and extract all chronological events:{context_line}

---BEGIN TEXT---
{text_payload}
---END TEXT---"""


# ── LLM API Call ─────────────────────────────────────────
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
)
async def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """
    Call the active LLM provider for timeline extraction.
    Uses the unified llm_provider abstraction.
    Returns the raw response text.
    """
    provider = get_active_chat_provider()
    if provider is None:
        logger.warning("no_llm_provider_configured")
        return "[]"

    provider_type, config = provider
    logger.info(
        "extraction_using_provider",
        provider=provider_type.value,
        model=config.chat_model,
    )

    return await chat_completion(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.1,
        max_tokens=4096,
        json_mode=True,
    )


def _parse_llm_response(raw_response: str) -> list[ExtractedEvent]:
    """
    Parse the raw LLM response into validated ExtractedEvent objects.
    Handles various response formats (raw JSON, markdown-wrapped, etc.).
    """
    # Strip markdown code fences if present
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        # Remove opening and closing fences
        lines = cleaned.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    # Try to parse as JSON
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find a JSON array within the text
        import re

        array_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if array_match:
            try:
                parsed = json.loads(array_match.group())
            except json.JSONDecodeError:
                logger.error(
                    "llm_response_json_parse_failed",
                    raw_response=cleaned[:500],
                )
                return []
        else:
            logger.error(
                "llm_response_no_json_found",
                raw_response=cleaned[:500],
            )
            return []

    # Handle both {"events": [...]} and [...] formats
    if isinstance(parsed, dict):
        # Look for an array value in the dict
        for key in ("events", "timeline", "data", "results"):
            if key in parsed and isinstance(parsed[key], list):
                parsed = parsed[key]
                break
        else:
            # If dict has the three expected keys, treat as single event
            if "absolute_date" in parsed:
                parsed = [parsed]
            else:
                logger.warning(
                    "llm_response_unexpected_format", keys=list(parsed.keys())
                )
                return []

    if not isinstance(parsed, list):
        logger.warning("llm_response_not_a_list", type=type(parsed).__name__)
        return []

    # Validate each event
    events: list[ExtractedEvent] = []
    for i, item in enumerate(parsed):
        try:
            event = ExtractedEvent.model_validate(item)
            events.append(event)
        except Exception as exc:
            logger.warning(
                "event_validation_failed",
                index=i,
                item=str(item)[:200],
                error=str(exc),
            )

    logger.info("events_parsed", valid_count=len(events), total_items=len(parsed))
    return events


def _parse_date_to_datetime(date_str: str) -> datetime:
    """Convert a date string to a timezone-aware datetime."""
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y"):
            try:
                dt = datetime.strptime(date_str, fmt)
                break
            except ValueError:
                continue
        else:
            dt = datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ── Main Extraction Function ────────────────────────────
async def extract_timeline_events(
    text_payload: str,
    timestamp_context: str | None,
    case_id: uuid.UUID,
    source_id: uuid.UUID,
    source_type: str = "document",
) -> list[uuid.UUID]:
    """
    Extract timeline events from a text payload using the LLM.

    Args:
        text_payload: The raw text to analyze.
        timestamp_context: ISO 8601 timestamp for resolving relative dates.
        case_id: UUID of the associated case.
        source_id: UUID of the originating Document or Communication.
        source_type: "document" or "communication".

    Returns:
        List of newly created TimelineEvent UUIDs.
    """
    if not text_payload or not text_payload.strip():
        logger.info("empty_text_payload_skipped", source_id=str(source_id))
        return []

    logger.info(
        "extraction_started",
        case_id=str(case_id),
        source_id=str(source_id),
        source_type=source_type,
        text_length=len(text_payload),
    )

    # Build prompt and call LLM
    user_prompt = _build_user_prompt(text_payload, timestamp_context)
    raw_response = await _call_llm(SYSTEM_PROMPT, user_prompt)

    # Parse response
    events = _parse_llm_response(raw_response)
    if not events:
        logger.info("no_events_extracted", source_id=str(source_id))
        return []

    # Persist events to database
    created_ids: list[uuid.UUID] = []
    async with async_session_factory() as session:
        try:
            for event in events:
                abs_dt = _parse_date_to_datetime(event.absolute_date)

                timeline_event = TimelineEvent(
                    case_id=case_id,
                    absolute_timestamp=abs_dt,
                    event_description=event.description,
                    ai_confidence_score=event.confidence,
                    source_type=source_type,
                    linked_document_id=source_id if source_type == "document" else None,
                    linked_communication_id=source_id
                    if source_type == "communication"
                    else None,
                )
                session.add(timeline_event)
                await session.flush()
                created_ids.append(timeline_event.id)

            await session.commit()
            logger.info(
                "timeline_events_created",
                case_id=str(case_id),
                source_id=str(source_id),
                events_count=len(created_ids),
            )

        except Exception as exc:
            await session.rollback()
            logger.error(
                "timeline_event_persist_failed",
                case_id=str(case_id),
                source_id=str(source_id),
                error=str(exc),
            )
            raise

    return created_ids


# ── Document Summarization ──────────────────────────────
SUMMARY_SYSTEM_PROMPT = """You are a highly intelligent legal document summarization AI.

You MUST return your response as valid JSON with exactly two keys:
- "title": A concise, intelligent document title (max 80 chars). Describe WHAT the document is, WHO it involves, and WHEN (include the date). Examples:
  - "Gerald Jackson Letter to Board Re: Meeting Minutes Access - Sept 9, 2024"
  - "Chestnut Cambronne Collection Notice - $2,847.50 Past Due - Aug 15, 2023"
  - "Annual Board Meeting Minutes - March 12, 2024"
  - "Homeowner Ledger - Gerald Jackson Unit 204 - Jan-Dec 2023"
  - "Engineering Inspection Report - Balcony Replacement Phase 2 - Oct 2023"
  Do NOT use the filename. Derive a meaningful title from the document content.
- "summary": A thorough, useful summary (300-600 words). You MUST include:
  1. The document date (exact date it was written, sent, or signed — this is critical for filing)
  2. The parties involved (full names, roles, organizations)
  3. The main subject and purpose of the document
  4. All key facts, dollar amounts, deadlines, decisions, or actions described
  5. Any legal significance, demands, violations, or consequences mentioned
  Be specific and factual. Write in clear prose. Do not be vague.

Return ONLY valid JSON. No markdown, no code fences, no extra text."""

VISION_SUMMARY_PROMPT = """You are an expert legal analyst examining an image from a legal case file.

You MUST return your response as valid JSON with exactly two keys:
- "title": A concise, intelligent title for this image (max 80 chars). Describe what the image shows. Examples:
  - "Property Damage Photo - Water Stain on Unit 204 Ceiling"
  - "USPS Certified Mail Receipt - Tracking #9407"
  - "Handwritten Note - Board Meeting Attendance List"
- "summary": A detailed description of the image. Focus on:
  - What the image depicts (photo, diagram, handwritten note, receipt, property damage, etc.)
  - Any visible text, labels, dates, or numbers
  - People, objects, locations, or conditions shown
  - Anything legally relevant (evidence of damage, signatures, stamps, markings)
  Write exactly ONE paragraph, 3-8 sentences. Be specific and factual.

Return ONLY valid JSON. No markdown, no code fences, no extra text."""

# Minimum chars of meaningful OCR text to consider a document "text-heavy"
_MIN_TEXT_FOR_OCR_SUMMARY = 200


def _parse_title_summary_response(raw: str) -> tuple[str | None, str | None]:
    """Parse an LLM response expecting JSON with 'title' and 'summary' keys.
    Falls back gracefully if the response is plain text."""
    import re as _re

    cleaned = raw.strip()
    # Strip markdown code fences
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    # Try JSON parse
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed.get("title"), parsed.get("summary")
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        obj_match = _re.search(r"\{.*\}", cleaned, _re.DOTALL)
        if obj_match:
            try:
                parsed = json.loads(obj_match.group())
                if isinstance(parsed, dict):
                    return parsed.get("title"), parsed.get("summary")
            except json.JSONDecodeError:
                pass

    # Fallback: treat entire response as summary, no title
    return None, cleaned if cleaned else None


async def summarize_document(
    text_payload: str,
    document_id: uuid.UUID,
    image_path: str | None = None,
    file_type: str | None = None,
) -> str | None:
    """
    Generate an AI title and summary of a document and persist both.

    For text-heavy documents (substantial OCR output), summarizes the text.
    For images with sparse text, uses the vision model to describe the image.

    Args:
        text_payload: The raw OCR text to summarize.
        document_id: UUID of the document to update.
        image_path: Path to the original file on disk (used for vision).
        file_type: File type ("pdf", "png", "jpg", etc.).

    Returns:
        The generated summary string, or None if summarization failed.
    """
    provider = get_active_chat_provider()
    if provider is None:
        logger.warning("summarize_no_provider", document_id=str(document_id))
        return None

    provider_type, config = provider

    clean_text = (text_payload or "").strip()
    is_image_file = file_type in ("png", "jpg", "jpeg", "tiff", "tif", "bmp")
    use_vision = (
        is_image_file and image_path and len(clean_text) < _MIN_TEXT_FOR_OCR_SUMMARY
    )

    if not use_vision and not clean_text:
        logger.info("summarize_empty_text_skipped", document_id=str(document_id))
        return None

    logger.info(
        "summarize_started",
        document_id=str(document_id),
        provider=provider_type.value,
        text_length=len(clean_text),
        mode="vision" if use_vision else "text",
    )

    try:
        if use_vision:
            # Vision-based summary — send the image to the model
            assert image_path is not None  # guaranteed by use_vision check above
            ocr_hint = ""
            if clean_text:
                ocr_hint = f"\n\nOCR detected the following partial text in the image:\n{clean_text[:2000]}"
            user_prompt = f"Describe and summarize the contents of this image from a legal case file. Return JSON with title and summary.{ocr_hint}"

            img_paths: list[str] = [image_path]
            raw_response = await chat_completion(
                system_prompt=VISION_SUMMARY_PROMPT,
                user_prompt=user_prompt,
                temperature=0.3,
                max_tokens=8192,
                json_mode=True,
                image_paths=img_paths,
            )
        else:
            # Text-based summary — standard OCR text summarization
            user_prompt = f"""Generate a JSON object with "title" and "summary" for this document.

---BEGIN DOCUMENT---
{clean_text}
---END DOCUMENT---"""

            raw_response = await chat_completion(
                system_prompt=SUMMARY_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.2,
                max_tokens=8192,
                json_mode=True,
            )

        display_title, summary = _parse_title_summary_response(raw_response)

        if not summary:
            logger.warning("summarize_empty_response", document_id=str(document_id))
            return None

        summary = summary.strip()
        if display_title:
            display_title = display_title.strip()[:512]

        # Persist title + summary to database
        async with async_session_factory() as session:
            result = await session.execute(
                select(Document).where(Document.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                doc.summary = summary
                if display_title:
                    doc.display_title = display_title
                await session.commit()
                logger.info(
                    "summary_persisted",
                    document_id=str(document_id),
                    summary_length=len(summary),
                    display_title=display_title,
                )
            else:
                logger.error(
                    "summarize_document_not_found",
                    document_id=str(document_id),
                )

        return summary

    except Exception as exc:
        logger.error(
            "summarize_failed",
            document_id=str(document_id),
            error=str(exc),
        )
        return None
