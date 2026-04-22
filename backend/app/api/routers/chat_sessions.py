"""
Chat Sessions Router – manage persisted assistant conversations.

Endpoints:
  GET    /api/cases/{case_id}/chat-sessions              – list sessions
  POST   /api/cases/{case_id}/chat-sessions              – create session
  GET    /api/cases/{case_id}/chat-sessions/search       – search sessions
  GET    /api/cases/{case_id}/chat-sessions/{id}         – get with messages
  PATCH  /api/cases/{case_id}/chat-sessions/{id}         – update title/pin
  DELETE /api/cases/{case_id}/chat-sessions/{id}         – delete
  POST   /api/cases/{case_id}/chat-sessions/{id}/export  – send to documents
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DBSession, require_case_access
from app.core.logging import get_logger
from app.models.chat_session import ChatMessage, ChatSession
from app.models.document import Document, DocStatus
from app.schemas.chat_session import (
    ChatSessionDetail,
    ChatSessionExportResponse,
    ChatSessionListItem,
    ChatSessionUpdateRequest,
)

logger = get_logger("chat_sessions_router")

router = APIRouter(
    prefix="/api/cases/{case_id}/chat-sessions",
    tags=["Chat Sessions"],
)

STORAGE_ROOT = Path("./storage")


# ── Helpers ──────────────────────────────────────────────


def _session_list_item(session: ChatSession) -> ChatSessionListItem:
    msgs = session.messages or []
    first_user = next((m for m in msgs if m.role == "user"), None)
    last_msg = msgs[-1] if msgs else None

    return ChatSessionListItem(
        id=str(session.id),
        title=session.title,
        is_pinned=session.is_pinned,
        message_count=len(msgs),
        last_message_at=last_msg.created_at if last_msg else None,
        preview=(first_user.content[:120] if first_user else None),
        created_at=session.created_at,
    )


def _format_transcript(session: ChatSession) -> str:
    """Format a chat session as a human-readable transcript."""
    lines = [
        f"Discussion with Assistant",
        f"Session: {session.title or 'Untitled Chat'}",
        f"Date: {session.created_at.strftime('%B %d, %Y %I:%M %p')}",
        f"{'=' * 60}",
        "",
    ]
    for msg in session.messages:
        speaker = "You" if msg.role == "user" else "Assistant"
        ts = msg.created_at.strftime("%I:%M %p")
        lines.append(f"[{ts}] {speaker}:")
        lines.append(msg.content)
        lines.append("")
    return "\n".join(lines)


# ── Endpoints ────────────────────────────────────────────


@router.get("", response_model=list[ChatSessionListItem])
async def list_chat_sessions(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> list[ChatSessionListItem]:
    """List all chat sessions for a case, pinned first then newest-first."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.case_id == case_id)
        .order_by(
            ChatSession.is_pinned.desc(),
            ChatSession.created_at.desc(),
        )
    )
    sessions = result.scalars().all()

    # Eager-load messages for each session
    items = []
    for session in sessions:
        await db.refresh(session, ["messages"])
        items.append(_session_list_item(session))

    return items


