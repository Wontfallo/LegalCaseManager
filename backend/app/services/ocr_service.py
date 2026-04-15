"""
OCR Service – processes documents via Tesseract (local) or Mistral OCR API (complex).

This service runs as a background task after document upload. It:
1. Analyses document complexity (page count, image density).
2. Routes to Tesseract (simple) or Mistral OCR (complex tables/forms).
3. Persists the extracted text back to the DocumentModel.
4. Triggers downstream vectorization and timeline extraction.
"""

from __future__ import annotations

import uuid
from io import BytesIO
from pathlib import Path
import shutil
import hashlib
import re

import asyncio
import httpx
from PIL import Image
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.document import DocStatus, Document
from sqlalchemy import select

logger = get_logger("ocr_service")


def _compute_text_fingerprint(text: str) -> str | None:
    normalized = text.lower()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9 ]", "", normalized)
    normalized = normalized.strip()
    if len(normalized) < 100:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


# ── Complexity Heuristic ─────────────────────────────────
COMPLEX_PAGE_THRESHOLD = 3
"""If a PDF has more pages than this, we consider it 'complex' and prefer Mistral."""


def _estimate_page_count(file_path: str, file_type: str) -> int:
    """Estimate the page count of a document."""
    if file_type == "pdf":
        try:
            from pdf2image import pdfinfo_from_path

            info = pdfinfo_from_path(file_path)
            return info.get("Pages", 1)
        except Exception:
            logger.warning("pdfinfo_failed", file_path=file_path)
            return 1
    # Images are always 1 page
    return 1


def _is_complex_document(file_path: str, file_type: str, page_count: int) -> bool:
    """
    Determine if a document is 'complex' (tables, forms, multi-page).
    Complex documents are routed to Mistral OCR for better accuracy.
    """
    if page_count > COMPLEX_PAGE_THRESHOLD:
        return True
    if file_type == "pdf" and page_count > 1:
        return True
    return False


# ── Tesseract OCR (local fallback) ──────────────────────
def _configure_tesseract() -> None:
    """Point pytesseract at the Windows install path when it is not on PATH."""
    import pytesseract

    if shutil.which("tesseract"):
        return

    windows_candidates = [
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in windows_candidates:
        if candidate.exists():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
            logger.info("tesseract_path_configured", path=str(candidate))
            return


def _run_tesseract(file_path: str, file_type: str) -> str:
    """
    Execute local Tesseract OCR.
    For PDFs, converts each page to an image first using pdf2image.
    """
    import pytesseract

    _configure_tesseract()

    text_parts: list[str] = []

    try:
        if file_type == "pdf":
            from pdf2image import convert_from_path

            images = convert_from_path(file_path, dpi=300)
            for i, img in enumerate(images):
                page_text = pytesseract.image_to_string(img, lang="eng")
                text_parts.append(f"--- Page {i + 1} ---\n{page_text}")
                logger.debug("tesseract_page_complete", page=i + 1)
        else:
            img = Image.open(file_path)
            page_text = pytesseract.image_to_string(img, lang="eng")
            text_parts.append(page_text)

    except Exception as exc:
        logger.error("tesseract_ocr_failed", file_path=file_path, error=str(exc))
        raise

    full_text = "\n\n".join(text_parts).strip()
    logger.info(
        "tesseract_ocr_complete",
        file_path=file_path,
        chars_extracted=len(full_text),
    )
    return full_text


# ── Mistral OCR API (complex documents) ─────────────────
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
)
async def _run_mistral_ocr(file_path: str, file_type: str) -> str:
    """
    Send a document to the Mistral OCR API for structured extraction.
    Returns structured markdown with table preservation.
    """
    if not settings.mistral_api_key:
        logger.warning("mistral_api_key_not_set", detail="falling back to tesseract")
        return await asyncio.to_thread(_run_tesseract, file_path, file_type)

    file_bytes = Path(file_path).read_bytes()

    # Determine MIME type
    mime_map = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
    }
    mime_type = mime_map.get(file_type, "application/octet-stream")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            # Upload the file for OCR processing
            import base64

            encoded_file = base64.b64encode(file_bytes).decode("utf-8")

            response = await client.post(
                settings.mistral_ocr_endpoint,
                headers={
                    "Authorization": f"Bearer {settings.mistral_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "mistral-ocr-latest",
                    "document": {
                        "type": "base64",
                        "data": encoded_file,
                        "mime_type": mime_type,
                    },
                },
            )
            response.raise_for_status()
            result = response.json()

            # Extract text from Mistral response pages
            pages = result.get("pages", [])
            text_parts: list[str] = []
            for i, page in enumerate(pages):
                page_md = page.get("markdown", page.get("text", ""))
                text_parts.append(f"--- Page {i + 1} ---\n{page_md}")

            full_text = "\n\n".join(text_parts).strip()
            logger.info(
                "mistral_ocr_complete",
                file_path=file_path,
                pages=len(pages),
                chars_extracted=len(full_text),
            )
            return full_text

    except httpx.HTTPStatusError as exc:
        logger.error(
            "mistral_ocr_http_error",
            status=exc.response.status_code,
            detail=exc.response.text[:500],
        )
        raise
    except Exception as exc:
        logger.error("mistral_ocr_error", error=str(exc))
        raise


