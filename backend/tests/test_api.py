"""
Backend test suite – comprehensive tests for auth, CRUD, RBAC, services, and core services.
Uses pytest with async SQLite backend for isolation.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.client import Client
from app.models.case import Case, CaseUserLink, CaseUserRole, CaseStatus
from app.models.document import Document
from app.models.communication import Communication, CommType
from app.models.timeline_event import TimelineEvent

# ── Test Database Setup ──────────────────────────────────
TEST_DATABASE_URL = "sqlite+aiosqlite:///./storage/test.db"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
test_session_factory = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def override_get_db():
    async with test_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create tables before each test, drop after.
    Also patches async_session_factory so background tasks (OCR pipeline)
    use the test database instead of the production one."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    with (
        patch("app.core.database.async_session_factory", test_session_factory),
        patch("app.services.ocr_service.async_session_factory", test_session_factory),
    ):
        yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    """Async HTTP client for testing FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def db_session():
    """Direct DB session for test setup."""
    async with test_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    """Register a user and return auth headers."""
    await client.post(
        "/api/auth/register",
        json={"email": "testuser@example.com", "password": "securepass123"},
    )
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "testuser@example.com", "password": "securepass123"},
    )
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def test_client_and_case(
    client: AsyncClient, auth_headers: dict[str, str]
) -> dict:
    """Create a client and a case, return their IDs."""
    # Create client
    client_resp = await client.post(
        "/api/clients",
        json={
            "name": "John Doe",
            "contact_info": {"email": "john@example.com", "phone": "+15551234567"},
        },
        headers=auth_headers,
    )
    client_data = client_resp.json()

    # Create case
    case_resp = await client.post(
        "/api/cases",
        json={
            "client_id": client_data["id"],
            "title": "Doe v. Smith - Contract Dispute",
            "description": "Commercial contract dispute involving breach of terms.",
        },
        headers=auth_headers,
    )
    case_data = case_resp.json()

    return {
        "client_id": client_data["id"],
        "case_id": case_data["id"],
    }


# ══════════════════════════════════════════════════════════
#  AUTH TESTS
# ══════════════════════════════════════════════════════════


