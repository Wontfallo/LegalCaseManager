"""
FastAPI dependencies: current user extraction, DB session, RBAC checks.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.security import decode_token
from app.models.case import CaseUserLink, CaseUserRole
from app.models.user import User

logger = get_logger("deps")

bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Extract and validate the current user from the Bearer token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(credentials.credentials)
        token_type = payload.get("type")
        if token_type != "access":
            raise credentials_exception
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise credentials_exception
    return user


async def require_case_access(
    case_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    required_roles: list[CaseUserRole] | None = None,
) -> CaseUserLink:
    """
    RBAC enforcement: verify user has access to the given case.
    Optionally restrict to specific roles.
    """
    stmt = select(CaseUserLink).where(
        CaseUserLink.case_id == case_id,
        CaseUserLink.user_id == user.id,
    )
    result = await db.execute(stmt)
    link = result.scalar_one_or_none()

    if link is None:
        logger.warning(
            "rbac_denied",
            user_id=str(user.id),
            case_id=str(case_id),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this case.",
        )

    if required_roles and link.role not in required_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient role. Required: {[r.value for r in required_roles]}",
        )

    return link


# Type alias for convenience in route signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
DBSession = Annotated[AsyncSession, Depends(get_db)]
