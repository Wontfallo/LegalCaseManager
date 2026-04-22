"""
Centralised application settings loaded from environment variables.
Uses pydantic-settings for strict validation with sensible defaults.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────
    app_env: Literal["development", "staging", "production"] = "development"
    app_debug: bool = True
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    log_level: str = "DEBUG"

    # ── Database ─────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./storage/legalcm.db"

    # ── Redis / Celery ───────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # ── JWT / Auth ───────────────────────────────────────
    jwt_secret_key: str = "CHANGE_ME_TO_A_LONG_RANDOM_STRING"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_minutes: int = 10080  # 7 days

    # ── Encryption ───────────────────────────────────────
    file_encryption_key: str = "CHANGE_ME_32_BYTE_HEX_KEY_00000000"

    # ── OpenAI ───────────────────────────────────────────
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    openai_chat_model: str = "gpt-4o"

    # ── Mistral OCR ──────────────────────────────────────
    mistral_api_key: str = ""
    mistral_ocr_endpoint: str = "https://api.mistral.ai/v1/ocr"

    # ── Google OAuth2 ────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""

    # ── ChromaDB ─────────────────────────────────────────
    chroma_host: str = "localhost"
    chroma_port: int = 8000
    chroma_collection: str = "legal_documents"

    # ── Twilio ───────────────────────────────────────────
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_webhook_secret: str = ""

    # ── Webhook Security ────────────────────────────────
    email_webhook_secret: str = ""

    # ── File Storage ─────────────────────────────────────
    upload_dir: str = "./storage/uploads"
    max_upload_size_mb: int = 50

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def is_sqlite(self) -> bool:
        return "sqlite" in self.database_url

    def validate_production_settings(self) -> None:
        """Raise an error if production mode is running with insecure defaults."""
        if self.app_env == "production":
            if self.jwt_secret_key == "CHANGE_ME_TO_A_LONG_RANDOM_STRING":
                raise ValueError(
                    "FATAL: JWT_SECRET_KEY must be changed from the default value in production. "
                    "Set a secure random value in your .env file."
                )
            if self.file_encryption_key == "CHANGE_ME_32_BYTE_HEX_KEY_00000000":
                raise ValueError(
                    "FATAL: FILE_ENCRYPTION_KEY must be changed from the default value in production. "
                    "Set a secure random value in your .env file."
                )


settings = Settings()
settings.validate_production_settings()
