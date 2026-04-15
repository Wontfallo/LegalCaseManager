"""
Seed data script – populates the database with realistic demo data.

Usage:
    cd backend
    python -m scripts.seed_data

Or via the venv:
    .venv/Scripts/python -m scripts.seed_data
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, init_db
from app.core.logging import get_logger, setup_logging
from app.core.security import hash_password
from app.models import (
    Base,
    Case,
    CaseStatus,
    CaseUserLink,
    CaseUserRole,
    Client,
    CommType,
    Communication,
    Document,
    TimelineEvent,
    User,
)

logger = get_logger("seed_data")


# ── Demo Users ──────────────────────────────────────────────
DEMO_USERS = [
    {"email": "admin@legalcm.demo", "password": "DemoPass123!"},
    {"email": "attorney@legalcm.demo", "password": "DemoPass123!"},
    {"email": "paralegal@legalcm.demo", "password": "DemoPass123!"},
]

# ── Demo Clients ────────────────────────────────────────────
DEMO_CLIENTS = [
    {
        "name": "Acme Corporation",
        "contact_info": {
            "email": "legal@acmecorp.com",
            "phone": "+15551234567",
            "address": "100 Innovation Blvd, San Francisco, CA 94105",
        },
    },
    {
        "name": "Jane Doe (Personal Injury)",
        "contact_info": {
            "email": "jane.doe@email.com",
            "phone": "+15559876543",
            "address": "42 Maple Street, Portland, OR 97201",
        },
    },
    {
        "name": "TechStart LLC",
        "contact_info": {
            "email": "founders@techstart.io",
            "phone": "+15555550101",
            "address": "200 Startup Ave, Austin, TX 78701",
        },
    },
    {
        "name": "Robert & Maria Garcia",
        "contact_info": {
            "email": "garcia.family@email.com",
            "phone": "+15555550202",
            "address": "88 Oak Drive, Denver, CO 80202",
        },
    },
]

# ── Demo Cases ──────────────────────────────────────────────
DEMO_CASES = [
    {
        "client_index": 0,
        "title": "Acme Corp v. GlobalTech Inc – Patent Infringement",
        "description": (
            "Acme Corporation alleges that GlobalTech Inc has infringed on three "
            "utility patents (US 10,123,456; US 10,234,567; US 10,345,678) related "
            "to their proprietary AI-based logistics optimization system. "
            "Seeking injunctive relief and damages exceeding $15M."
        ),
        "status": CaseStatus.IN_PROGRESS,
        "filing_date": datetime(2024, 3, 15, tzinfo=timezone.utc),
    },
    {
        "client_index": 1,
        "title": "Doe v. Metro Transit Authority – Personal Injury",
        "description": (
            "Jane Doe sustained injuries in a bus accident on Highway 26 on "
            "January 8, 2024. The Metro Transit Authority is alleged to have been "
            "negligent in vehicle maintenance and driver supervision. "
            "Client seeking compensation for medical expenses, lost wages, and pain and suffering."
        ),
        "status": CaseStatus.OPEN,
        "filing_date": datetime(2024, 2, 1, tzinfo=timezone.utc),
    },
    {
        "client_index": 2,
        "title": "TechStart LLC – Series A Investment Agreement Review",
        "description": (
            "Review and negotiation of Series A preferred stock purchase agreement, "
            "investor rights agreement, right of first refusal and co-sale agreement, "
            "and voting agreement. Lead investor: Pinnacle Ventures ($5M round)."
        ),
        "status": CaseStatus.PENDING_REVIEW,
        "filing_date": datetime(2024, 6, 1, tzinfo=timezone.utc),
    },
    {
        "client_index": 3,
        "title": "Garcia Family – Residential Real Estate Purchase",
        "description": (
            "Representation of the Garcia family in the purchase of residential property "
            "at 1234 Sunset Boulevard, Denver, CO 80202. Purchase price: $650,000. "
            "Includes title search, contract review, and closing coordination."
        ),
        "status": CaseStatus.CLOSED,
        "filing_date": datetime(2024, 1, 10, tzinfo=timezone.utc),
    },
]

# ── Demo Communications ─────────────────────────────────────
DEMO_COMMUNICATIONS: list[dict] = [
    # Case 0: Patent Infringement
    {
        "case_index": 0,
        "comm_type": CommType.EMAIL,
        "timestamp_offset_days": -60,
        "sender": "legal@acmecorp.com",
        "recipient": "attorney@legalcm.demo",
        "subject": "Patent Infringement – Initial Evidence Package",
        "transcript_body": (
            "Dear Counsel,\n\n"
            "Attached please find the initial evidence package documenting GlobalTech's "
            "infringement of our patents. This includes:\n"
            "1. Side-by-side comparison of our patented algorithms vs. GlobalTech's implementation\n"
            "2. Purchase records of GlobalTech's product showing timeline of infringement\n"
            "3. Expert preliminary opinion from Dr. Sarah Chen (Stanford CS)\n\n"
            "We would like to schedule a strategy meeting at your earliest convenience.\n\n"
            "Best regards,\nMark Thompson\nGeneral Counsel, Acme Corporation"
        ),
    },
    {
        "case_index": 0,
        "comm_type": CommType.CALL,
        "timestamp_offset_days": -55,
        "sender": "attorney@legalcm.demo",
        "recipient": "legal@acmecorp.com",
        "subject": "Strategy Call – Infringement Claims",
        "transcript_body": (
            "[Call transcript – 45 minutes]\n\n"
            "Attorney: We've reviewed the evidence package. The side-by-side comparison "
            "is compelling, particularly for Patent '456. I recommend we proceed with a "
            "cease-and-desist letter first, then file if they don't respond within 30 days.\n\n"
            "Client: Agreed. What's our timeline looking like for discovery if we do file?\n\n"
            "Attorney: Typically 6-9 months for a patent case of this complexity. "
            "We should also consider filing for a preliminary injunction given the ongoing harm.\n\n"
            "Client: Let's proceed with the C&D immediately and prepare the complaint in parallel."
        ),
    },
    # Case 1: Personal Injury
    {
        "case_index": 1,
        "comm_type": CommType.EMAIL,
        "timestamp_offset_days": -90,
        "sender": "jane.doe@email.com",
        "recipient": "attorney@legalcm.demo",
        "subject": "Bus Accident – Medical Records Enclosed",
        "transcript_body": (
            "Hi,\n\n"
            "As requested, I'm sending my medical records from Portland General Hospital. "
            "My injuries include:\n"
            "- Fractured left wrist (surgery required)\n"
            "- Whiplash / cervical strain\n"
            "- Mild concussion\n\n"
            "My total medical bills so far are $47,250. I've been out of work for 6 weeks "
            "and my employer says they can only hold my position for 2 more weeks.\n\n"
            "Please let me know what next steps are.\n\n"
            "Thank you,\nJane Doe"
        ),
    },
    {
        "case_index": 1,
        "comm_type": CommType.NOTE,
        "timestamp_offset_days": -85,
        "sender": "paralegal@legalcm.demo",
        "recipient": None,
        "subject": "Research – Metro Transit Maintenance Records",
        "transcript_body": (
            "FOIA request submitted for Metro Transit Authority bus maintenance records "
            "for Bus #4472 (route 26). Expected response time: 15 business days.\n\n"
            "Also identified two prior incidents involving the same bus route in 2023 "
            "from news reports. Need to verify with court records."
        ),
    },
    # Case 2: Investment Agreement
    {
        "case_index": 2,
        "comm_type": CommType.EMAIL,
        "timestamp_offset_days": -30,
        "sender": "founders@techstart.io",
        "recipient": "attorney@legalcm.demo",
        "subject": "Series A Term Sheet – Pinnacle Ventures",
        "transcript_body": (
            "Hi team,\n\n"
            "Great news! We've received a term sheet from Pinnacle Ventures for our Series A:\n"
            "- $5M investment at $20M pre-money valuation\n"
            "- 1x non-participating preferred liquidation preference\n"
            "- Board seat for Pinnacle\n"
            "- Standard anti-dilution (broad-based weighted average)\n\n"
            "Can you review and flag any concerns? We'd like to sign within 2 weeks.\n\n"
            "Thanks,\nAlex Rivera, CEO"
        ),
    },
    # Case 3: Real Estate
    {
        "case_index": 3,
        "comm_type": CommType.EMAIL,
        "timestamp_offset_days": -120,
        "sender": "garcia.family@email.com",
        "recipient": "attorney@legalcm.demo",
        "subject": "Home Purchase – Contract Review Request",
        "transcript_body": (
            "Hello,\n\n"
            "We've found a home we love at 1234 Sunset Boulevard. The seller has provided "
            "a purchase contract. Could you review it and advise us on any concerns?\n\n"
            "Key terms:\n"
            "- Purchase price: $650,000\n"
            "- Earnest money: $20,000\n"
            "- Closing date: March 15, 2024\n"
            "- Inspection contingency: 10 days\n"
            "- Financing contingency: 30 days\n\n"
            "Thank you,\nRobert & Maria Garcia"
        ),
    },
]

# ── Demo Timeline Events ────────────────────────────────────
DEMO_TIMELINE_EVENTS: list[dict] = [
    # Case 0: Patent Infringement
    {
        "case_index": 0,
        "offset_days": -120,
        "description": "GlobalTech launches 'OptiRoute Pro' product incorporating allegedly infringing algorithms",
        "confidence": 0.92,
        "source_type": "document",
    },
    {
        "case_index": 0,
        "offset_days": -90,
        "description": "Acme Corporation's internal investigation identifies potential patent infringement",
        "confidence": 0.88,
        "source_type": "communication",
    },
    {
        "case_index": 0,
        "offset_days": -60,
        "description": "Initial evidence package compiled with expert preliminary opinion",
        "confidence": 0.95,
        "source_type": "document",
    },
    {
        "case_index": 0,
        "offset_days": -55,
        "description": "Strategy call conducted – decision to send cease-and-desist letter",
        "confidence": 0.97,
        "source_type": "communication",
    },
    {
        "case_index": 0,
        "offset_days": -45,
        "description": "Cease-and-desist letter sent to GlobalTech via certified mail",
        "confidence": 0.99,
        "source_type": "document",
    },
    {
        "case_index": 0,
        "offset_days": -30,
        "description": "GlobalTech's counsel responds, denying infringement allegations",
        "confidence": 0.90,
        "source_type": "communication",
    },
    {
        "case_index": 0,
        "offset_days": -15,
        "description": "Patent infringement complaint filed in U.S. District Court, Northern District of California",
        "confidence": 0.99,
        "source_type": "document",
    },
    # Case 1: Personal Injury
    {
        "case_index": 1,
        "offset_days": -100,
        "description": "Bus accident occurs on Highway 26 involving Metro Transit Bus #4472",
        "confidence": 0.99,
        "source_type": "document",
    },
    {
        "case_index": 1,
        "offset_days": -98,
        "description": "Jane Doe admitted to Portland General Hospital for emergency treatment",
        "confidence": 0.95,
        "source_type": "document",
    },
    {
        "case_index": 1,
        "offset_days": -90,
        "description": "Medical records and bills compiled, total expenses: $47,250",
        "confidence": 0.93,
        "source_type": "communication",
    },
    {
        "case_index": 1,
        "offset_days": -85,
        "description": "FOIA request submitted for bus maintenance records",
        "confidence": 0.97,
        "source_type": "communication",
    },
    {
        "case_index": 1,
        "offset_days": -70,
        "description": "FOIA response received – maintenance logs show overdue brake inspection",
        "confidence": 0.85,
        "source_type": "document",
    },
    # Case 2: Investment Agreement
    {
        "case_index": 2,
        "offset_days": -45,
        "description": "TechStart receives initial term sheet from Pinnacle Ventures",
        "confidence": 0.98,
        "source_type": "document",
    },
    {
        "case_index": 2,
        "offset_days": -30,
        "description": "Term sheet review begins – flagging anti-dilution and board composition clauses",
        "confidence": 0.90,
        "source_type": "communication",
    },
    {
        "case_index": 2,
        "offset_days": -20,
        "description": "Negotiation of revised liquidation preference terms",
        "confidence": 0.85,
        "source_type": "communication",
    },
    {
        "case_index": 2,
        "offset_days": -10,
        "description": "Final draft of stock purchase agreement circulated to all parties",
        "confidence": 0.92,
        "source_type": "document",
    },
    # Case 3: Real Estate (closed)
    {
        "case_index": 3,
        "offset_days": -150,
        "description": "Purchase offer submitted for 1234 Sunset Boulevard at $650,000",
        "confidence": 0.99,
        "source_type": "document",
    },
    {
        "case_index": 3,
        "offset_days": -140,
        "description": "Seller accepts purchase offer with standard contingencies",
        "confidence": 0.97,
        "source_type": "communication",
    },
    {
        "case_index": 3,
        "offset_days": -130,
        "description": "Home inspection completed – minor roof repair needed",
        "confidence": 0.94,
        "source_type": "document",
    },
    {
        "case_index": 3,
        "offset_days": -125,
        "description": "Negotiated $5,000 credit for roof repair with seller",
        "confidence": 0.91,
        "source_type": "communication",
    },
    {
        "case_index": 3,
        "offset_days": -110,
        "description": "Title search completed – clear title confirmed",
        "confidence": 0.98,
        "source_type": "document",
    },
    {
        "case_index": 3,
        "offset_days": -100,
        "description": "Mortgage approved by First National Bank at 6.5% fixed, 30-year",
        "confidence": 0.96,
        "source_type": "document",
    },
    {
        "case_index": 3,
        "offset_days": -90,
        "description": "Closing completed – property deed transferred to Garcia family",
        "confidence": 0.99,
        "source_type": "document",
    },
]


async def seed_database() -> None:
    """Populate the database with demo data."""
    setup_logging()
    logger.info("seed_start", message="Starting database seed...")

    # Initialize DB tables
    await init_db()

    async with async_session_factory() as session:
        # Check if data already exists
        existing_users = await session.execute(
            select(User).where(User.email == DEMO_USERS[0]["email"])
        )
        if existing_users.scalar_one_or_none() is not None:
            logger.info("seed_skip", message="Seed data already exists. Skipping.")
            print("\n  Seed data already exists. Delete the database to re-seed.")
            print("  (Delete: backend/storage/legalcm.db)\n")
            return

        now = datetime.now(timezone.utc)

        # ── Create Users ─────────────────────────────────────
        users: list[User] = []
        for u in DEMO_USERS:
            user = User(
                email=u["email"],
                password_hash=hash_password(u["password"]),
                mfa_enabled=False,
                is_active=True,
            )
            session.add(user)
            users.append(user)
        await session.flush()
        logger.info("seed_users", count=len(users))

        # ── Create Clients ───────────────────────────────────
        clients: list[Client] = []
        for c in DEMO_CLIENTS:
            client = Client(name=c["name"], contact_info=c["contact_info"])
            session.add(client)
            clients.append(client)
        await session.flush()
        logger.info("seed_clients", count=len(clients))

        # ── Create Cases ─────────────────────────────────────
        cases: list[Case] = []
        for cd in DEMO_CASES:
            case = Case(
                client_id=clients[cd["client_index"]].id,
                title=cd["title"],
                description=cd["description"],
                status=cd["status"],
                filing_date=cd["filing_date"],
            )
            session.add(case)
            cases.append(case)
        await session.flush()

        # Grant access – admin owns all, attorney has ATTORNEY role, paralegal has PARALEGAL
        for i, case in enumerate(cases):
            # Admin = OWNER
            session.add(
                CaseUserLink(
                    case_id=case.id, user_id=users[0].id, role=CaseUserRole.OWNER
                )
            )
            # Attorney = ATTORNEY
            session.add(
                CaseUserLink(
                    case_id=case.id, user_id=users[1].id, role=CaseUserRole.ATTORNEY
                )
            )
            # Paralegal = PARALEGAL on first two cases only
            if i < 2:
                session.add(
                    CaseUserLink(
                        case_id=case.id,
                        user_id=users[2].id,
                        role=CaseUserRole.PARALEGAL,
                    )
                )
        await session.flush()
        logger.info("seed_cases", count=len(cases))

        # ── Create Communications ────────────────────────────
        comms_created = 0
        for cd in DEMO_COMMUNICATIONS:
            case = cases[cd["case_index"]]
            ts = now + timedelta(days=cd["timestamp_offset_days"])
            comm = Communication(
                case_id=case.id,
                comm_type=cd["comm_type"],
                timestamp=ts,
                sender=cd.get("sender"),
                recipient=cd.get("recipient"),
                subject=cd.get("subject"),
                transcript_body=cd.get("transcript_body"),
                is_vectorized=False,
            )
            session.add(comm)
            comms_created += 1
        await session.flush()
        logger.info("seed_communications", count=comms_created)

        # ── Create Timeline Events ───────────────────────────
        events_created = 0
        for ed in DEMO_TIMELINE_EVENTS:
            case = cases[ed["case_index"]]
            ts = now + timedelta(days=ed["offset_days"])
            event = TimelineEvent(
                case_id=case.id,
                absolute_timestamp=ts,
                event_description=ed["description"],
                ai_confidence_score=ed["confidence"],
                source_type=ed["source_type"],
            )
            session.add(event)
            events_created += 1
        await session.flush()
        logger.info("seed_timeline_events", count=events_created)

        # ── Commit ───────────────────────────────────────────
        await session.commit()

    # Print summary
    print("\n" + "=" * 60)
    print("  SEED DATA LOADED SUCCESSFULLY")
    print("=" * 60)
    print(f"\n  Users:           {len(DEMO_USERS)}")
    print(f"  Clients:         {len(DEMO_CLIENTS)}")
    print(f"  Cases:           {len(DEMO_CASES)}")
    print(f"  Communications:  {comms_created}")
    print(f"  Timeline Events: {events_created}")
    print("\n  Demo Login Credentials:")
    print("  " + "-" * 44)
    for u in DEMO_USERS:
        role = u["email"].split("@")[0].capitalize()
        print(f"    {role:12s}  {u['email']:30s}  {u['password']}")
    print("  " + "-" * 44)
    print(f"\n  Start the app with: start.bat")
    print(f"  Then open: http://localhost:3000\n")


if __name__ == "__main__":
    asyncio.run(seed_database())
