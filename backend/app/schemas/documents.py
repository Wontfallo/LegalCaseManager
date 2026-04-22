"""
Pydantic schemas for Document, Communication, and TimelineEvent.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.communication import CommType


# ── Document ─────────────────────────────────────────────
class DocumentResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    storage_uri: str
    file_type: str
    original_filename: str | None
    file_hash: str | None = None
    section_label: str | None = None
    sort_order: int = 0
    status: str
    status_message: str | None
    raw_ocr_text: str | None
    ocr_method: str | None
    page_count: int | None
    is_vectorized: bool
    summary: str | None = None
    display_title: str | None = None
    text_fingerprint: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentUploadResponse(BaseModel):
    id: uuid.UUID
    message: str
    processing: bool = True
    duplicate: bool = False


class DuplicateCandidate(BaseModel):
    document_id: uuid.UUID
    original_filename: str | None
    status: str
    created_at: datetime
    match_type: str
    confidence: float


class DuplicateGroup(BaseModel):
    reason: str
    documents: list[DuplicateCandidate]


class DuplicateScanResponse(BaseModel):
    case_id: uuid.UUID
    duplicate_groups: list[DuplicateGroup]


class DuplicateCleanupRequest(BaseModel):
    case_id: uuid.UUID
    document_ids: list[uuid.UUID] = Field(..., min_length=1)
    keep_document_id: uuid.UUID | None = None


class DuplicateCleanupResponse(BaseModel):
    deleted_document_ids: list[uuid.UUID]
    kept_document_id: uuid.UUID | None = None


class DocumentOrganizationUpdate(BaseModel):
    document_id: uuid.UUID
    section_label: str | None = None
    sort_order: int = Field(default=0, ge=0)


class DocumentOrganizationRequest(BaseModel):
    case_id: uuid.UUID
    documents: list[DocumentOrganizationUpdate] = Field(..., min_length=1)


class DocumentSectionSuggestion(BaseModel):
    document_id: uuid.UUID
    section_label: str
    sort_order: int = Field(default=0, ge=0)
    reason: str | None = None


class DocumentOrganizationResponse(BaseModel):
    case_id: uuid.UUID
    documents: list[DocumentOrganizationUpdate]


class AIDocumentOrganizationResponse(BaseModel):
    case_id: uuid.UUID
    documents: list[DocumentSectionSuggestion]


# ── Communication ────────────────────────────────────────
class CommunicationCreate(BaseModel):
    case_id: uuid.UUID
    comm_type: CommType
    timestamp: datetime
    sender: str | None = None
    recipient: str | None = None
    subject: str | None = None
    transcript_body: str | None = None


class CommunicationResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    comm_type: CommType
    timestamp: datetime
    sender: str | None
    recipient: str | None
    subject: str | None
    transcript_body: str | None
    is_vectorized: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Timeline Event ───────────────────────────────────────
class TimelineEventCreate(BaseModel):
    case_id: uuid.UUID
    absolute_timestamp: datetime
    event_description: str
    ai_confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    source_type: str | None = None
    linked_document_id: uuid.UUID | None = None
    linked_communication_id: uuid.UUID | None = None


class TimelineEventResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    absolute_timestamp: datetime
    event_description: str
    ai_confidence_score: float
    source_type: str | None
    linked_document_id: uuid.UUID | None
    linked_communication_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TimelineEventDetail(TimelineEventResponse):
    """Extended response with linked source preview."""

    linked_source_preview: str | None = None
    linked_source_type: str | None = None


# ── Semantic Search ──────────────────────────────────────
class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    case_id: uuid.UUID
    top_k: int = Field(default=10, ge=1, le=50)


class SemanticSearchResult(BaseModel):
    source_id: str
    source_type: str
    text_chunk: str
    similarity_score: float
    metadata: dict | None = None
