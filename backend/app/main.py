"""
Legal Case Manager – FastAPI Application Entry Point.

Registers all routers, middleware, CORS, startup/shutdown lifecycle,
and serves as the top-level application factory.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import close_db, init_db
from app.core.logging import get_logger, setup_logging
from app.middleware.request_logging import (
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)

# ── Routers ──────────────────────────────────────────────
from app.api.routers.auth import router as auth_router
from app.api.routers.assistant import router as assistant_router
from app.api.routers.cases import case_router, client_router
from app.api.routers.chat_sessions import router as chat_sessions_router
from app.api.routers.documents import router as documents_router
from app.api.routers.email_webhook import router as email_webhook_router
from app.api.routers.twilio_webhook import router as twilio_webhook_router
from app.api.routers.providers import router as providers_router
from app.api.routers.timeline import (
    comm_router,
    search_router,
    timeline_router,
)
from app.api.routers.integrations import router as integrations_router

setup_logging()
logger = get_logger("main")


# ── Lifecycle ────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle."""
    logger.info(
        "application_starting",
        env=settings.app_env,
        debug=settings.app_debug,
    )

    # Startup: create database tables (dev convenience; use Alembic in prod)
    await init_db()
    logger.info("application_started")

    yield

    # Shutdown
    await close_db()
    logger.info("application_shutdown")


# ── Application Factory ─────────────────────────────────
app = FastAPI(
    title="Legal Case Manager",
    description=(
        "AI-integrated Legal Case Management and Document Organization Application. "
        "Ingests unstructured data (PDFs, images, emails, call transcripts), "
        "processes via OCR and NLP, and maps events onto an interactive timeline."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.app_debug else None,
    redoc_url="/api/redoc" if settings.app_debug else None,
)


# ── Middleware (order matters: bottom is executed first) ──
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "https://localhost:3000",
        "https://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Exception Handlers ───────────────────────────────────
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return structured validation errors."""
    logger.warning(
        "validation_error",
        path=request.url.path,
        errors=exc.errors(),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Validation Error",
            "errors": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
        type=type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )


# ── Register Routers ────────────────────────────────────
app.include_router(auth_router)
app.include_router(assistant_router)
app.include_router(chat_sessions_router)
app.include_router(client_router)
app.include_router(case_router)
app.include_router(documents_router)
app.include_router(email_webhook_router)
app.include_router(twilio_webhook_router)
app.include_router(timeline_router)
app.include_router(comm_router)
app.include_router(search_router)
app.include_router(providers_router)
app.include_router(integrations_router)


# ── Health Check ─────────────────────────────────────────
@app.get("/api/health", tags=["Health"])
async def health_check() -> dict:
    """Health check with system capability summary."""
    import shutil

    from app.services.llm_provider import (
        get_active_chat_provider,
        get_active_embedding_provider,
        get_provider_summary,
    )

    tesseract_installed = shutil.which("tesseract") is not None or any(
        path.exists()
        for path in [
            Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        ]
    )
    chat_provider = get_active_chat_provider()
    embed_provider = get_active_embedding_provider()

    has_chat = chat_provider is not None
    has_embed = embed_provider is not None

    return {
        "status": "healthy",
        "version": "1.0.0",
        "environment": settings.app_env,
        "capabilities": {
            "ocr_tesseract": tesseract_installed,
            "ocr_mistral": bool(settings.mistral_api_key),
            "nlp_openai": bool(settings.openai_api_key),
            "nlp_mistral": bool(settings.mistral_api_key),
            "timeline_extraction": has_chat,
            "semantic_search": has_embed,
        },
        "providers": get_provider_summary(),
        "active_chat_provider": chat_provider[0].value if chat_provider else None,
        "active_embedding_provider": embed_provider[0].value
        if embed_provider
        else None,
        "offline_mode": not has_chat and not has_embed,
    }
