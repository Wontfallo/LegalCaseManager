"""
Structured logging configuration using structlog.
"""

from __future__ import annotations

import logging
import sys

import structlog

from app.core.config import settings


def setup_logging() -> None:
    """Configure structlog and stdlib logging for the application."""

    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer()
            if settings.app_debug
            else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Quiet noisy third-party loggers
    for name in ("uvicorn.access", "sqlalchemy.engine", "httpx"):
        logging.getLogger(name).setLevel(logging.WARNING)

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger, optionally named."""
    return structlog.get_logger(name) if name else structlog.get_logger()
