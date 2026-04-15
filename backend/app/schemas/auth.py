"""
Pydantic schemas for authentication endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# ── Request Schemas ──────────────────────────────────────
class UserRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str


# ── Response Schemas ─────────────────────────────────────
class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    mfa_enabled: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
