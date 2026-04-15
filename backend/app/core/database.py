"""
Async SQLAlchemy engine and session factory.
Supports both PostgreSQL (asyncpg) and SQLite (aiosqlite).
"""

from __future__ import annotations

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("db")

_engine_kwargs: dict = {
    "echo": settings.app_debug,
    "future": True,
}

if settings.is_sqlite:
    _engine_kwargs["poolclass"] = NullPool
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["poolclass"] = AsyncAdaptedQueuePool
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20
    _engine_kwargs["pool_pre_ping"] = True
    # TLS for production PostgreSQL connections
    if settings.app_env == "production":
        _engine_kwargs["connect_args"] = {"ssl": True}

engine: AsyncEngine = create_async_engine(settings.database_url, **_engine_kwargs)

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yield a scoped async session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Create all tables (development convenience). Use Alembic in prod."""
    from app.models.base import Base  # noqa: F811

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database_tables_created")


async def close_db() -> None:
    """Dispose of the engine connection pool."""
    await engine.dispose()
    logger.info("database_engine_disposed")
