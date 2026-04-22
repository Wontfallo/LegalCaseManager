"""
Google Integration Service – handles OAuth2 for Gemini and Google Drive.
"""

import json
import os
from typing import Any, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from app.core.config import settings
from app.core.logging import get_logger
from app.core.database import async_session_factory
from app.models.user import User
from sqlalchemy import select
import uuid

logger = get_logger("google_service")

# Scopes required for Gemini and Drive
SCOPES = [
    "https://www.googleapis.com/auth/generative-ai",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

class GoogleService:
    def __init__(self):
        self.client_id = settings.google_client_id
        self.client_secret = settings.google_client_secret
        self.redirect_uri = f"http://localhost:{settings.app_port}/api/integrations/google/callback"
        
    def get_auth_url(self) -> str:
        """Generate the Google OAuth2 authorization URL."""
        if not self.client_id or not self.client_secret:
            raise RuntimeError("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in .env")
            
        client_config = {
            "web": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [self.redirect_uri],
            }
        }
        
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=self.redirect_uri
        )
        
        auth_url, _ = flow.authorization_url(prompt='consent', access_type='offline')
        return auth_url

    async def handle_callback(self, code: str, user_id: uuid.UUID) -> None:
        """Exchange auth code for tokens and save to user."""
        client_config = {
            "web": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }
        
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=self.redirect_uri
        )
        
        flow.fetch_token(code=code)
        credentials = flow.credentials
        
        tokens_json = credentials.to_json()
        
        async with async_session_factory() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                user.google_tokens = tokens_json
                await session.commit()
                logger.info("google_tokens_saved", user_id=str(user_id))

    async def get_credentials(self, user_id: uuid.UUID) -> Optional[Credentials]:
        """Get valid credentials for the user, refreshing if necessary."""
        async with async_session_factory() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user or not user.google_tokens:
                return None
                
            creds = Credentials.from_authorized_user_info(json.loads(user.google_tokens), SCOPES)
            
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                user.google_tokens = creds.to_json()
                await session.commit()
                
            return creds

    async def backup_document(self, user_id: uuid.UUID, file_path: str, filename: str) -> Optional[str]:
        """Upload a file to Google Drive."""
        creds = await self.get_credentials(user_id)
        if not creds:
            logger.warning("google_backup_no_creds", user_id=str(user_id))
            return None
            
        try:
            service = build("drive", "v3", credentials=creds)
            
            # Check if 'Lexicon Backups' folder exists
            query = "name = 'Lexicon Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            results = service.files().list(q=query, spaces='drive', fields='files(id, name)').execute()
            folders = results.get('files', [])
            
            if not folders:
                folder_metadata = {
                    'name': 'Lexicon Backups',
                    'mimeType': 'application/vnd.google-apps.folder'
                }
                folder = service.files().create(body=folder_metadata, fields='id').execute()
                folder_id = folder.get('id')
            else:
                folder_id = folders[0].get('id')
                
            file_metadata = {
                'name': filename,
                'parents': [folder_id]
            }
            media = MediaFileUpload(file_path, resumable=True)
            file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
            
            logger.info("google_backup_success", file_id=file.get('id'), filename=filename)
            return file.get('id')
            
        except Exception as e:
            logger.error("google_backup_failed", error=str(e), filename=filename)
            return None

google_service = GoogleService()
