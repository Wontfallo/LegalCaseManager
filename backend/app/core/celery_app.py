"""
Celery worker configuration for background task processing.
Used for heavy OCR tasks when BackgroundTasks is insufficient.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "legal_case_manager",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=300,  # 5 minutes
    task_time_limit=600,  # 10 minutes
    task_default_queue="default",
    task_routes={
        "app.workers.tasks.process_ocr_task": {"queue": "ocr"},
        "app.workers.tasks.process_vectorization_task": {"queue": "vectorization"},
        "app.workers.tasks.process_extraction_task": {"queue": "extraction"},
    },
)

celery_app.autodiscover_tasks(["app.workers"])
