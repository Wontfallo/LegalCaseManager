"""
Authentication router: register, login, refresh, me.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from jose import JWTError
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import CurrentUser, DBSession
from app.core.logging import get_logger
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    TokenRefreshRequest,
    TokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
)

logger = get_logger("auth_router")
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(body: UserRegisterRequest, db: DBSession) -> UserResponse:
    """Register a new user account."""
    # Check for existing user
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        mfa_enabled=False,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    logger.info("user_registered", user_id=str(user.id), email=user.email)
    return UserResponse.model_validate(user)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLoginRequest, db: DBSession) -> TokenResponse:
    """Authenticate a user and issue JWT tokens."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated.",
        )

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    logger.info("user_login", user_id=str(user.id))
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: TokenRefreshRequest, db: DBSession) -> TokenResponse:
    """Issue a new access token from a valid refresh token."""
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is not a refresh token.",
        )

    import uuid as _uuid

    user_id = _uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated.",
        )

    access_token = create_access_token(user.id)
    new_refresh = create_refresh_token(user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    """Return the currently authenticated user's profile."""
    return UserResponse.model_validate(current_user)


@router.post("/auto-login", response_model=TokenResponse)
async def auto_login(db: DBSession) -> TokenResponse:
    """
    Single-user local mode: automatically create (or find) the local owner
    account and return tokens. No password required.

    This endpoint only works when APP_ENV != 'production'.
    """
    if settings.app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auto-login is disabled in production.",
        )

    local_email = "owner@local"

    result = await db.execute(select(User).where(User.email == local_email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=local_email,
            password_hash=hash_password("local-no-password"),
            mfa_enabled=False,
            is_active=True,
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        logger.info("local_owner_created", user_id=str(user.id))

    # Grant OWNER access to every case this user doesn't already have access to
    from app.models.case import Case, CaseUserLink, CaseUserRole

    all_cases = await db.execute(select(Case.id))
    case_ids = [row[0] for row in all_cases.all()]

    for case_id in case_ids:
        existing_link = await db.execute(
            select(CaseUserLink).where(
                CaseUserLink.case_id == case_id,
                CaseUserLink.user_id == user.id,
            )
        )
        if existing_link.scalar_one_or_none() is None:
            db.add(
                CaseUserLink(
                    case_id=case_id,
                    user_id=user.id,
                    role=CaseUserRole.OWNER,
                )
            )

    await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    logger.info("auto_login", user_id=str(user.id))
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )
