"""
CommunicationModel – emails, phone calls, notes.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CommType(str, enum.Enum):
    EMAIL = "EMAIL"
    CALL = "CALL"
    NOTE = "NOTE"


class Communication(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "communications"

    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    comm_type: Mapped[CommType] = mapped_column(
        Enum(CommType, name="comm_type_enum"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sender: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recipient: Mapped[str | None] = mapped_column(String(512), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    transcript_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_vectorized: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="communications")
    timeline_events: Mapped[list["TimelineEvent"]] = relationship(
        "TimelineEvent",
        back_populates="linked_communication",
        foreign_keys="TimelineEvent.linked_communication_id",
    )

    def __repr__(self) -> str:
        return f"<Communication id={self.id} type={self.comm_type}>"
