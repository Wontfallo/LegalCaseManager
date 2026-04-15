"""
JWT token creation, verification, and password hashing utilities.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("security")


# ── Password Hashing ────────────────────────────────────
def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


# ── JWT Tokens ──────────────────────────────────────────
def create_access_token(
    user_id: uuid.UUID,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def create_refresh_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_refresh_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": now,
        "exp": expire,
        "type": "refresh",
    }
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises JWTError on failure."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        return payload
    except JWTError as exc:
        logger.warning("jwt_decode_failed", error=str(exc))
        raise
