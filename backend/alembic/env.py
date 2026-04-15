"""
Alembic environment configuration for async SQLAlchemy.
"""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.models import Base

config = context.config

# Override sqlalchemy.url from DATABASE_URL env var if set
database_url = os.environ.get("DATABASE_URL")
if database_url:
    config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_sync_url() -> str:
    """Return a synchronous database URL for offline migrations."""
    url = config.get_main_option("sqlalchemy.url", "")
    # Convert async drivers to sync equivalents
    url = url.replace("sqlite+aiosqlite", "sqlite")
    url = url.replace("postgresql+asyncpg", "postgresql+psycopg2")
    return url


def _get_async_url() -> str:
    """Return an async database URL for online migrations."""
    url = config.get_main_option("sqlalchemy.url", "")
    # Convert sync drivers to async equivalents
    if url.startswith("sqlite:///"):
        url = url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    elif url.startswith("postgresql://") or url.startswith("postgresql+psycopg2://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = _get_sync_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    # Override the URL in the config section with the async version
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _get_async_url()

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
