"""
DocumentModel – files uploaded / ingested into a case.
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class DocStatus(str, enum.Enum):
    """Document processing lifecycle status."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Document(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "documents"

    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_type: Mapped[str] = mapped_column(String(64), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    section_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)

    # Processing status
    status: Mapped[str] = mapped_column(
        String(32), default=DocStatus.PENDING.value, nullable=False
    )
    status_message: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # OCR results
    raw_ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_method: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # "tesseract" | "mistral"
    page_count: Mapped[int | None] = mapped_column(nullable=True)
    is_vectorized: Mapped[bool] = mapped_column(default=False, nullable=False)

    # AI-generated summary
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    text_fingerprint: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="documents")
    timeline_events: Mapped[list["TimelineEvent"]] = relationship(
        "TimelineEvent",
        back_populates="linked_document",
        foreign_keys="TimelineEvent.linked_document_id",
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id} status={self.status} type={self.file_type}>"
