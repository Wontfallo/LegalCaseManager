"""
Pydantic schemas for ChatSession and ChatMessage endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ChatMessageResponse(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionListItem(BaseModel):
    """Lightweight summary used in the sidebar list."""

    id: str
    title: str | None
    is_pinned: bool
    message_count: int
    last_message_at: datetime | None
    preview: str | None  # snippet of the first user message
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionDetail(BaseModel):
    """Full session with all messages, used when a chat is opened."""

    id: str
    title: str | None
    is_pinned: bool
    messages: list[ChatMessageResponse]
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}


class ChatSessionUpdateRequest(BaseModel):
    title: str | None = Field(None, max_length=200)
    is_pinned: bool | None = None


class ChatSessionExportResponse(BaseModel):
    document_id: str
    message: str
