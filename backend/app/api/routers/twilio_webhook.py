"""
Twilio telephony webhook router.
Receives Twilio Conversational Intelligence JSON payloads upon call completion,
extracts real-time transcription, maps to client/case, and logs to CommunicationModel.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import DBSession
from app.core.logging import get_logger
from app.models.case import Case
from app.models.client import Client
from app.models.communication import CommType, Communication
from app.services.vectorization_service import vectorize_text
from app.services.extraction_service import extract_timeline_events

logger = get_logger("twilio_webhook")
router = APIRouter(prefix="/api/webhooks", tags=["Webhooks"])


# ── Twilio Payload Schemas ──────────────────────────────
class TwilioTranscriptSegment(BaseModel):
    text: str = ""
    speaker: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    confidence: float | None = None


class TwilioConversationPayload(BaseModel):
    """
    Represents a Twilio Conversational Intelligence callback payload.
    Simplified for the fields we need.
    """

    account_sid: str = Field(alias="AccountSid", default="")
    call_sid: str = Field(alias="CallSid", default="")
    from_number: str = Field(alias="From", default="")
    to_number: str = Field(alias="To", default="")
    call_status: str = Field(alias="CallStatus", default="completed")
    timestamp: str | None = Field(alias="Timestamp", default=None)
    transcript: list[TwilioTranscriptSegment] | None = None
    transcript_text: str | None = Field(alias="TranscriptText", default=None)

    model_config = {"populate_by_name": True}


async def _validate_twilio_signature(request: Request) -> None:
    """
    Validate the Twilio webhook signature if auth_token is configured.
    Skips validation in development when no token is set.
    """
    if not settings.twilio_auth_token:
        logger.warning(
            "twilio_auth_token_not_set", detail="skipping signature validation"
        )
        return

    try:
        from twilio.request_validator import RequestValidator

        validator = RequestValidator(settings.twilio_auth_token)
        signature = request.headers.get("X-Twilio-Signature", "")
        # Reconstruct the full URL Twilio used
        url = str(request.url)
        # For form data, use the form params; for JSON, use empty dict
        try:
            form_data = await request.form()
            params = dict(form_data)
        except Exception:
            params = {}

        if not validator.validate(url, params, signature):
            logger.error("twilio_signature_validation_failed")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid Twilio webhook signature.",
            )
    except ImportError:
        logger.warning(
            "twilio_sdk_not_available", detail="skipping signature validation"
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("twilio_signature_validation_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Webhook signature validation failed.",
        )


async def _match_case_by_phone(
    phone_number: str, db
) -> tuple[Case | None, Client | None]:
    """
    Match a phone number to a client and their most recent case.
    Searches client contact_info for phone number matches.
    """
    # Normalize: strip non-digit except leading +
    normalized = phone_number.strip()

    result = await db.execute(select(Client))
    clients = result.scalars().all()

    for client in clients:
        contact = client.contact_info or {}
        client_phones: list[str] = []

        if isinstance(contact.get("phone"), str):
            client_phones.append(contact["phone"].strip())
        if isinstance(contact.get("phones"), list):
            client_phones.extend(
                [p.strip() for p in contact["phones"] if isinstance(p, str)]
            )

        # Check if normalized phone matches any client phone
        for cp in client_phones:
            if normalized.endswith(cp[-10:]) or cp.endswith(normalized[-10:]):
                # Found a match – get the most recent case
                case_result = await db.execute(
                    select(Case)
                    .where(Case.client_id == client.id)
                    .order_by(Case.created_at.desc())
                    .limit(1)
                )
                case = case_result.scalar_one_or_none()
                return case, client

    return None, None


@router.post("/twilio", status_code=status.HTTP_202_ACCEPTED)
async def receive_twilio_webhook(request: Request, db: DBSession) -> dict:
    """
    Receive Twilio Conversational Intelligence JSON payloads.
    Upon call completion:
    1. Extract the real-time transcription.
    2. Identify the client via phone number mapping.
    3. Associate with the correct CaseModel.
    4. Log the transcript into CommunicationModel.
    5. Trigger vectorization and timeline extraction.
    """
    await _validate_twilio_signature(request)

    try:
        raw_json = await request.json()
    except Exception as exc:
        # Try form-encoded data (Twilio often sends as form)
        try:
            form_data = await request.form()
            raw_json = dict(form_data)
        except Exception:
            logger.error("twilio_payload_parse_error", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to parse Twilio payload.",
            )

    logger.info("twilio_webhook_received", payload_keys=list(raw_json.keys()))

    # Parse payload – handle both JSON and form-encoded
    try:
        payload = TwilioConversationPayload.model_validate(raw_json)
    except Exception as exc:
        logger.error("twilio_payload_validation_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid Twilio payload format: {str(exc)}",
        )

    # Build full transcript text
    transcript_text: str = ""
    if payload.transcript_text:
        transcript_text = payload.transcript_text
    elif payload.transcript:
        segments: list[str] = []
        for seg in payload.transcript:
            speaker = seg.speaker or "Unknown"
            segments.append(f"[{speaker}]: {seg.text}")
        transcript_text = "\n".join(segments)

    if not transcript_text.strip():
        logger.warning(
            "twilio_empty_transcript",
            call_sid=payload.call_sid,
        )
        return {
            "status": "accepted",
            "message": "No transcript text in payload.",
            "call_sid": payload.call_sid,
        }

    # Determine call timestamp
    call_timestamp: datetime
    if payload.timestamp:
        try:
            call_timestamp = datetime.fromisoformat(payload.timestamp)
            if call_timestamp.tzinfo is None:
                call_timestamp = call_timestamp.replace(tzinfo=timezone.utc)
        except ValueError:
            call_timestamp = datetime.now(timezone.utc)
    else:
        call_timestamp = datetime.now(timezone.utc)

    # Match caller phone to a client/case
    from_number = payload.from_number
    to_number = payload.to_number

    case, client = await _match_case_by_phone(from_number, db)
    if case is None:
        case, client = await _match_case_by_phone(to_number, db)

    if case is None:
        logger.warning(
            "twilio_case_not_matched",
            from_number=from_number,
            to_number=to_number,
            call_sid=payload.call_sid,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not match this call to any existing case. "
            "Register the caller's phone number in a client profile.",
        )

    # Save communication record
    communication = Communication(
        case_id=case.id,
        comm_type=CommType.CALL,
        timestamp=call_timestamp,
        sender=from_number,
        recipient=to_number,
        subject=f"Phone call – {payload.call_sid}",
        transcript_body=transcript_text,
        is_vectorized=False,
    )
    db.add(communication)
    await db.flush()
    await db.refresh(communication)

    logger.info(
        "twilio_communication_saved",
        communication_id=str(communication.id),
        case_id=str(case.id),
        call_sid=payload.call_sid,
        transcript_length=len(transcript_text),
    )

    # Downstream: vectorize and extract timeline events
    if transcript_text.strip():
        try:
            await vectorize_text(
                text=transcript_text,
                source_id=str(communication.id),
                source_type="communication",
                case_id=str(case.id),
            )

            communication.is_vectorized = True
            await db.flush()

            await extract_timeline_events(
                text_payload=transcript_text,
                timestamp_context=call_timestamp.isoformat(),
                case_id=case.id,
                source_id=communication.id,
                source_type="communication",
            )
        except Exception as exc:
            logger.error(
                "twilio_post_processing_error",
                communication_id=str(communication.id),
                error=str(exc),
            )

    return {
        "status": "accepted",
        "communication_id": str(communication.id),
        "case_id": str(case.id),
        "call_sid": payload.call_sid,
        "transcript_length": len(transcript_text),
    }