@router.post(
    "", response_model=ChatSessionListItem, status_code=status.HTTP_201_CREATED
)
async def create_chat_session(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> ChatSessionListItem:
    """Create a new empty chat session."""
    await require_case_access(case_id, user, db)

    session = ChatSession(case_id=case_id)
    db.add(session)
    await db.commit()
    await db.refresh(session, ["messages"])

    logger.info(
        "chat_session_created", session_id=str(session.id), case_id=str(case_id)
    )
    return _session_list_item(session)


@router.get("/search", response_model=list[ChatSessionListItem])
async def search_chat_sessions(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
    q: str = Query(..., min_length=1, max_length=200),
) -> list[ChatSessionListItem]:
    """Search sessions by title or message content."""
    await require_case_access(case_id, user, db)

    term = f"%{q.lower()}%"

    # Sessions whose title matches
    title_result = await db.execute(
        select(ChatSession)
        .where(
            ChatSession.case_id == case_id,
            func.lower(ChatSession.title).like(term),
        )
        .order_by(ChatSession.created_at.desc())
    )
    matched_by_title = {str(s.id): s for s in title_result.scalars().all()}

    # Sessions that have a message matching the query
    msg_result = await db.execute(
        select(ChatSession)
        .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(
            ChatSession.case_id == case_id,
            func.lower(ChatMessage.content).like(term),
        )
        .order_by(ChatSession.created_at.desc())
    )
    for session in msg_result.scalars().all():
        matched_by_title.setdefault(str(session.id), session)

    items = []
    for session in matched_by_title.values():
        await db.refresh(session, ["messages"])
        items.append(_session_list_item(session))

    # Pinned first, then newest
    items.sort(key=lambda x: (not x.is_pinned, x.created_at), reverse=False)
    return items


@router.get("/{session_id}", response_model=ChatSessionDetail)
async def get_chat_session(
    case_id: uuid.UUID,
    session_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> ChatSessionDetail:
    """Get a single session with all messages."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.case_id == case_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    await db.refresh(session, ["messages"])

    return ChatSessionDetail(
        id=str(session.id),
        title=session.title,
        is_pinned=session.is_pinned,
        messages=[
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at,
            }
            for m in session.messages
        ],
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.patch("/{session_id}", response_model=ChatSessionListItem)
async def update_chat_session(
    case_id: uuid.UUID,
    session_id: uuid.UUID,
    body: ChatSessionUpdateRequest,
    db: DBSession,
    user: CurrentUser,
) -> ChatSessionListItem:
    """Update a session's title or pin status."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.case_id == case_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    if body.title is not None:
        session.title = body.title.strip() or None
    if body.is_pinned is not None:
        session.is_pinned = body.is_pinned
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session, ["messages"])

    logger.info(
        "chat_session_updated",
        session_id=str(session_id),
        pinned=session.is_pinned,
    )
    return _session_list_item(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_session(
    case_id: uuid.UUID,
    session_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> None:
    """Delete a chat session and all its messages."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.case_id == case_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    await db.delete(session)
    await db.commit()

    logger.info("chat_session_deleted", session_id=str(session_id))


@router.post("/{session_id}/export", response_model=ChatSessionExportResponse)
async def export_chat_to_document(
    case_id: uuid.UUID,
    session_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> ChatSessionExportResponse:
    """
    Export a chat session as a document in the 'Discussion with Assistant' section.
    Creates a Document record with the conversation transcript as raw_ocr_text.
    """
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.case_id == case_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    await db.refresh(session, ["messages"])

    if not session.messages:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Cannot export an empty chat session.",
        )

    transcript = _format_transcript(session)
    title = session.title or "Discussion with Assistant"
    filename = f"{title[:80]}.txt"
    safe_filename = "".join(
        c if c.isalnum() or c in " .-_()" else "_" for c in filename
    )

    # Write transcript to disk
    chat_dir = STORAGE_ROOT / "cases" / str(case_id) / "chats"
    chat_dir.mkdir(parents=True, exist_ok=True)
    file_path = chat_dir / f"{session_id}.txt"
    file_path.write_text(transcript, encoding="utf-8")

    # Determine next sort_order in the section
    max_sort = (
        await db.execute(
            select(func.max(Document.sort_order)).where(
                Document.case_id == case_id,
                Document.section_label == "Discussion with Assistant",
            )
        )
    ).scalar_one_or_none() or 0

    doc = Document(
        case_id=case_id,
        storage_uri=str(file_path),
        file_type="txt",
        original_filename=safe_filename,
        section_label="Discussion with Assistant",
        sort_order=max_sort + 1,
        status=DocStatus.COMPLETED.value,
        raw_ocr_text=transcript,
        ocr_method="generated",
        display_title=title,
        summary=f"AI assistant conversation: {title}",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    logger.info(
        "chat_exported_to_document",
        session_id=str(session_id),
        document_id=str(doc.id),
    )
    return ChatSessionExportResponse(
        document_id=str(doc.id),
        message=f"Chat exported to Documents under 'Discussion with Assistant'.",
    )
