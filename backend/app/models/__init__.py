"""
Package-level imports for all SQLAlchemy models.
Importing from here ensures all models are registered with the Base metadata.
"""

from app.models.base import Base
from app.models.user import User
from app.models.client import Client
from app.models.case import Case, CaseUserLink, CaseStatus, CaseUserRole
from app.models.document import Document
from app.models.communication import Communication, CommType
from app.models.timeline_event import TimelineEvent

__all__ = [
    "Base",
    "User",
    "Client",
    "Case",
    "CaseUserLink",
    "CaseStatus",
    "CaseUserRole",
    "Document",
    "Communication",
    "CommType",
    "TimelineEvent",
]
