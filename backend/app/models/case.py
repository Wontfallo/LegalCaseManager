"""
CaseModel and CaseUserLink (RBAC junction table).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CaseStatus(str, enum.Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_REVIEW = "PENDING_REVIEW"
    CLOSED = "CLOSED"
    ARCHIVED = "ARCHIVED"


class CaseUserRole(str, enum.Enum):
    OWNER = "OWNER"
    ATTORNEY = "ATTORNEY"
    PARALEGAL = "PARALEGAL"
    VIEWER = "VIEWER"


class Case(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "cases"

    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[CaseStatus] = mapped_column(
        Enum(CaseStatus, name="case_status_enum"),
        default=CaseStatus.OPEN,
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    filing_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="cases")
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="case", cascade="all, delete-orphan"
    )
    communications: Mapped[list["Communication"]] = relationship(
        "Communication", back_populates="case", cascade="all, delete-orphan"
    )
    timeline_events: Mapped[list["TimelineEvent"]] = relationship(
        "TimelineEvent", back_populates="case", cascade="all, delete-orphan"
    )
    user_links: Mapped[list["CaseUserLink"]] = relationship(
        "CaseUserLink", back_populates="case", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Case id={self.id} title={self.title!r}>"


class CaseUserLink(Base, UUIDPrimaryKeyMixin):
    """RBAC junction: which users have access to which cases and at what role."""

    __tablename__ = "case_user_links"
    __table_args__ = (UniqueConstraint("case_id", "user_id", name="uq_case_user"),)

    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[CaseUserRole] = mapped_column(
        Enum(CaseUserRole, name="case_user_role_enum"),
        default=CaseUserRole.VIEWER,
        nullable=False,
    )

    case: Mapped["Case"] = relationship("Case", back_populates="user_links")
    user: Mapped["User"] = relationship("User", back_populates="case_permissions")
