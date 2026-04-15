"""
Client and Case CRUD routers with RBAC enforcement.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DBSession, require_case_access
from app.core.logging import get_logger
from app.models.case import Case, CaseUserLink, CaseUserRole
from app.models.client import Client
from app.models.communication import Communication
from app.models.document import Document
from app.models.timeline_event import TimelineEvent
from app.schemas.case import (
    CaseCreate,
    CaseDetailResponse,
    CaseResponse,
    CaseUpdate,
    CaseUserLinkCreate,
    CaseUserLinkResponse,
    ClientCreate,
    ClientResponse,
    ClientUpdate,
)
from app.services.vectorization_service import delete_vectors_by_source

logger = get_logger("cases_router")

# ── Client Router ────────────────────────────────────────
client_router = APIRouter(prefix="/api/clients", tags=["Clients"])


@client_router.post(
    "",
    response_model=ClientResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_client(
    body: ClientCreate,
    db: DBSession,
    user: CurrentUser,
) -> ClientResponse:
    """Create a new client record."""
    client = Client(name=body.name, contact_info=body.contact_info)
    db.add(client)
    await db.flush()
    await db.refresh(client)
    logger.info("client_created", client_id=str(client.id), by_user=str(user.id))
    return ClientResponse.model_validate(client)


@client_router.get("", response_model=list[ClientResponse])
async def list_clients(
    db: DBSession,
    user: CurrentUser,
    skip: int = 0,
    limit: int = 50,
) -> list[ClientResponse]:
    """List all clients (paginated)."""
    result = await db.execute(
        select(Client).order_by(Client.name).offset(skip).limit(limit)
    )
    return [ClientResponse.model_validate(c) for c in result.scalars().all()]


@client_router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> ClientResponse:
    """Retrieve a single client by ID."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found.")
    return ClientResponse.model_validate(client)


@client_router.patch("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: uuid.UUID,
    body: ClientUpdate,
    db: DBSession,
    user: CurrentUser,
) -> ClientResponse:
    """Update a client's information."""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found.")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(client, field, value)

    await db.flush()
    await db.refresh(client)
    return ClientResponse.model_validate(client)


# ── Case Router ──────────────────────────────────────────
case_router = APIRouter(prefix="/api/cases", tags=["Cases"])


@case_router.post(
    "",
    response_model=CaseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    body: CaseCreate,
    db: DBSession,
    user: CurrentUser,
) -> CaseResponse:
    """Create a new case and automatically grant the creator OWNER role."""
    # Verify client exists
    client_result = await db.execute(select(Client).where(Client.id == body.client_id))
    if client_result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found.")

    case = Case(
        client_id=body.client_id,
        title=body.title,
        description=body.description,
        status=body.status,
        filing_date=body.filing_date,
    )
    db.add(case)
    await db.flush()

    # Grant OWNER role to the creator
    link = CaseUserLink(case_id=case.id, user_id=user.id, role=CaseUserRole.OWNER)
    db.add(link)
    await db.flush()
    await db.refresh(case)

    logger.info("case_created", case_id=str(case.id), by_user=str(user.id))
    return CaseResponse.model_validate(case)


