"""
Pydantic schemas for Client and Case CRUD operations.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.case import CaseStatus, CaseUserRole


# ── Client ───────────────────────────────────────────────
class ClientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    contact_info: dict | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    contact_info: dict | None = None


class ClientResponse(BaseModel):
    id: uuid.UUID
    name: str
    contact_info: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Case ─────────────────────────────────────────────────
class CaseCreate(BaseModel):
    client_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=512)
    description: str | None = None
    status: CaseStatus = CaseStatus.OPEN
    filing_date: datetime | None = None


class CaseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: CaseStatus | None = None
    filing_date: datetime | None = None


class CaseResponse(BaseModel):
    id: uuid.UUID
    client_id: uuid.UUID
    title: str
    status: CaseStatus
    description: str | None
    filing_date: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CaseDetailResponse(CaseResponse):
    client: ClientResponse
    document_count: int = 0
    communication_count: int = 0
    timeline_event_count: int = 0


class CaseUserLinkCreate(BaseModel):
    user_id: uuid.UUID
    role: CaseUserRole = CaseUserRole.VIEWER


class CaseUserLinkResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    user_id: uuid.UUID
    role: CaseUserRole

    model_config = {"from_attributes": True}
