"""
ClientModel – the legal client / party entity.
"""

from __future__ import annotations

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Client(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "clients"

    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    contact_info: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)

    # One client can have many cases
    cases: Mapped[list["Case"]] = relationship(
        "Case", back_populates="client", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Client id={self.id} name={self.name}>"