# ── Main Orchestrator ────────────────────────────────────
async def _set_document_status(
    document_id: uuid.UUID,
    status: DocStatus,
    message: str | None = None,
    **extra_fields: object,
) -> None:
    """Update document status and optional fields in the database."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if doc is None:
            logger.error("document_not_found", document_id=str(document_id))
            return
        doc.status = status.value
        doc.status_message = message
        for field, value in extra_fields.items():
            setattr(doc, field, value)
        await session.commit()


async def process_document_ocr(
    document_id: uuid.UUID,
    file_path: str,
    file_type: str,
    case_id: uuid.UUID,
) -> None:
    """
    Background task: OCR a document and persist results.
    Triggers vectorization + timeline extraction upon completion.
    """
    logger.info(
        "ocr_processing_started",
        document_id=str(document_id),
        file_type=file_type,
    )

    # Mark as processing
    await _set_document_status(document_id, DocStatus.PROCESSING, "OCR in progress...")

    page_count = _estimate_page_count(file_path, file_type)
    is_complex = _is_complex_document(file_path, file_type, page_count)
    ocr_method: str = "tesseract"
    extracted_text: str = ""

    try:
        if is_complex and settings.mistral_api_key:
            ocr_method = "mistral"
            extracted_text = await _run_mistral_ocr(file_path, file_type)
        else:
            ocr_method = "tesseract"
            extracted_text = await asyncio.to_thread(
                _run_tesseract, file_path, file_type
            )
    except Exception as exc:
        # If Mistral fails, fall back to Tesseract
        if ocr_method == "mistral":
            logger.warning(
                "mistral_fallback_to_tesseract",
                document_id=str(document_id),
                error=str(exc),
            )
            try:
                ocr_method = "tesseract"
                extracted_text = await asyncio.to_thread(
                    _run_tesseract, file_path, file_type
                )
            except Exception as inner_exc:
                error_msg = f"OCR failed: {inner_exc}"
                if (
                    "tesseract" in str(inner_exc).lower()
                    or "not installed" in str(inner_exc).lower()
                ):
                    error_msg = (
                        "Tesseract OCR is not installed. "
                        "Install from: https://github.com/UB-Mannheim/tesseract/wiki"
                    )
                logger.error(
                    "ocr_complete_failure",
                    document_id=str(document_id),
                    error=str(inner_exc),
                )
                await _set_document_status(document_id, DocStatus.FAILED, error_msg)
                return
        else:
            error_msg = f"OCR failed: {exc}"
            if "tesseract" in str(exc).lower() or "not installed" in str(exc).lower():
                error_msg = (
                    "Tesseract OCR is not installed. "
                    "Install from: https://github.com/UB-Mannheim/tesseract/wiki"
                )
            logger.error(
                "ocr_complete_failure",
                document_id=str(document_id),
                error=str(exc),
            )
            await _set_document_status(document_id, DocStatus.FAILED, error_msg)
            return

    # Persist OCR results to database
    async with async_session_factory() as session:
        try:
            result = await session.execute(
                select(Document).where(Document.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if doc is None:
                logger.error(
                    "document_not_found_after_ocr", document_id=str(document_id)
                )
                return

            doc.raw_ocr_text = extracted_text
            doc.ocr_method = ocr_method
            doc.page_count = page_count
            doc.text_fingerprint = _compute_text_fingerprint(extracted_text)
            doc.status = DocStatus.PROCESSING.value
            doc.status_message = "OCR complete. Running vectorization..."

            await session.commit()
            logger.info(
                "ocr_results_persisted",
                document_id=str(document_id),
                method=ocr_method,
                text_length=len(extracted_text),
            )
        except Exception as exc:
            await session.rollback()
            logger.error(
                "ocr_persist_failed",
                document_id=str(document_id),
                error=str(exc),
            )
            await _set_document_status(
                document_id, DocStatus.FAILED, f"Failed to save OCR results: {exc}"
            )
            return

    # Trigger downstream: vectorization + summarization + timeline extraction
    status_notes: list[str] = []
    try:
        from app.services.vectorization_service import vectorize_text
        from app.services.extraction_service import (
            extract_timeline_events,
            summarize_document,
        )
        from app.services.llm_provider import (
            get_active_chat_provider,
            get_active_embedding_provider,
        )

        if extracted_text.strip():
            await vectorize_text(
                text=extracted_text,
                source_id=str(document_id),
                source_type="document",
                case_id=str(case_id),
            )

            # Mark as vectorized
            async with async_session_factory() as session:
                result = await session.execute(
                    select(Document).where(Document.id == document_id)
                )
                doc = result.scalar_one_or_none()
                if doc:
                    doc.is_vectorized = True
                    await session.commit()

            embed_provider = get_active_embedding_provider()
            if not embed_provider:
                status_notes.append(
                    "Indexed with basic embeddings (configure a provider for semantic search)."
                )

        # AI-powered features — require active chat provider
        # For images with sparse OCR, vision summarization still runs
        is_image_file = file_type in ("png", "jpg", "jpeg", "tiff", "tif", "bmp")
        chat_provider = get_active_chat_provider()
        if chat_provider:
            provider_name = chat_provider[0].value

            # Document summarization (text-based or vision-based)
            summary = await summarize_document(
                text_payload=extracted_text,
                document_id=document_id,
                image_path=file_path if is_image_file else None,
                file_type=file_type,
            )
            if summary:
                status_notes.append(f"Summary generated via {provider_name}.")
            else:
                status_notes.append("Summary generation returned empty result.")

            # Timeline extraction (only if there's text)
            if extracted_text.strip():
                status_notes.append(f"Timeline extraction via {provider_name}.")
                await extract_timeline_events(
                    text_payload=extracted_text,
                    timestamp_context=None,
                    case_id=case_id,
                    source_id=document_id,
                    source_type="document",
                )
        else:
            status_notes.append(
                "AI features skipped (configure a provider to enable summaries and timeline extraction)."
            )
    except Exception as exc:
        logger.error(
            "post_ocr_pipeline_error",
            document_id=str(document_id),
            error=str(exc),
        )
        status_notes.append(f"Post-OCR pipeline warning: {exc}")

    # Mark as completed
    final_message = "OCR completed successfully."
    if status_notes:
        final_message += " " + " ".join(status_notes)

    await _set_document_status(document_id, DocStatus.COMPLETED, final_message)
