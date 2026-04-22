"""
Integrations Router – handles Google OAuth2 and other 3rd party connections.
"""

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.core.deps import CurrentUser, DBSession
from app.services.google_service import google_service
from app.core.logging import get_logger

logger = get_logger("integrations_router")
router = APIRouter(prefix="/api/integrations", tags=["Integrations"])

@router.get("/google/connect")
async def google_connect(user: CurrentUser):
    """Initiate Google OAuth2 connection."""
    try:
        auth_url = google_service.get_auth_url()
        return {"url": auth_url}
    except Exception as e:
        logger.error("google_connect_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/google/callback")
async def google_callback(code: str, state: str = None):
    """Google OAuth2 callback."""
    # Note: In a real app, we should use 'state' to verify the request and link to the user.
    # For now, we'll assume the user is the local owner or we need to pass the user ID in state.
    # Since we can't easily get the user ID from the redirect, we'll use a trick or just assume the first user for local mode.
    from app.core.database import async_session_factory
    from app.models.user import User
    
    async with async_session_factory() as session:
        result = await session.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        try:
            await google_service.handle_callback(code, user.id)
            # Redirect to frontend settings or integrations page
            return RedirectResponse(url="/settings?google=connected")
        except Exception as e:
            logger.error("google_callback_failed", error=str(e))
            raise HTTPException(status_code=500, detail=str(e))

@router.get("/google/status")
async def google_status(user: CurrentUser):
    """Check if Google is connected."""
    creds = await google_service.get_credentials(user.id)
    return {"connected": creds is not None}