@case_router.get("", response_model=list[CaseResponse])
async def list_cases(
    db: DBSession,
    user: CurrentUser,
    skip: int = 0,
    limit: int = 50,
) -> list[CaseResponse]:
    """List all cases accessible to the current user."""
    stmt = (
        select(Case)
        .join(CaseUserLink, CaseUserLink.case_id == Case.id)
        .where(CaseUserLink.user_id == user.id)
        .order_by(Case.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [CaseResponse.model_validate(c) for c in result.scalars().all()]


@case_router.get("/{case_id}", response_model=CaseDetailResponse)
async def get_case(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> CaseDetailResponse:
    """Get detailed info for a single case (with RBAC check)."""
    await require_case_access(case_id, user, db)

    result = await db.execute(
        select(Case).options(selectinload(Case.client)).where(Case.id == case_id)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Case not found.")

    # Aggregate counts
    doc_count = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(Document.case_id == case_id)
        )
    ).scalar() or 0

    comm_count = (
        await db.execute(
            select(func.count())
            .select_from(Communication)
            .where(Communication.case_id == case_id)
        )
    ).scalar() or 0

    event_count = (
        await db.execute(
            select(func.count())
            .select_from(TimelineEvent)
            .where(TimelineEvent.case_id == case_id)
        )
    ).scalar() or 0

    return CaseDetailResponse(
        **CaseResponse.model_validate(case).model_dump(),
        client=ClientResponse.model_validate(case.client),
        document_count=doc_count,
        communication_count=comm_count,
        timeline_event_count=event_count,
    )


@case_router.patch("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: uuid.UUID,
    body: CaseUpdate,
    db: DBSession,
    user: CurrentUser,
) -> CaseResponse:
    """Update case details (OWNER or ATTORNEY only)."""
    await require_case_access(
        case_id, user, db, required_roles=[CaseUserRole.OWNER, CaseUserRole.ATTORNEY]
    )

    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Case not found.")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(case, field, value)

    await db.flush()
    await db.refresh(case)
    return CaseResponse.model_validate(case)


@case_router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: uuid.UUID,
    db: DBSession,
    user: CurrentUser,
) -> None:
    """Delete a case and all cascading related records."""
    await require_case_access(case_id, user, db, required_roles=[CaseUserRole.OWNER])

    result = await db.execute(select(Case).where(Case.id == case_id))
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Case not found.")

    documents = (
        (await db.execute(select(Document).where(Document.case_id == case_id)))
        .scalars()
        .all()
    )
    communications = (
        (
            await db.execute(
                select(Communication).where(Communication.case_id == case_id)
            )
        )
        .scalars()
        .all()
    )

    for document in documents:
        try:
            delete_vectors_by_source(str(document.id))
        except Exception:
            logger.warning(
                "case_document_vector_cleanup_failed", document_id=str(document.id)
            )

    for communication in communications:
        try:
            delete_vectors_by_source(str(communication.id))
        except Exception:
            logger.warning(
                "case_communication_vector_cleanup_failed",
                communication_id=str(communication.id),
            )

    for document in documents:
        file_path = settings.upload_path / document.storage_uri
        try:
            if file_path.exists():
                file_path.unlink()
        except OSError as exc:
            logger.warning(
                "case_document_file_delete_failed",
                document_id=str(document.id),
                path=str(file_path),
                error=str(exc),
            )

    case_title = case.title
    await db.delete(case)
    await db.flush()

    case_dir = settings.upload_path / str(case_id)
    try:
        if case_dir.exists() and not any(case_dir.iterdir()):
            case_dir.rmdir()
    except OSError as exc:
        logger.warning(
            "case_upload_dir_cleanup_failed",
            case_id=str(case_id),
            path=str(case_dir),
            error=str(exc),
        )

    logger.info("case_deleted", case_id=str(case_id), title=case_title)


@case_router.post(
    "/{case_id}/access",
    response_model=CaseUserLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def grant_case_access(
    case_id: uuid.UUID,
    body: CaseUserLinkCreate,
    db: DBSession,
    user: CurrentUser,
) -> CaseUserLinkResponse:
    """Grant a user access to a case (OWNER only)."""
    await require_case_access(case_id, user, db, required_roles=[CaseUserRole.OWNER])

    # Check if link already exists
    existing = await db.execute(
        select(CaseUserLink).where(
            CaseUserLink.case_id == case_id,
            CaseUserLink.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="User already has access to this case."
        )

    link = CaseUserLink(case_id=case_id, user_id=body.user_id, role=body.role)
    db.add(link)
    await db.flush()
    await db.refresh(link)
    logger.info(
        "case_access_granted",
        case_id=str(case_id),
        target_user=str(body.user_id),
        role=body.role.value,
    )
    return CaseUserLinkResponse.model_validate(link)
