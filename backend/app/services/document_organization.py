from __future__ import annotations

import json
import re
import uuid
from typing import Any

from app.core.logging import get_logger
from app.models.document import Document
from app.schemas.documents import DocumentSectionSuggestion
from app.services.llm_provider import chat_completion, get_active_chat_provider

logger = get_logger("document_organization")

SECTION_NAMES = [
    "Governing Documents",
    "Board Meetings Agenda & Minutes",
    "Contracts",
    "Letters from Lawfirm",
    "Reports and Bids",
    "Emails (Lefky Law Firm)",
    "Emails",
    "Receipts USPS",
    "Correspondence",
    "Financials",
    "Photos and Evidence",
    "General",
]


def _contains_phrase(text: str, phrase: str) -> bool:
    escaped = re.escape(phrase)
    pattern = escaped.replace(r"\ ", r"\s+")
    return re.search(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", text) is not None


def _contains_any_phrase(text: str, phrases: list[str]) -> bool:
    return any(_contains_phrase(text, phrase) for phrase in phrases)


def strip_markdown_code_fences(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def parse_llm_json(raw: str, default: Any) -> Any:
    cleaned = strip_markdown_code_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        object_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if object_match:
            try:
                return json.loads(object_match.group())
            except json.JSONDecodeError:
                pass
        array_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if array_match:
            try:
                return json.loads(array_match.group())
            except json.JSONDecodeError:
                pass
    return default


def infer_section_label(
    filename: str | None,
    summary: str | None,
    raw_text: str | None,
) -> str:
    name = (filename or "").lower()
    text = ((summary or "") + "\n" + (raw_text or "")).lower()
    haystack = f"{name}\n{text}"

    if any(word in name for word in ["meeting minutes", "board meeting", "agenda", "annual meeting", "special meeting"]):
        return "Board Meetings Agenda & Minutes"

    if any(word in name for word in ["proposal", "bid", "estimate", "project update", "reserve study", "engineering report"]):
        return "Reports and Bids"

    if any(word in name for word in ["notice", "inspection", "balcony notice"]) and any(
        word in haystack for word in ["balcony", "engineering", "inspection", "unsafe", "repair recommendations"]
    ):
        return "Reports and Bids"

    if any(
        word in name
        for word in [
            "management agreement",
            "service agreement",
            "retainer",
            "engagement letter",
            "scope of work",
            "contract",
        ]
    ):
        return "Contracts"

    if any(
        word in name
        for word in [
            "account ledger",
            "ledger",
            "financial",
            "budget",
            "statement",
            "invoice",
            "assessment",
            "check",
        ]
    ):
        return "Financials"

    if any(word in name for word in ["usps", "tracking", "certified mail", "postal service"]):
        return "Receipts USPS"

    if any(word in name for word in ["email", "mail "]):
        if any(word in haystack for word in ["lefky", "barbara lefky", "barbera lefky", "lefky law"]):
            return "Emails (Lefky Law Firm)"
        return "Emails"

    if any(word in name for word in ["letter to hoa", "formal dispute", "reply to", "follow up to", "copy of letter sent"]):
        return "Correspondence"

    if any(word in name for word in ["chestnut", "cambronne", "lefky", "attorney", "counsel"]):
        if any(word in haystack for word in ["letter", "notice", "demand", "collection", "hearing", "fine", "violation", "response"]):
            return "Letters from Lawfirm"

    if any(word in name for word in ["engineering report", "reserve study", "inspection", "project update", "bid", "estimate"]):
        return "Reports and Bids"

    if any(word in name for word in ["by-laws", "bylaws", "declaration", "amendment", "rules and regulations", "articles of incorporation"]):
        return "Governing Documents"

    if any(word in name for word in ["photo", "screenshot", "street view", ".jpg", ".jpeg", ".png", "damage", "pipe"]):
        return "Photos and Evidence"

    if any(word in haystack for word in ["attorney general", "condominium and townhome associations"]):
        return "General"

    if any(
        word in haystack
        for word in ["usps", "certified mail", "tracking number", "postage", "return receipt requested", "united states postal service"]
    ):
        return "Receipts USPS"

    if _contains_any_phrase(
        haystack,
        [
            "retainer",
            "engagement letter",
            "scope of work",
            "contract",
            "management agreement",
            "service agreement",
        ],
    ):
        return "Contracts"

    if any(
        word in haystack
        for word in [
            "chestnut cambronne",
            "lefky law",
            "barbara lefky",
            "barbera lefky",
            "gretchen schellhas",
            "attorneys at law",
            "attorney",
            "counsel",
            "esq",
            "esquire",
        ]
    ) and any(
        word in haystack
        for word in ["letter", "notice", "demand", "collection", "hearing", "fine", "violation", "response"]
    ):
        return "Letters from Lawfirm"

    if any(word in haystack for word in ["board meeting", "meeting minutes", "agenda", "annual meeting", "special meeting"]):
        return "Board Meetings Agenda & Minutes"

    if any(word in haystack for word in ["email", "e-mail", "from:", "subject:"]) and "ledger" not in haystack and "statement" not in haystack:
        if any(word in haystack for word in ["lefky", "barbara lefky", "barbera lefky", "lefky law"]):
            return "Emails (Lefky Law Firm)"
        return "Emails"

    if any(
        word in haystack
        for word in [
            "gerald jackson",
            "formal dispute",
            "request for records",
            "dear board",
            "dear lisa",
            "dear barbara",
            "i am writing",
            "reply to lefky",
            "follow up to gassen",
            "letter to hoa",
        ]
    ) and any(word in haystack for word in ["letter", "request", "dispute", "response", "follow up", "notice"]):
        return "Correspondence"

    if any(
        word in haystack
        for word in [
            "homeowner ledger",
            "account ledger",
            "financial report",
            "budget",
            "statement date",
            "statement",
            "invoice",
            "charges",
            "payment",
            "assessment",
            "check",
            "legal copy of your check",
            "balance sheet",
            "income statement",
            "cash flow",
        ]
    ):
        return "Financials"

    if any(
        word in haystack
        for word in [
            "engineering",
            "reserve study",
            "inspection",
            "report",
            "bid",
            "estimate",
            "proposal",
            "project update",
            "consultants",
            "balcony replacement project",
        ]
    ):
        return "Reports and Bids"

    if any(
        word in haystack
        for word in [
            "by-law",
            "bylaws",
            "declaration",
            "first amendment",
            "second amendment",
            "rules and regulations",
            "articles of incorporation",
            "articles",
        ]
    ):
        return "Governing Documents"

    if any(
        word in haystack
        for word in ["photo", "image", "screenshot", "street view", ".jpg", ".jpeg", ".png", "damage", "repaired", "pipe burst"]
    ):
        return "Photos and Evidence"

    return "General"


def coerce_section_label(
    suggested: str | None,
    filename: str | None,
    summary: str | None,
    raw_text: str | None,
) -> str:
    normalized = (suggested or "").strip()
    
    # If the LLM gave us a valid section name, TRUST IT.
    # The rules-based inference is a fallback for when the LLM is missing or hallucinations.
    if normalized in SECTION_NAMES:
        return normalized
        
    # Fallback to rules-based inference
    return infer_section_label(filename, summary, raw_text)


def _extract_document_date(doc: Document) -> str | None:
    """Try to extract the most likely document date from filename, summary, or OCR text.
    Returns an ISO date string or None."""
    import re
    from datetime import datetime as _dt

    # Patterns to try, ordered by specificity
    date_patterns = [
        # ISO: 2024-09-09
        (r"\b(\d{4}-\d{2}-\d{2})\b", "%Y-%m-%d"),
        # US: September 9, 2024 / Sept 9, 2024
        (r"\b((?:January|February|March|April|May|June|July|August|September|October|November|December|"
         r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4})\b", None),
        # US numeric: 09/09/2024 or 9/9/2024
        (r"\b(\d{1,2}/\d{1,2}/\d{4})\b", "%m/%d/%Y"),
        # US numeric short year: 09/09/24
        (r"\b(\d{1,2}/\d{1,2}/\d{2})\b", "%m/%d/%y"),
    ]

    # Search in summary first (most likely to have a clean date), then filename, then first 2000 chars of OCR
    search_texts = [
        doc.summary or "",
        doc.original_filename or "",
        (doc.raw_ocr_text or "")[:2000],
    ]

    for text in search_texts:
        if not text.strip():
            continue
        for pattern, fmt in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                raw_date = match.group(1)
                try:
                    if fmt:
                        parsed = _dt.strptime(raw_date, fmt)
                    else:
                        # Handle month name formats
                        # Normalize abbreviations
                        cleaned = raw_date.replace("Sept", "Sep").replace(".", "")
                        for try_fmt in ("%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y"):
                            try:
                                parsed = _dt.strptime(cleaned, try_fmt)
                                break
                            except ValueError:
                                continue
                        else:
                            continue
                    return parsed.strftime("%Y-%m-%d")
                except ValueError:
                    continue
    return None


def _sort_within_sections(
    applied: list[DocumentSectionSuggestion],
    doc_by_id: dict[str, Document],
) -> list[DocumentSectionSuggestion]:
    """Re-sort documents chronologically within each section group.
    Uses extracted document dates, falling back to created_at (upload time)."""
    from datetime import datetime as _dt, timezone

    # Group by section
    sections: dict[str, list[DocumentSectionSuggestion]] = {}
    for item in applied:
        sections.setdefault(item.section_label, []).append(item)

    # Sort each section chronologically
    def _sort_key(item: DocumentSectionSuggestion) -> str:
        doc = doc_by_id.get(str(item.document_id))
        if doc is None:
            return "9999-99-99"
        extracted = _extract_document_date(doc)
        if extracted:
            return extracted
        # Fallback: use upload date
        return doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "9999-99-99"

    result: list[DocumentSectionSuggestion] = []
    for section_name in sorted(sections.keys(), key=str.lower):
        items = sections[section_name]
        items.sort(key=_sort_key)
        for order, item in enumerate(items):
            item.sort_order = order
            # Also update the actual Document model
            doc = doc_by_id.get(str(item.document_id))
            if doc:
                doc.sort_order = order
            result.append(item)

    return result


async def organize_documents_with_ai(
    case_id: uuid.UUID,
    documents: list[Document],
) -> list[DocumentSectionSuggestion]:
    if not documents:
        return []

    by_id = {str(doc.id): doc for doc in documents}

    if get_active_chat_provider() is None:
        applied = []
        for index, doc in enumerate(documents):
            section = infer_section_label(doc.original_filename, doc.summary, doc.raw_ocr_text)
            doc.section_label = section
            doc.sort_order = index
            applied.append(
                DocumentSectionSuggestion(
                    document_id=doc.id,
                    section_label=section,
                    sort_order=index,
                    reason="Rules-based organization",
                )
            )
        # Re-sort chronologically within each section
        return _sort_within_sections(applied, by_id)

    payload = [
        {
            "document_id": str(doc.id),
            "filename": doc.original_filename,
            "summary": doc.summary,
            "excerpt": (doc.raw_ocr_text or "")[:800],
            "uploaded_at": doc.created_at.isoformat() if doc.created_at else None,
        }
        for doc in documents
    ]

    system_prompt = (
        "You are an assistant organizing legal case documents into review folders. "
        "Return JSON only as an array of objects with keys: document_id, section_label, document_date, sort_order, reason. "
        "You MUST classify every document_id. Use only these exact section_label values: "
        + ", ".join(SECTION_NAMES)
        + ".\n\n"
        "Rules:\n"
        "- Governing Documents only for bylaws, declarations, amendments, articles, rules and regulations.\n"
        "- Board Meetings Agenda & Minutes only for agendas, meeting notices, and minutes.\n"
        "- Contracts includes management agreements and service agreements.\n"
        "- Letters from Lawfirm is for legal letters or notices from attorneys or law firms.\n"
        "- Emails (Lefky Law Firm) is only for emails involving Barbara Lefky or Lefky Law Firm.\n"
        "- Correspondence is for letters written by Gerald Jackson or the homeowner/client.\n"
        "- Financials is for ledgers, statements, budgets, invoices, checks, assessments, and HOA financial reports.\n"
        "- Reports and Bids is for engineering reports, reserve studies, inspections, estimates, and project updates.\n"
        "- Photos and Evidence is for photos, screenshots, and visual evidence.\n"
        "- Attorney General informational guides should be General.\n"
        "- document_date: Extract the actual document date (when it was written/created, NOT when it was uploaded). "
        "Use ISO 8601 format (YYYY-MM-DD). If unknown, use null.\n"
        "- sort_order: Within each section, documents MUST be sorted in chronological order (oldest first). "
        "sort_order is a zero-based integer PER SECTION, not case-wide. "
        "The oldest document in a section gets sort_order 0, the next oldest gets 1, etc.\n"
        "- An email ABOUT meeting minutes is Correspondence or Emails, not Board Meetings Agenda & Minutes. "
        "Only actual minutes documents belong in Board Meetings Agenda & Minutes."
    )

    default_suggestions = [
        {
            "document_id": str(doc.id),
            "section_label": infer_section_label(doc.original_filename, doc.summary, doc.raw_ocr_text),
            "sort_order": index,
            "reason": "Rules-based organization",
        }
        for index, doc in enumerate(documents)
    ]

    try:
        response = await chat_completion(
            system_prompt=system_prompt,
            user_prompt=f"Organize these {len(payload)} documents:\n{json.dumps(payload)}",
            temperature=0.1,
            max_tokens=16000,
        )
        suggestions_raw = parse_llm_json(response, default_suggestions)
        if isinstance(suggestions_raw, dict):
            for key in ("documents", "suggestions", "results"):
                value = suggestions_raw.get(key)
                if isinstance(value, list):
                    suggestions_raw = value
                    break
            else:
                suggestions_raw = default_suggestions
    except Exception as exc:
        logger.warning("ai_document_organize_failed", case_id=str(case_id), error=str(exc))
        suggestions_raw = default_suggestions

    applied: list[DocumentSectionSuggestion] = []
    seen: set[str] = set()

    for index, item in enumerate(suggestions_raw):
        doc = by_id.get(str(item.get("document_id")))
        if doc is None:
            continue
        section = coerce_section_label(
            str(item.get("section_label") or "").strip(),
            doc.original_filename,
            doc.summary,
            doc.raw_ocr_text,
        )
        sort_order = item.get("sort_order")
        if not isinstance(sort_order, int) or sort_order < 0:
            sort_order = index
        reason = item.get("reason") or "AI-assisted organization"
        doc.section_label = section
        doc.sort_order = sort_order
        applied.append(
            DocumentSectionSuggestion(
                document_id=doc.id,
                section_label=section,
                sort_order=sort_order,
                reason=str(reason),
            )
        )
        seen.add(str(doc.id))

    for index, doc in enumerate(documents):
        if str(doc.id) in seen:
            continue
        section = infer_section_label(doc.original_filename, doc.summary, doc.raw_ocr_text)
        doc.section_label = section
        doc.sort_order = index
        applied.append(
            DocumentSectionSuggestion(
                document_id=doc.id,
                section_label=section,
                sort_order=index,
                reason="Filled missing result with rules-based organization",
            )
        )

    # Post-process: re-sort chronologically within each section regardless of
    # what the LLM returned, using extracted document dates
    return _sort_within_sections(applied, by_id)
