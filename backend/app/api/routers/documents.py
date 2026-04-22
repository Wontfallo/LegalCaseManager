"""
Document upload and ingestion router.
Handles file upload, storage, and background OCR processing.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.deps import CurrentUser, DBSession, require_case_access
from app.core.logging import get_logger
from app.models.document import DocStatus, Document
from app.models.timeline_event import TimelineEvent
from app.schemas.documents import (
    DuplicateCleanupRequest,
    DuplicateCleanupResponse,
    AIDocumentOrganizationResponse,
    DocumentOrganizationRequest,
    DocumentOrganizationResponse,
    DocumentOrganizationUpdate,
    DocumentResponse,
    DocumentUploadResponse,
    DocumentSectionSuggestion,
    DuplicateCandidate,
    DuplicateGroup,
    DuplicateScanResponse,
)
from app.services.llm_provider import chat_completion, get_active_chat_provider
from app.services.ocr_service import process_document_ocr
from app.services.vectorization_service import delete_vectors_by_source
from sqlalchemy import delete, select

from app.services.document_organization import (
    infer_section_label,
    organize_documents_with_ai,
)

logger = get_logger("documents_router")
router = APIRouter(prefix="/api", tags=["Documents"])

ALLOWED_FILE_TYPES = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
}


def _compute_file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _normalize_text_for_fingerprint(text: str) -> str:
    normalized = text.lower()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9 ]", "", normalized)
    return normalized.strip()


def _compute_text_fingerprint(text: str) -> str | None:
    normalized = _normalize_text_for_fingerprint(text)
    if len(normalized) < 100:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _text_similarity_ratio(left: str, right: str) -> float:
    """Jaccard similarity on tokenized text."""
    left_tokens = set(_normalize_text_for_fingerprint(left).split())
    right_tokens = set(_normalize_text_for_fingerprint(right).split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = left_tokens & right_tokens
    union = left_tokens | right_tokens
    return len(overlap) / len(union)


def _text_containment_ratio(left: str, right: str) -> float:
    """Check if the smaller document's text is contained within the larger.
    Returns the fraction of the smaller doc's tokens found in the larger doc.
    Handles partial OCR where one scan captures less text than another."""
    left_tokens = set(_normalize_text_for_fingerprint(left).split())
    right_tokens = set(_normalize_text_for_fingerprint(right).split())
    if not left_tokens or not right_tokens:
        return 0.0
    smaller, larger = (
        (left_tokens, right_tokens)
        if len(left_tokens) <= len(right_tokens)
        else (right_tokens, left_tokens)
    )
    if len(smaller) < 20:
        return 0.0
    overlap = smaller & larger
    return len(overlap) / len(smaller)


def _filename_similarity_ratio(left: str | None, right: str | None) -> float:
    left_tokens = set(_normalize_text_for_fingerprint(left or "").split())
    right_tokens = set(_normalize_text_for_fingerprint(right or "").split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = left_tokens & right_tokens
    union = left_tokens | right_tokens
    return len(overlap) / len(union)


def _default_section_label(doc: Document) -> str:
    return infer_section_label(doc.original_filename, doc.summary, doc.raw_ocr_text)


async def _delete_document_record(db: DBSession, doc: Document) -> None:
    full_path = settings.upload_path / Path(doc.storage_uri)

    await db.execute(
        delete(TimelineEvent).where(TimelineEvent.linked_document_id == doc.id)
    )
    await db.delete(doc)
    await db.flush()

    try:
        delete_vectors_by_source(str(doc.id))
    except Exception:
        logger.warning("document_vector_cleanup_failed", document_id=str(doc.id))

    try:
        if full_path.exists():
            full_path.unlink()
    except OSError as exc:
        logger.warning(
            "document_file_delete_failed",
            document_id=str(doc.id),
            path=str(full_path),
            error=str(exc),
        )


@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    case_id: uuid.UUID,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> DocumentUploadResponse:
    """
    Upload a document (PDF or image) for OCR processing.
    The file is saved to secure storage and a background task is launched
    to perform OCR (Tesseract for simple files, Mistral for complex).
    """
    await require_case_access(case_id, user, db)

    # Validate file type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {content_type}. Allowed: {list(ALLOWED_FILE_TYPES.keys())}",
        )

    # Validate file size
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {settings.max_upload_size_mb}MB.",
        )

    file_hash = _compute_file_hash(content)

    existing_result = await db.execute(
        select(Document).where(
            Document.case_id == case_id,
            Document.file_hash == file_hash,
        )
    )
    existing_doc = existing_result.scalar_one_or_none()
    if existing_doc is not None:
        logger.info(
            "duplicate_upload_blocked",
            case_id=str(case_id),
            existing_document_id=str(existing_doc.id),
            filename=file.filename,
        )
        return DocumentUploadResponse(
            id=existing_doc.id,
            message="This exact file already exists in the case. Upload skipped.",
            processing=False,
            duplicate=True,
        )

    # Generate unique storage path
    file_ext = ALLOWED_FILE_TYPES[content_type]
    file_id = uuid.uuid4()
    relative_path = f"{case_id}/{file_id}.{file_ext}"
    storage_path = settings.upload_path / str(case_id)
    storage_path.mkdir(parents=True, exist_ok=True)
    full_path = storage_path / f"{file_id}.{file_ext}"

    # Write file to disk (simulating AES-256 encrypted storage)
    try:
        async with aiofiles.open(full_path, "wb") as f:
            await f.write(content)
        logger.info(
            "file_saved",
            path=str(full_path),
            size_bytes=len(content),
            case_id=str(case_id),
        )
    except OSError as exc:
        logger.error("file_save_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file.",
        )

    # Create DB record
    document = Document(
        case_id=case_id,
        storage_uri=relative_path,
        file_type=file_ext,
        original_filename=file.filename,
        file_hash=file_hash,
        status=DocStatus.PENDING.value,
        status_message="Queued for OCR processing.",
        raw_ocr_text=None,
        ocr_method=None,
        page_count=None,
        is_vectorized=False,
    )
    db.add(document)
    await db.flush()
    await db.refresh(document)
    await db.commit()

    # Enqueue background OCR processing
    background_tasks.add_task(
        process_document_ocr,
        document_id=document.id,
        file_path=str(full_path),
        file_type=file_ext,
        case_id=case_id,
    )

    logger.info(
        "document_ocr_enqueued",
        document_id=str(document.id),
        case_id=str(case_id),
    )

    return DocumentUploadResponse(
        id=document.id,
        message="Document uploaded successfully. OCR processing started.",
        processing=True,
        duplicate=False,
    )


@router.get(
    "/cases/{case_id}/documents",
    response_model=list[DocumentResponse],
)
async def list_documents(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
    skip: int = 0,
    limit: int = 1000,
) -> list[DocumentResponse]:
    """List all documents for a given case (with RBAC check)."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(Document)
        .where(Document.case_id == case_id)
        .order_by(
            Document.section_label.asc().nullsfirst(),
            Document.sort_order.asc(),
            Document.created_at.desc(),
        )
        .offset(skip)
        .limit(limit)
    )
    return [DocumentResponse.model_validate(d) for d in result.scalars().all()]