class TestAuth:
    @pytest.mark.asyncio
    async def test_register_user(self, client: AsyncClient):
        response = await client.post(
            "/api/auth/register",
            json={"email": "test@example.com", "password": "testpass123"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "test@example.com"
        assert "id" in data
        assert data["is_active"] is True
        assert data["mfa_enabled"] is False

    @pytest.mark.asyncio
    async def test_register_duplicate_user(self, client: AsyncClient):
        await client.post(
            "/api/auth/register",
            json={"email": "dup@example.com", "password": "testpass123"},
        )
        response = await client.post(
            "/api/auth/register",
            json={"email": "dup@example.com", "password": "otherpass123"},
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_register_short_password(self, client: AsyncClient):
        response = await client.post(
            "/api/auth/register",
            json={"email": "short@example.com", "password": "short"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_register_invalid_email(self, client: AsyncClient):
        response = await client.post(
            "/api/auth/register",
            json={"email": "not-an-email", "password": "testpass123"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient):
        await client.post(
            "/api/auth/register",
            json={"email": "login@example.com", "password": "testpass123"},
        )
        response = await client.post(
            "/api/auth/login",
            json={"email": "login@example.com", "password": "testpass123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient):
        await client.post(
            "/api/auth/register",
            json={"email": "wrong@example.com", "password": "testpass123"},
        )
        response = await client.post(
            "/api/auth/login",
            json={"email": "wrong@example.com", "password": "wrongpassword"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client: AsyncClient):
        response = await client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "testpass123"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_me(self, client: AsyncClient, auth_headers: dict):
        response = await client.get("/api/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["email"] == "testuser@example.com"

    @pytest.mark.asyncio
    async def test_get_me_no_token(self, client: AsyncClient):
        response = await client.get("/api/auth/me")
        assert response.status_code in (
            401,
            403,
        )  # HTTPBearer returns 401 or 403 depending on FastAPI version

    @pytest.mark.asyncio
    async def test_get_me_invalid_token(self, client: AsyncClient):
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalidtoken123"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token(self, client: AsyncClient):
        await client.post(
            "/api/auth/register",
            json={"email": "refresh@example.com", "password": "testpass123"},
        )
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": "refresh@example.com", "password": "testpass123"},
        )
        refresh_token = login_resp.json()["refresh_token"]

        response = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_refresh_with_access_token_fails(self, client: AsyncClient):
        await client.post(
            "/api/auth/register",
            json={"email": "ref2@example.com", "password": "testpass123"},
        )
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": "ref2@example.com", "password": "testpass123"},
        )
        access_token = login_resp.json()["access_token"]

        response = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": access_token},
        )
        assert response.status_code == 401


# ══════════════════════════════════════════════════════════
#  CLIENT CRUD TESTS
# ══════════════════════════════════════════════════════════


class TestClients:
    @pytest.mark.asyncio
    async def test_create_client(self, client: AsyncClient, auth_headers: dict):
        response = await client.post(
            "/api/clients",
            json={"name": "Jane Client", "contact_info": {"email": "jane@example.com"}},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Jane Client"
        assert data["contact_info"]["email"] == "jane@example.com"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_list_clients(self, client: AsyncClient, auth_headers: dict):
        # Create two clients
        await client.post(
            "/api/clients", json={"name": "Client A"}, headers=auth_headers
        )
        await client.post(
            "/api/clients", json={"name": "Client B"}, headers=auth_headers
        )

        response = await client.get("/api/clients", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_get_client(self, client: AsyncClient, auth_headers: dict):
        create_resp = await client.post(
            "/api/clients", json={"name": "Single Client"}, headers=auth_headers
        )
        client_id = create_resp.json()["id"]

        response = await client.get(f"/api/clients/{client_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["name"] == "Single Client"

    @pytest.mark.asyncio
    async def test_get_nonexistent_client(
        self, client: AsyncClient, auth_headers: dict
    ):
        fake_id = str(uuid.uuid4())
        response = await client.get(f"/api/clients/{fake_id}", headers=auth_headers)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_client(self, client: AsyncClient, auth_headers: dict):
        create_resp = await client.post(
            "/api/clients", json={"name": "Old Name"}, headers=auth_headers
        )
        client_id = create_resp.json()["id"]

        response = await client.patch(
            f"/api/clients/{client_id}",
            json={"name": "New Name"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"

    @pytest.mark.asyncio
    async def test_clients_require_auth(self, client: AsyncClient):
        response = await client.get("/api/clients")
        assert response.status_code in (
            401,
            403,
        )  # HTTPBearer returns 401 or 403 depending on FastAPI version


# ══════════════════════════════════════════════════════════
#  CASE CRUD + RBAC TESTS
# ══════════════════════════════════════════════════════════


class TestCases:
    @pytest.mark.asyncio
    async def test_create_case(self, client: AsyncClient, auth_headers: dict):
        # Create client first
        client_resp = await client.post(
            "/api/clients", json={"name": "Case Client"}, headers=auth_headers
        )
        client_id = client_resp.json()["id"]

        response = await client.post(
            "/api/cases",
            json={
                "client_id": client_id,
                "title": "Test Case",
                "description": "A test case.",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Test Case"
        assert data["status"] == "OPEN"
        assert data["client_id"] == client_id

    @pytest.mark.asyncio
    async def test_create_case_nonexistent_client(
        self, client: AsyncClient, auth_headers: dict
    ):
        fake_client_id = str(uuid.uuid4())
        response = await client.post(
            "/api/cases",
            json={"client_id": fake_client_id, "title": "Bad Case"},
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_list_cases(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        response = await client.get("/api/cases", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert data[0]["title"] == "Doe v. Smith - Contract Dispute"

    @pytest.mark.asyncio
    async def test_get_case_detail(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.get(f"/api/cases/{case_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Doe v. Smith - Contract Dispute"
        assert "client" in data
        assert data["document_count"] == 0
        assert data["communication_count"] == 0
        assert data["timeline_event_count"] == 0

    @pytest.mark.asyncio
    async def test_update_case(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.patch(
            f"/api/cases/{case_id}",
            json={"title": "Updated Title", "status": "IN_PROGRESS"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
        assert data["status"] == "IN_PROGRESS"

    @pytest.mark.asyncio
    async def test_case_rbac_no_access(
        self, client: AsyncClient, test_client_and_case: dict
    ):
        """A different user should not access the case."""
        # Register a second user
        await client.post(
            "/api/auth/register",
            json={"email": "other@example.com", "password": "securepass123"},
        )
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": "other@example.com", "password": "securepass123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        case_id = test_client_and_case["case_id"]
        response = await client.get(f"/api/cases/{case_id}", headers=other_headers)
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_grant_case_access(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        """Owner should be able to grant access to another user."""
        # Register a second user
        reg_resp = await client.post(
            "/api/auth/register",
            json={"email": "viewer@example.com", "password": "securepass123"},
        )
        viewer_id = reg_resp.json()["id"]

        case_id = test_client_and_case["case_id"]
        response = await client.post(
            f"/api/cases/{case_id}/access",
            json={"user_id": viewer_id, "role": "VIEWER"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["role"] == "VIEWER"

        # Now the viewer should be able to access the case
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": "viewer@example.com", "password": "securepass123"},
        )
        viewer_headers = {
            "Authorization": f"Bearer {login_resp.json()['access_token']}"
        }
        get_resp = await client.get(f"/api/cases/{case_id}", headers=viewer_headers)
        assert get_resp.status_code == 200

    @pytest.mark.asyncio
    async def test_grant_duplicate_access(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        reg_resp = await client.post(
            "/api/auth/register",
            json={"email": "dup_access@example.com", "password": "securepass123"},
        )
        viewer_id = reg_resp.json()["id"]
        case_id = test_client_and_case["case_id"]

        await client.post(
            f"/api/cases/{case_id}/access",
            json={"user_id": viewer_id, "role": "VIEWER"},
            headers=auth_headers,
        )
        # Try again
        response = await client.post(
            f"/api/cases/{case_id}/access",
            json={"user_id": viewer_id, "role": "ATTORNEY"},
            headers=auth_headers,
        )
        assert response.status_code == 409


# ══════════════════════════════════════════════════════════
#  DOCUMENT ENDPOINT TESTS
# ══════════════════════════════════════════════════════════


class TestDocuments:
    @pytest.mark.asyncio
    async def test_list_documents_empty(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.get(
            f"/api/cases/{case_id}/documents", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_upload_unsupported_type(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.post(
            f"/api/upload?case_id={case_id}",
            files={"file": ("test.txt", b"hello world", "text/plain")},
            headers=auth_headers,
        )
        assert response.status_code == 415

    @pytest.mark.asyncio
    async def test_upload_document_success(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        # Upload a small PDF-like file (content doesn't need to be a real PDF for the endpoint test)
        response = await client.post(
            f"/api/upload?case_id={case_id}",
            files={"file": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
            headers=auth_headers,
        )
        assert response.status_code == 202
        data = response.json()
        assert "id" in data
        assert data["processing"] is True

    @pytest.mark.asyncio
    async def test_documents_require_case_access(
        self, client: AsyncClient, test_client_and_case: dict
    ):
        # Register different user
        await client.post(
            "/api/auth/register",
            json={"email": "noaccess@example.com", "password": "securepass123"},
        )
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": "noaccess@example.com", "password": "securepass123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        case_id = test_client_and_case["case_id"]
        response = await client.get(
            f"/api/cases/{case_id}/documents", headers=other_headers
        )
        assert response.status_code == 403


# ══════════════════════════════════════════════════════════
#  COMMUNICATION ENDPOINT TESTS
# ══════════════════════════════════════════════════════════


class TestCommunications:
    @pytest.mark.asyncio
    async def test_list_communications_empty(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.get(
            f"/api/cases/{case_id}/communications", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_create_communication(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        now = datetime.now(timezone.utc).isoformat()
        response = await client.post(
            f"/api/cases/{case_id}/communications",
            json={
                "case_id": case_id,
                "comm_type": "NOTE",
                "timestamp": now,
                "sender": "Attorney",
                "subject": "Client meeting notes",
                "transcript_body": "Discussed contract terms with the client.",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["comm_type"] == "NOTE"
        assert data["subject"] == "Client meeting notes"

    @pytest.mark.asyncio
    async def test_create_communication_case_id_mismatch(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        fake_case_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        response = await client.post(
            f"/api/cases/{case_id}/communications",
            json={
                "case_id": fake_case_id,
                "comm_type": "NOTE",
                "timestamp": now,
                "transcript_body": "test",
            },
            headers=auth_headers,
        )
        assert response.status_code == 400


# ══════════════════════════════════════════════════════════
#  TIMELINE ENDPOINT TESTS
# ══════════════════════════════════════════════════════════


class TestTimeline:
    @pytest.mark.asyncio
    async def test_list_timeline_empty(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.get(
            f"/api/cases/{case_id}/timeline", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_timeline_with_confidence_filter(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        response = await client.get(
            f"/api/cases/{case_id}/timeline?min_confidence=0.8",
            headers=auth_headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_nonexistent_timeline_event(
        self, client: AsyncClient, auth_headers: dict, test_client_and_case: dict
    ):
        case_id = test_client_and_case["case_id"]
        fake_event_id = str(uuid.uuid4())
        response = await client.get(
            f"/api/cases/{case_id}/timeline/{fake_event_id}",
            headers=auth_headers,
        )
        assert response.status_code == 404


# ══════════════════════════════════════════════════════════
#  SECURITY UNIT TESTS
# ══════════════════════════════════════════════════════════


class TestSecurity:
    def test_password_hash_and_verify(self):
        hashed = hash_password("mysecretpassword")
        assert hashed != "mysecretpassword"
        assert verify_password("mysecretpassword", hashed)
        assert not verify_password("wrongpassword", hashed)

    def test_create_and_decode_access_token(self):
        user_id = uuid.uuid4()
        token = create_access_token(user_id)
        payload = decode_token(token)
        assert payload["sub"] == str(user_id)
        assert payload["type"] == "access"

    def test_create_and_decode_refresh_token(self):
        user_id = uuid.uuid4()
        token = create_refresh_token(user_id)
        payload = decode_token(token)
        assert payload["sub"] == str(user_id)
        assert payload["type"] == "refresh"

    def test_decode_invalid_token_raises(self):
        from jose import JWTError

        with pytest.raises(JWTError):
            decode_token("not-a-valid-jwt-token")


# ══════════════════════════════════════════════════════════
#  ENCRYPTION UNIT TESTS
# ══════════════════════════════════════════════════════════


class TestEncryption:
    def test_encrypt_and_decrypt(self):
        from app.utils.encryption import encrypt_bytes, decrypt_bytes

        plaintext = b"This is a secret document content."
        encrypted = encrypt_bytes(plaintext)
        assert encrypted != plaintext
        assert len(encrypted) > len(plaintext)  # nonce + tag + ciphertext

        decrypted = decrypt_bytes(encrypted)
        assert decrypted == plaintext

    def test_encrypt_empty_bytes(self):
        from app.utils.encryption import encrypt_bytes, decrypt_bytes

        plaintext = b""
        encrypted = encrypt_bytes(plaintext)
        decrypted = decrypt_bytes(encrypted)
        assert decrypted == plaintext

    def test_decrypt_with_tampered_data_fails(self):
        from app.utils.encryption import encrypt_bytes, decrypt_bytes

        plaintext = b"Sensitive data"
        encrypted = encrypt_bytes(plaintext)
        # Tamper with the ciphertext
        tampered = encrypted[:-1] + bytes([encrypted[-1] ^ 0xFF])
        with pytest.raises(Exception):
            decrypt_bytes(tampered)


# ══════════════════════════════════════════════════════════
#  SERVICE UNIT TESTS
# ══════════════════════════════════════════════════════════


class TestVectorizationService:
    def test_chunk_text_short(self):
        from app.services.vectorization_service import _chunk_text

        text = "Short text."
        chunks = _chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == "Short text."

    def test_chunk_text_empty(self):
        from app.services.vectorization_service import _chunk_text

        assert _chunk_text("") == []
        assert _chunk_text("   ") == []

    def test_chunk_text_long(self):
        from app.services.vectorization_service import _chunk_text

        text = "A" * 5000
        chunks = _chunk_text(text, chunk_size=800, overlap=200)
        assert len(chunks) > 1
        # Verify chunks cover the text
        for chunk in chunks:
            assert len(chunk) <= 800

    def test_pseudo_embeddings(self):
        from app.services.llm_provider import _generate_pseudo_embeddings

        texts = ["Hello world", "Another document"]
        embeddings = _generate_pseudo_embeddings(texts)
        assert len(embeddings) == 2
        assert len(embeddings[0]) == 1536
        assert all(-1 <= v <= 1 for v in embeddings[0])

    def test_pseudo_embeddings_deterministic(self):
        from app.services.llm_provider import _generate_pseudo_embeddings

        texts = ["Same text"]
        e1 = _generate_pseudo_embeddings(texts)
        e2 = _generate_pseudo_embeddings(texts)
        assert e1 == e2


class TestExtractionService:
    def test_parse_llm_response_valid_array(self):
        from app.services.extraction_service import _parse_llm_response

        raw = json.dumps(
            [
                {
                    "absolute_date": "2024-01-15",
                    "description": "Contract signed",
                    "confidence": 0.95,
                },
                {
                    "absolute_date": "2024-02-01",
                    "description": "First payment due",
                    "confidence": 0.8,
                },
            ]
        )
        events = _parse_llm_response(raw)
        assert len(events) == 2
        assert events[0].description == "Contract signed"
        assert events[0].confidence == 0.95

    def test_parse_llm_response_wrapped_object(self):
        from app.services.extraction_service import _parse_llm_response

        raw = json.dumps(
            {
                "events": [
                    {
                        "absolute_date": "2024-03-10",
                        "description": "Hearing date",
                        "confidence": 0.9,
                    },
                ]
            }
        )
        events = _parse_llm_response(raw)
        assert len(events) == 1
        assert events[0].description == "Hearing date"

    def test_parse_llm_response_markdown_fenced(self):
        from app.services.extraction_service import _parse_llm_response

        raw = '```json\n[{"absolute_date": "2024-05-01", "description": "Filing deadline", "confidence": 0.7}]\n```'
        events = _parse_llm_response(raw)
        assert len(events) == 1

    def test_parse_llm_response_empty(self):
        from app.services.extraction_service import _parse_llm_response

        events = _parse_llm_response("[]")
        assert len(events) == 0

    def test_parse_llm_response_invalid_json(self):
        from app.services.extraction_service import _parse_llm_response

        events = _parse_llm_response("This is not JSON at all")
        assert len(events) == 0

    def test_parse_llm_response_invalid_event_skipped(self):
        from app.services.extraction_service import _parse_llm_response

        raw = json.dumps(
            [
                {
                    "absolute_date": "2024-01-15",
                    "description": "Good event",
                    "confidence": 0.9,
                },
                {
                    "absolute_date": "not-a-date-at-all-xyz",
                    "description": "Bad event",
                    "confidence": 0.5,
                },
            ]
        )
        events = _parse_llm_response(raw)
        assert len(events) == 1  # Bad event should be skipped

    def test_parse_date_to_datetime(self):
        from app.services.extraction_service import _parse_date_to_datetime

        dt = _parse_date_to_datetime("2024-06-15")
        assert dt.year == 2024
        assert dt.month == 6
        assert dt.day == 15
        assert dt.tzinfo is not None

    def test_parse_date_to_datetime_iso(self):
        from app.services.extraction_service import _parse_date_to_datetime

        dt = _parse_date_to_datetime("2024-06-15T14:30:00+00:00")
        assert dt.hour == 14
        assert dt.minute == 30

    def test_build_user_prompt(self):
        from app.services.extraction_service import _build_user_prompt

        prompt = _build_user_prompt("Some legal text here", "2024-01-01T00:00:00Z")
        assert "Some legal text here" in prompt
        assert "2024-01-01T00:00:00Z" in prompt

    def test_build_user_prompt_no_context(self):
        from app.services.extraction_service import _build_user_prompt

        prompt = _build_user_prompt("Some legal text here", None)
        assert "Some legal text here" in prompt
        assert "Timestamp context" not in prompt


# ══════════════════════════════════════════════════════════
#  HEALTH CHECK
# ══════════════════════════════════════════════════════════


class TestHealthCheck:
    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "1.0.0"
