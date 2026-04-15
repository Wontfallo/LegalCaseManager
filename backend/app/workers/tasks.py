"""
Celery tasks for heavy background processing.
These tasks wrap the service layer functions for distributed execution.
"""

from __future__ import annotations

import asyncio
import uuid

from app.core.celery_app import celery_app
from app.core.logging import get_logger

logger = get_logger("celery_tasks")


def _run_async(coro):
    """Helper to run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


@celery_app.task(bind=True, name="app.workers.tasks.process_ocr_task", max_retries=3)
def process_ocr_task(
    self, document_id: str, file_path: str, file_type: str, case_id: str
):
    """Celery task wrapper for OCR processing."""
    logger.info(
        "celery_ocr_task_started",
        document_id=document_id,
        task_id=self.request.id,
    )
    try:
        from app.services.ocr_service import process_document_ocr

        _run_async(
            process_document_ocr(
                document_id=uuid.UUID(document_id),
                file_path=file_path,
                file_type=file_type,
                case_id=uuid.UUID(case_id),
            )
        )
        logger.info("celery_ocr_task_completed", document_id=document_id)
    except Exception as exc:
        logger.error(
            "celery_ocr_task_failed",
            document_id=document_id,
            error=str(exc),
        )
        self.retry(exc=exc, countdown=30)


@celery_app.task(
    bind=True, name="app.workers.tasks.process_vectorization_task", max_retries=3
)
def process_vectorization_task(
    self, text: str, source_id: str, source_type: str, case_id: str
):
    """Celery task wrapper for vectorization."""
    logger.info(
        "celery_vectorization_task_started",
        source_id=source_id,
        task_id=self.request.id,
    )
    try:
        from app.services.vectorization_service import vectorize_text

        _run_async(
            vectorize_text(
                text=text,
                source_id=source_id,
                source_type=source_type,
                case_id=case_id,
            )
        )
        logger.info("celery_vectorization_task_completed", source_id=source_id)
    except Exception as exc:
        logger.error(
            "celery_vectorization_task_failed",
            source_id=source_id,
            error=str(exc),
        )
        self.retry(exc=exc, countdown=30)


@celery_app.task(
    bind=True, name="app.workers.tasks.process_extraction_task", max_retries=3
)
def process_extraction_task(
    self,
    text_payload: str,
    timestamp_context: str | None,
    case_id: str,
    source_id: str,
    source_type: str,
):
    """Celery task wrapper for timeline extraction."""
    logger.info(
        "celery_extraction_task_started",
        source_id=source_id,
        task_id=self.request.id,
    )
    try:
        from app.services.extraction_service import extract_timeline_events

        _run_async(
            extract_timeline_events(
                text_payload=text_payload,
                timestamp_context=timestamp_context,
                case_id=uuid.UUID(case_id),
                source_id=uuid.UUID(source_id),
                source_type=source_type,
            )
        )
        logger.info("celery_extraction_task_completed", source_id=source_id)
    except Exception as exc:
        logger.error(
            "celery_extraction_task_failed",
            source_id=source_id,
            error=str(exc),
        )
        self.retry(exc=exc, countdown=30)