@router.post(
    "/cases/{case_id}/documents/organize",
    response_model=DocumentOrganizationResponse,
)
async def update_document_organization(
    case_id: uuid.UUID,
    body: DocumentOrganizationRequest,
    db: DBSession,
    user: CurrentUser,
) -> DocumentOrganizationResponse:
    """Persist manual document section labels and ordering."""
    await require_case_access(case_id, user, db)
    if body.case_id != case_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Case ID mismatch.")

    requested_ids = [item.document_id for item in body.documents]
    documents = (
        (
            await db.execute(
                select(Document).where(
                    Document.case_id == case_id,
                    Document.id.in_(requested_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {doc.id: doc for doc in documents}

    if len(by_id) != len(set(requested_ids)):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="One or more documents were not found in this case.",
        )

    for item in body.documents:
        doc = by_id[item.document_id]
        doc.section_label = item.section_label.strip() if item.section_label else None
        doc.sort_order = item.sort_order

    await db.flush()

    return DocumentOrganizationResponse(
        case_id=case_id,
        documents=[
            DocumentOrganizationUpdate(
                document_id=item.document_id,
                section_label=by_id[item.document_id].section_label,
                sort_order=by_id[item.document_id].sort_order,
            )
            for item in body.documents
        ],
    )


@router.post(
    "/cases/{case_id}/documents/organize/ai",
    response_model=AIDocumentOrganizationResponse,
)
async def ai_organize_documents(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> AIDocumentOrganizationResponse:
    """Use the active chat provider to suggest and apply document organization."""
    await require_case_access(case_id, user, db)

    documents = (
        (
            await db.execute(
                select(Document)
                .where(Document.case_id == case_id)
                .order_by(Document.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    if not documents:
        return AIDocumentOrganizationResponse(case_id=case_id, documents=[])
    applied = await organize_documents_with_ai(case_id=case_id, documents=documents)
    await db.flush()
    applied.sort(key=lambda item: (item.section_label.lower(), item.sort_order))
    return AIDocumentOrganizationResponse(case_id=case_id, documents=applied)


@router.get(
    "/cases/{case_id}/documents/duplicates",
    response_model=DuplicateScanResponse,
)
async def scan_case_document_duplicates(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> DuplicateScanResponse:
    """Scan a case for likely duplicate documents."""
    await require_case_access(case_id, user, db)

    documents = (
        (
            await db.execute(
                select(Document)
                .where(Document.case_id == case_id)
                .order_by(Document.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    groups: list[DuplicateGroup] = []
    seen_pairs: set[tuple[str, str]] = set()

    by_file_hash: dict[str, list[Document]] = {}
    by_fingerprint: dict[str, list[Document]] = {}

    for doc in documents:
        if doc.file_hash:
            by_file_hash.setdefault(doc.file_hash, []).append(doc)
        if doc.text_fingerprint:
            by_fingerprint.setdefault(doc.text_fingerprint, []).append(doc)

    for matching_docs in by_file_hash.values():
        if len(matching_docs) < 2:
            continue
        groups.append(
            DuplicateGroup(
                reason="Exact same uploaded file",
                documents=[
                    DuplicateCandidate(
                        document_id=doc.id,
                        original_filename=doc.original_filename,
                        status=doc.status,
                        created_at=doc.created_at,
                        match_type="file_hash",
                        confidence=1.0,
                    )
                    for doc in matching_docs
                ],
            )
        )
        for doc in matching_docs:
            seen_pairs.add((str(doc.id), str(doc.id)))

    for matching_docs in by_fingerprint.values():
        if len(matching_docs) < 2:
            continue
        groups.append(
            DuplicateGroup(
                reason="OCR text matches another document",
                documents=[
                    DuplicateCandidate(
                        document_id=doc.id,
                        original_filename=doc.original_filename,
                        status=doc.status,
                        created_at=doc.created_at,
                        match_type="text_fingerprint",
                        confidence=0.98,
                    )
                    for doc in matching_docs
                ],
            )
        )

    completed_docs = [
        doc
        for doc in documents
        if doc.raw_ocr_text and doc.status == DocStatus.COMPLETED.value
    ]
    for index, left in enumerate(completed_docs):
        for right in completed_docs[index + 1 :]:
            pair_key = tuple(sorted((str(left.id), str(right.id))))
            if pair_key in seen_pairs:
                continue

            left_text = left.raw_ocr_text or ""
            right_text = right.raw_ocr_text or ""

            # Jaccard similarity
            similarity = _text_similarity_ratio(left_text, right_text)
            if similarity >= 0.75:
                groups.append(
                    DuplicateGroup(
                        reason="Very similar OCR text",
                        documents=[
                            DuplicateCandidate(
                                document_id=left.id,
                                original_filename=left.original_filename,
                                status=left.status,
                                created_at=left.created_at,
                                match_type="similar_text",
                                confidence=similarity,
                            ),
                            DuplicateCandidate(
                                document_id=right.id,
                                original_filename=right.original_filename,
                                status=right.status,
                                created_at=right.created_at,
                                match_type="similar_text",
                                confidence=similarity,
                            ),
                        ],
                    )
                )
                seen_pairs.add(pair_key)
                continue

            # Containment check: one doc's text may be a subset of the other
            # (e.g. partial OCR on scanned images vs full text from pre-OCR'd PDF)
            containment = _text_containment_ratio(left_text, right_text)
            if containment >= 0.80:
                groups.append(
                    DuplicateGroup(
                        reason="One document's text is largely contained in the other (likely same document, different OCR quality)",
                        documents=[
                            DuplicateCandidate(
                                document_id=left.id,
                                original_filename=left.original_filename,
                                status=left.status,
                                created_at=left.created_at,
                                match_type="text_containment",
                                confidence=containment,
                            ),
                            DuplicateCandidate(
                                document_id=right.id,
                                original_filename=right.original_filename,
                                status=right.status,
                                created_at=right.created_at,
                                match_type="text_containment",
                                confidence=containment,
                            ),
                        ],
                    )
                )
                seen_pairs.add(pair_key)

    for index, left in enumerate(documents):
        for right in documents[index + 1 :]:
            pair_key = tuple(sorted((str(left.id), str(right.id))))
            if pair_key in seen_pairs:
                continue
            filename_similarity = _filename_similarity_ratio(
                left.original_filename,
                right.original_filename,
            )
            if filename_similarity < 0.7:
                continue
            groups.append(
                DuplicateGroup(
                    reason="Similar filenames",
                    documents=[
                        DuplicateCandidate(
                            document_id=left.id,
                            original_filename=left.original_filename,
                            status=left.status,
                            created_at=left.created_at,
                            match_type="similar_filename",
                            confidence=filename_similarity,
                        ),
                        DuplicateCandidate(
                            document_id=right.id,
                            original_filename=right.original_filename,
                            status=right.status,
                            created_at=right.created_at,
                            match_type="similar_filename",
                            confidence=filename_similarity,
                        ),
                    ],
                )
            )
            seen_pairs.add(pair_key)

    return DuplicateScanResponse(case_id=case_id, duplicate_groups=groups)


@router.get(
    "/documents/{document_id}",
    response_model=DocumentResponse,
)
async def get_document(
    document_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> DocumentResponse:
    """Get a single document by ID (with RBAC check via case)."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await require_case_access(doc.case_id, user, db)
    return DocumentResponse.model_validate(doc)


@router.get("/documents/{document_id}/file")
async def get_original_document_file(
    document_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> FileResponse:
    """Serve the original uploaded document file."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await require_case_access(doc.case_id, user, db)

    full_path = settings.upload_path / Path(doc.storage_uri)
    if not full_path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Original uploaded file is missing from storage.",
        )

    media_type_map = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpeg": "image/jpeg",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
    }
    filename = doc.original_filename or full_path.name
    return FileResponse(
        path=full_path,
        media_type=media_type_map.get(doc.file_type, "application/octet-stream"),
        filename=filename,
    )


@router.post(
    "/documents/duplicates/cleanup",
    response_model=DuplicateCleanupResponse,
)
async def cleanup_duplicate_documents(
    body: DuplicateCleanupRequest,
    db: DBSession,
    user: CurrentUser,
) -> DuplicateCleanupResponse:
    """Delete selected duplicate documents, optionally keeping one document."""
    await require_case_access(body.case_id, user, db)

    requested_ids = {doc_id for doc_id in body.document_ids}
    if body.keep_document_id is not None:
        requested_ids.add(body.keep_document_id)

    documents = (
        (
            await db.execute(
                select(Document).where(
                    Document.case_id == body.case_id,
                    Document.id.in_(requested_ids),
                )
            )
        )
        .scalars()
        .all()
    )

    found_ids = {doc.id for doc in documents}
    missing_ids = requested_ids - found_ids
    if missing_ids:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Documents not found in this case: {[str(doc_id) for doc_id in missing_ids]}",
        )

    deleted_ids: list[uuid.UUID] = []
    for doc in documents:
        if body.keep_document_id is not None and doc.id == body.keep_document_id:
            continue
        if doc.id not in body.document_ids:
            continue
        await _delete_document_record(db, doc)
        deleted_ids.append(doc.id)

    logger.info(
        "duplicate_cleanup_completed",
        case_id=str(body.case_id),
        kept_document_id=str(body.keep_document_id) if body.keep_document_id else None,
        deleted_count=len(deleted_ids),
    )
    return DuplicateCleanupResponse(
        deleted_document_ids=deleted_ids,
        kept_document_id=body.keep_document_id,
    )


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> None:
    """Delete a document record and its uploaded file."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await require_case_access(doc.case_id, user, db)
    storage_uri = doc.storage_uri
    await _delete_document_record(db, doc)

    logger.info(
        "document_deleted",
        document_id=str(document_id),
        case_id=str(doc.case_id),
        storage_uri=storage_uri,
    )


@router.post(
    "/documents/{document_id}/retry",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_document_ocr(
    document_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> DocumentUploadResponse:
    """Retry OCR processing for an existing document."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await require_case_access(doc.case_id, user, db)

    full_path = settings.upload_path / Path(doc.storage_uri)
    if not full_path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Uploaded file is missing from storage.",
        )

    await db.execute(
        delete(TimelineEvent).where(TimelineEvent.linked_document_id == document_id)
    )
    delete_vectors_by_source(str(document_id))

    doc.status = DocStatus.PENDING.value
    doc.status_message = "Queued for OCR retry processing."
    doc.raw_ocr_text = None
    doc.ocr_method = None
    doc.page_count = None
    doc.is_vectorized = False
    doc.summary = None
    await db.commit()

    background_tasks.add_task(
        process_document_ocr,
        document_id=doc.id,
        file_path=str(full_path),
        file_type=doc.file_type,
        case_id=doc.case_id,
    )

    logger.info(
        "document_ocr_requeued",
        document_id=str(document_id),
        case_id=str(doc.case_id),
    )

    return DocumentUploadResponse(
        id=doc.id,
        message="Document queued for OCR retry.",
        processing=True,
    )


# ── Re-Summarize Endpoints ──────────────────────────────


@router.post(
    "/documents/{document_id}/resummarize",
    status_code=status.HTTP_200_OK,
)
async def resummarize_document(
    document_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> dict:
    """Re-run AI summarization on a single document using its existing OCR text (or vision for images)."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found.")
    await require_case_access(doc.case_id, user, db)

    if doc.status != DocStatus.COMPLETED.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Document must be in 'completed' status to re-summarize. Run OCR first.",
        )

    from app.services.extraction_service import summarize_document as _summarize

    full_path = settings.upload_path / Path(doc.storage_uri)
    is_image = doc.file_type in ("png", "jpg", "jpeg", "tiff", "tif", "bmp")

    summary = await _summarize(
        text_payload=doc.raw_ocr_text or "",
        document_id=doc.id,
        image_path=str(full_path) if is_image and full_path.exists() else None,
        file_type=doc.file_type,
    )

    # Refresh to pick up the display_title that was set during summarization
    await db.refresh(doc)

    return {
        "document_id": str(doc.id),
        "summary": summary,
        "display_title": doc.display_title,
        "status": "updated" if summary else "no_summary",
    }


@router.post(
    "/cases/{case_id}/documents/resummarize-all",
    status_code=status.HTTP_200_OK,
)
async def resummarize_all_documents(
    case_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> dict:
    """Queue AI re-summarization for all completed documents in a case."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(Document).where(
            Document.case_id == case_id,
            Document.status == DocStatus.COMPLETED.value,
        )
    )
    docs = result.scalars().all()
    if not docs:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="No completed documents found to re-summarize.",
        )

    for doc in docs:
        doc.status = DocStatus.PROCESSING.value
        doc.status_message = "Queued for AI summarization."
    await db.commit()

    async def _run_all() -> None:
        from app.services.extraction_service import summarize_document as _summarize
        from app.services.document_organization import _sort_within_sections
        from app.schemas.documents import DocumentSectionSuggestion as _DSS
        from app.core.database import async_session_factory
        from sqlalchemy import select

        for doc in docs:
            try:
                full_path = settings.upload_path / Path(doc.storage_uri)
                is_image = doc.file_type in ("png", "jpg", "jpeg", "tiff", "tif", "bmp")
                await _summarize(
                    text_payload=doc.raw_ocr_text or "",
                    document_id=doc.id,
                    image_path=str(full_path)
                    if is_image and full_path.exists()
                    else None,
                    file_type=doc.file_type,
                )
            except Exception as exc:
                logger.error(
                    "resummarize_single_failed",
                    document_id=str(doc.id),
                    error=str(exc),
                )
            finally:
                async with async_session_factory() as session:
                    res = await session.execute(
                        select(Document).where(Document.id == doc.id)
                    )
                    d = res.scalar_one_or_none()
                    if d:
                        d.status = DocStatus.COMPLETED.value
                        d.status_message = "Summary updated."
                        await session.commit()

        # Re-sort all docs chronologically within their sections now that
        # summaries contain reliable dates for _extract_document_date to use.
        try:
            async with async_session_factory() as resort_session:
                resort_result = await resort_session.execute(
                    select(Document).where(Document.case_id == case_id)
                )
                all_docs = list(resort_result.scalars().all())
                if all_docs:
                    doc_by_id = {str(d.id): d for d in all_docs}
                    suggestions = [
                        _DSS(
                            document_id=d.id,
                            section_label=d.section_label or "General",
                            sort_order=d.sort_order,
                            reason="post-resummarize date re-sort",
                        )
                        for d in all_docs
                    ]
                    _sort_within_sections(suggestions, doc_by_id)
                    await resort_session.flush()
                    await resort_session.commit()
                    logger.info(
                        "post_resummarize_resort_done",
                        case_id=str(case_id),
                        doc_count=len(all_docs),
                    )
        except Exception as exc:
            logger.warning(
                "post_resummarize_resort_failed", case_id=str(case_id), error=str(exc)
            )

    background_tasks.add_task(_run_all)

    return {
        "message": f"Re-summarization queued for {len(docs)} document(s).",
        "document_count": len(docs),
    }


@router.post(
    "/cases/{case_id}/documents/backup-to-drive",
    status_code=status.HTTP_200_OK,
)
async def backup_documents_to_drive(
    case_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> dict:
    """Queue all documents in a case for backup to Google Drive."""
    from app.services.google_service import google_service

    await require_case_access(case_id, user, db)

    # Check if Google is connected
    creds = await google_service.get_credentials(user.id)
    if not creds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account not connected. Please connect via Integrations settings.",
        )

    result = await db.execute(select(Document).where(Document.case_id == case_id))
    docs = result.scalars().all()

    if not docs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found to backup.",
        )

    async def _run_backup():
        for doc in docs:
            full_path = settings.upload_path / Path(doc.storage_uri)
            if full_path.exists():
                await google_service.backup_document(
                    user.id, str(full_path), doc.original_filename
                )

    background_tasks.add_task(_run_backup)

    return {
        "message": f"Backup to Google Drive started for {len(docs)} document(s).",
        "document_count": len(docs),
    }


@router.post(
    "/cases/{case_id}/documents/reocr-all",
    status_code=status.HTTP_200_OK,
)
async def reocr_all_documents(
    case_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> dict:
    """Queue full OCR reprocessing for all documents in a case (OCR + summarize + timeline)."""
    await require_case_access(case_id, user, db)

    result = await db.execute(select(Document).where(Document.case_id == case_id))
    docs = result.scalars().all()
    if not docs:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="No documents found in this case.",
        )

    queued = 0
    for doc in docs:
        full_path = settings.upload_path / Path(doc.storage_uri)
        if not full_path.exists():
            continue

        # Clear existing derived data
        await db.execute(
            delete(TimelineEvent).where(TimelineEvent.linked_document_id == doc.id)
        )
        delete_vectors_by_source(str(doc.id))

        doc.status = DocStatus.PENDING.value
        doc.status_message = "Queued for OCR reprocessing."
        doc.raw_ocr_text = None
        doc.ocr_method = None
        doc.page_count = None
        doc.is_vectorized = False
        doc.summary = None

        background_tasks.add_task(
            process_document_ocr,
            document_id=doc.id,
            file_path=str(full_path),
            file_type=doc.file_type,
            case_id=doc.case_id,
        )
        queued += 1

    await db.commit()

    return {
        "message": f"OCR reprocessing queued for {queued} document(s).",
        "document_count": queued,
    }


_IMAGE_FILE_TYPES = {"png", "jpg", "jpeg", "tiff", "tif", "bmp"}


@router.post(
    "/cases/{case_id}/documents/scan-images",
    status_code=status.HTTP_200_OK,
)
async def scan_images_with_vision(
    case_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: DBSession,
    user: CurrentUser,
) -> dict:
    """Run vision-model summarization on all image files in a case (skips PDFs)."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(Document).where(
            Document.case_id == case_id,
            Document.file_type.in_(list(_IMAGE_FILE_TYPES)),
        )
    )
    docs = result.scalars().all()
    if not docs:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="No image documents found in this case.",
        )

    for doc in docs:
        doc.status = DocStatus.PROCESSING.value
        doc.status_message = "Queued for Vision scan."
    await db.commit()

    async def _run_vision_scan() -> None:
        from app.services.extraction_service import summarize_document as _summarize
        from app.core.database import async_session_factory
        from sqlalchemy import select

        for doc in docs:
            try:
                full_path = settings.upload_path / Path(doc.storage_uri)
                if not full_path.exists():
                    continue
                await _summarize(
                    text_payload=doc.raw_ocr_text or "",
                    document_id=doc.id,
                    image_path=str(full_path),
                    file_type=doc.file_type,
                )
            except Exception as exc:
                logger.error(
                    "vision_scan_single_failed",
                    document_id=str(doc.id),
                    error=str(exc),
                )
            finally:
                async with async_session_factory() as session:
                    res = await session.execute(
                        select(Document).where(Document.id == doc.id)
                    )
                    d = res.scalar_one_or_none()
                    if d:
                        d.status = DocStatus.COMPLETED.value
                        d.status_message = "Vision scan completed."
                        await session.commit()

    background_tasks.add_task(_run_vision_scan)

    return {
        "message": f"Vision scan queued for {len(docs)} image(s).",
        "document_count": len(docs),
    }
