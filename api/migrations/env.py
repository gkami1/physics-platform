import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from platform_api.db import Base
from platform_api.settings import Settings

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    # Tests set sqlalchemy.url explicitly; everything else uses app settings.
    return config.get_main_option("sqlalchemy.url") or Settings().database_url


def _configure(**kw: object) -> None:
    context.configure(
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=_url().startswith("sqlite"),  # SQLite cannot ALTER most things
        **kw,  # type: ignore[arg-type]
    )


def run_migrations_offline() -> None:
    _configure(url=_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
