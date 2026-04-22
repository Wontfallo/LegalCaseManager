from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class AssistantToolCall(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result_summary: str


class AssistantChatRequest(BaseModel):
    """Session-aware chat request. Sends a single new message."""

    session_id: str | None = None
    message: str = Field(..., min_length=1, max_length=12000)


class AssistantChatResponse(BaseModel):
    """Chat response including session metadata."""

    message: AssistantMessage
    tool_calls: list[AssistantToolCall] = Field(default_factory=list)
    session_id: str
    session_title: str | None = None
