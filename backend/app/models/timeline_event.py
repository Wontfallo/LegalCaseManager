"""
TimelineEventModel – AI-extracted chronological events.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TimelineEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "timeline_events"

    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    absolute_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    event_description: Mapped[str] = mapped_column(Text, nullable=False)
    ai_confidence_score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    source_type: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # "document" | "communication"

    # Polymorphic FK: link to either a Document or a Communication
    linked_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    linked_communication_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communications.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="timeline_events")
    linked_document: Mapped["Document | None"] = relationship(
        "Document",
        back_populates="timeline_events",
        foreign_keys=[linked_document_id],
    )
    linked_communication: Mapped["Communication | None"] = relationship(
        "Communication",
        back_populates="timeline_events",
        foreign_keys=[linked_communication_id],
    )

    @property
    def linked_source_id(self) -> uuid.UUID | None:
        """Convenience accessor: returns whichever linked ID is populated."""
        return self.linked_document_id or self.linked_communication_id

    def __repr__(self) -> str:
        return (
            f"<TimelineEvent id={self.id} "
            f"date={self.absolute_timestamp} "
            f"confidence={self.ai_confidence_score:.2f}>"
        )
