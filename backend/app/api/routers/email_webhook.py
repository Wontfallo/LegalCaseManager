"""
Email ingestion webhook router.
Accepts raw EML/MIME byte payloads, parses headers, body, and attachments.
Maps emails to cases via sender matching or subject reference IDs.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import mailparser
from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.deps import DBSession
from app.core.logging import get_logger
from app.models.case import Case
from app.models.client import Client
from app.models.communication import CommType, Communication
from app.services.vectorization_service import vectorize_text
from app.services.extraction_service import extract_timeline_events

logger = get_logger("email_webhook")
router = APIRouter(prefix="/api/webhooks", tags=["Webhooks"])

# Regex to extract case reference ID from subject lines (e.g., "[CASE-<uuid>]")
CASE_REF_PATTERN = re.compile(
    r"\[CASE-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]"
)


async def _match_case_by_sender(sender_email: str, db) -> Case | None:
    """
    Attempt to match an email sender to a case via client contact_info.
    Searches client records for matching email addresses.
    """
    result = await db.execute(select(Client))
    clients = result.scalars().all()

    for client in clients:
        contact = client.contact_info or {}
        # Check various contact_info fields for email matches
        client_emails: list[str] = []
        if isinstance(contact.get("email"), str):
            client_emails.append(contact["email"].lower())
        if isinstance(contact.get("emails"), list):
            client_emails.extend(
                [e.lower() for e in contact["emails"] if isinstance(e, str)]
            )

        if sender_email.lower() in client_emails:
            # Return the most recent open case for this client
            case_result = await db.execute(
                select(Case)
                .where(Case.client_id == client.id)
                .order_by(Case.created_at.desc())
                .limit(1)
            )
            case = case_result.scalar_one_or_none()
            if case:
                return case

    return None


async def _match_case_by_subject(subject: str, db) -> Case | None:
    """Extract a case UUID reference from the email subject line."""
    match = CASE_REF_PATTERN.search(subject or "")
    if match:
        try:
            case_id = uuid.UUID(match.group(1))
            result = await db.execute(select(Case).where(Case.id == case_id))
            return result.scalar_one_or_none()
        except ValueError:
            return None
    return None


@router.post("/email", status_code=status.HTTP_202_ACCEPTED)
async def receive_email_webhook(request: Request, db: DBSession) -> dict:
    """
    Accept raw EML/MIME byte payloads from an email forwarding service.
    Parse the email, extract metadata and body, route attachments for OCR,
    and save the communication record linked to the matching case.
    """
    # Validate webhook secret if configured
    if settings.email_webhook_secret:
        provided_secret = request.headers.get("X-Webhook-Secret", "")
        if provided_secret != settings.email_webhook_secret:
            logger.error(
                "email_webhook_auth_failed",
                detail="invalid or missing X-Webhook-Secret header",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid webhook secret.",
            )

    try:
        raw_bytes = await request.body()
        if not raw_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty request body.",
            )
    except Exception as exc:
        logger.error("email_body_read_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read request body.",
        )

    # Parse MIME content
    try:
        mail = mailparser.parse_from_bytes(raw_bytes)
    except Exception as exc:
        logger.error("mime_parse_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse MIME content: {str(exc)}",
        )

    # Extract email metadata
    sender: str = ""
    if mail.from_:
        # mail.from_ returns list of tuples: [('Name', 'email@example.com')]
        sender_parts = mail.from_[0] if mail.from_ else ("", "")
        sender = sender_parts[1] if len(sender_parts) > 1 else str(sender_parts)

    recipient: str = ""
    if mail.to:
        recip_parts = mail.to[0] if mail.to else ("", "")
        recipient = recip_parts[1] if len(recip_parts) > 1 else str(recip_parts)

    subject: str = mail.subject or ""
    body_text: str = mail.body or ""

    # Determine timestamp
    email_date: datetime
    if mail.date:
        email_date = (
            mail.date if mail.date.tzinfo else mail.date.replace(tzinfo=timezone.utc)
        )
    else:
        email_date = datetime.now(timezone.utc)

    logger.info(
        "email_parsed",
        sender=sender,
        recipient=recipient,
        subject=subject[:100],
        body_length=len(body_text),
        attachment_count=len(mail.attachments) if mail.attachments else 0,
    )

    # Match to a case: first try subject reference ID, then sender matching
    case = await _match_case_by_subject(subject, db)
    if case is None:
        case = await _match_case_by_sender(sender, db)

    if case is None:
        logger.warning(
            "email_case_not_matched",
            sender=sender,
            subject=subject[:100],
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not match this email to any existing case. "
            "Include [CASE-<uuid>] in the subject or register the sender's email in a client profile.",
        )

    # Save communication record
    communication = Communication(
        case_id=case.id,
        comm_type=CommType.EMAIL,
        timestamp=email_date,
        sender=sender,
        recipient=recipient,
        subject=subject,
        transcript_body=body_text,
        is_vectorized=False,
    )
    db.add(communication)
    await db.flush()
    await db.refresh(communication)

    logger.info(
        "email_communication_saved",
        communication_id=str(communication.id),
        case_id=str(case.id),
    )

    # Process attachments for secondary OCR routing
    if mail.attachments:
        from app.services.ocr_service import process_document_ocr
        from app.core.config import settings
        import aiofiles

        for attachment in mail.attachments:
            filename = attachment.get("filename", "attachment")
            payload = attachment.get("payload", b"")
            content_type = attachment.get("mail_content_type", "")

            # Only process supported file types
            type_map = {
                "application/pdf": "pdf",
                "image/png": "png",
                "image/jpeg": "jpeg",
                "image/tiff": "tiff",
            }

            file_ext = type_map.get(content_type)
            if file_ext and payload:
                try:
                    import base64

                    if isinstance(payload, str):
                        file_bytes = base64.b64decode(payload)
                    else:
                        file_bytes = payload

                    file_id = uuid.uuid4()
                    storage_path = settings.upload_path / str(case.id)
                    storage_path.mkdir(parents=True, exist_ok=True)
                    full_path = storage_path / f"{file_id}.{file_ext}"

                    async with aiofiles.open(full_path, "wb") as f:
                        await f.write(file_bytes)

                    from app.models.document import Document

                    doc = Document(
                        case_id=case.id,
                        storage_uri=f"{case.id}/{file_id}.{file_ext}",
                        file_type=file_ext,
                        original_filename=filename,
                        is_vectorized=False,
                    )
                    db.add(doc)
                    await db.flush()
                    await db.refresh(doc)

                    # Background OCR – fire and forget
                    import asyncio

                    asyncio.create_task(
                        process_document_ocr(
                            document_id=doc.id,
                            file_path=str(full_path),
                            file_type=file_ext,
                            case_id=case.id,
                        )
                    )

                    logger.info(
                        "email_attachment_saved",
                        doc_id=str(doc.id),
                        filename=filename,
                    )
                except Exception as exc:
                    logger.error(
                        "email_attachment_processing_error",
                        filename=filename,
                        error=str(exc),
                    )

    # Downstream: vectorize email body and extract timeline events
    if body_text.strip():
        try:
            await vectorize_text(
                text=body_text,
                source_id=str(communication.id),
                source_type="communication",
                case_id=str(case.id),
            )

            communication.is_vectorized = True
            await db.flush()

            await extract_timeline_events(
                text_payload=body_text,
                timestamp_context=email_date.isoformat(),
                case_id=case.id,
                source_id=communication.id,
                source_type="communication",
            )
        except Exception as exc:
            logger.error(
                "email_post_processing_error",
                communication_id=str(communication.id),
                error=str(exc),
            )

    return {
        "status": "accepted",
        "communication_id": str(communication.id),
        "case_id": str(case.id),
        "attachments_processed": len(mail.attachments) if mail.attachments else 0,
    }
