"""
Timeline events router – list, filter, and get details for timeline events.
Communication logs CRUD. Semantic search endpoint.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DBSession, require_case_access
from app.core.logging import get_logger
from app.models.communication import Communication, CommType
from app.models.document import Document
from app.models.timeline_event import TimelineEvent
from app.schemas.documents import (
    CommunicationCreate,
    CommunicationResponse,
    SemanticSearchRequest,
    SemanticSearchResult,
    TimelineEventDetail,
    TimelineEventResponse,
)
from app.services.vectorization_service import semantic_search

logger = get_logger("timeline_router")

# ── Timeline Router ──────────────────────────────────────
timeline_router = APIRouter(prefix="/api/cases/{case_id}/timeline", tags=["Timeline"])


@timeline_router.get("", response_model=list[TimelineEventResponse])
async def list_timeline_events(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
    skip: int = 0,
    limit: int = 200,
    min_confidence: float = Query(default=0.0, ge=0.0, le=1.0),
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> list[TimelineEventResponse]:
    """
    List all timeline events for a case, sorted chronologically.
    Supports filtering by confidence threshold and date range.
    """
    await require_case_access(case_id, user, db)

    stmt = (
        select(TimelineEvent)
        .where(TimelineEvent.case_id == case_id)
        .where(TimelineEvent.ai_confidence_score >= min_confidence)
    )

    if start_date:
        stmt = stmt.where(TimelineEvent.absolute_timestamp >= start_date)
    if end_date:
        stmt = stmt.where(TimelineEvent.absolute_timestamp <= end_date)

    stmt = (
        stmt.order_by(TimelineEvent.absolute_timestamp.asc()).offset(skip).limit(limit)
    )

    result = await db.execute(stmt)
    events = result.scalars().all()
    return [TimelineEventResponse.model_validate(e) for e in events]


@timeline_router.get("/{event_id}", response_model=TimelineEventDetail)
async def get_timeline_event_detail(
    case_id: uuid.UUID,
    event_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> TimelineEventDetail:
    """
    Get a single timeline event with linked source preview.
    Used by the split-screen evidentiary verification UI.
    """
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(TimelineEvent)
        .options(
            selectinload(TimelineEvent.linked_document),
            selectinload(TimelineEvent.linked_communication),
        )
        .where(TimelineEvent.id == event_id, TimelineEvent.case_id == case_id)
    )
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Timeline event not found."
        )

    # Build source preview
    source_preview: str | None = None
    source_type: str | None = None

    if event.linked_document:
        source_type = "document"
        ocr_text = event.linked_document.raw_ocr_text or ""
        source_preview = ocr_text[:5000]  # First 5000 chars as preview
    elif event.linked_communication:
        source_type = "communication"
        source_preview = event.linked_communication.transcript_body or ""

    base = TimelineEventResponse.model_validate(event)
    return TimelineEventDetail(
        **base.model_dump(),
        linked_source_preview=source_preview,
        linked_source_type=source_type,
    )


# ── Communication Logs Router ────────────────────────────
comm_router = APIRouter(
    prefix="/api/cases/{case_id}/communications", tags=["Communications"]
)


@comm_router.get("", response_model=list[CommunicationResponse])
async def list_communications(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
    skip: int = 0,
    limit: int = 50,
    comm_type: CommType | None = None,
) -> list[CommunicationResponse]:
    """List all communications for a case with optional type filter."""
    await require_case_access(case_id, user, db)

    stmt = select(Communication).where(Communication.case_id == case_id)
    if comm_type:
        stmt = stmt.where(Communication.comm_type == comm_type)

    stmt = stmt.order_by(Communication.timestamp.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return [CommunicationResponse.model_validate(c) for c in result.scalars().all()]


@comm_router.post(
    "",
    response_model=CommunicationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_communication(
    case_id: uuid.UUID,
    body: CommunicationCreate,
    db: DBSession,
    user: CurrentUser,
) -> CommunicationResponse:
    """Manually create a communication log entry (e.g., a NOTE)."""
    await require_case_access(case_id, user, db)

    if body.case_id != case_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="case_id in path and body must match.",
        )

    comm = Communication(
        case_id=case_id,
        comm_type=body.comm_type,
        timestamp=body.timestamp,
        sender=body.sender,
        recipient=body.recipient,
        subject=body.subject,
        transcript_body=body.transcript_body,
        is_vectorized=False,
    )
    db.add(comm)
    await db.flush()
    await db.refresh(comm)

    # Trigger vectorization and extraction for notes with content
    if body.transcript_body and body.transcript_body.strip():
        try:
            from app.services.vectorization_service import vectorize_text
            from app.services.extraction_service import extract_timeline_events

            await vectorize_text(
                text=body.transcript_body,
                source_id=str(comm.id),
                source_type="communication",
                case_id=str(case_id),
            )
            comm.is_vectorized = True
            await db.flush()

            await extract_timeline_events(
                text_payload=body.transcript_body,
                timestamp_context=body.timestamp.isoformat(),
                case_id=case_id,
                source_id=comm.id,
                source_type="communication",
            )
        except Exception as exc:
            logger.error(
                "communication_post_processing_error",
                comm_id=str(comm.id),
                error=str(exc),
            )

    return CommunicationResponse.model_validate(comm)


@comm_router.get("/{comm_id}", response_model=CommunicationResponse)
async def get_communication(
    case_id: uuid.UUID,
    comm_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> CommunicationResponse:
    """Get a single communication by ID."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(Communication).where(
            Communication.id == comm_id, Communication.case_id == case_id
        )
    )
    comm = result.scalar_one_or_none()
    if comm is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Communication not found."
        )
    return CommunicationResponse.model_validate(comm)


# ── Semantic Search Router ───────────────────────────────
search_router = APIRouter(prefix="/api/search", tags=["Search"])


@search_router.post("", response_model=list[SemanticSearchResult])
async def perform_semantic_search(
    body: SemanticSearchRequest,
    db: DBSession,
    user: CurrentUser,
) -> list[SemanticSearchResult]:
    """
    Perform semantic (RAG) search within a specific case.
    Uses vector embeddings for similarity-based retrieval.
    """
    await require_case_access(body.case_id, user, db)

    try:
        results = await semantic_search(
            query=body.query,
            case_id=str(body.case_id),
            top_k=body.top_k,
        )

        return [
            SemanticSearchResult(
                source_id=r["source_id"],
                source_type=r["source_type"],
                text_chunk=r["text_chunk"],
                similarity_score=r["similarity_score"],
                metadata=r.get("metadata"),
            )
            for r in results
        ]
    except Exception as exc:
        logger.error("semantic_search_endpoint_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Semantic search failed.",
        )
