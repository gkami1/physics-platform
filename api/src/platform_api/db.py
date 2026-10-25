"""SQLAlchemy models and session plumbing.

Column types stay portable (no Postgres-only types) so tests can run on SQLite;
production and CI also run against Postgres.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Stable constraint names so Alembic migrations are deterministic.
NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# BIGINT autoincrement does not work on SQLite; INTEGER there is the same 64-bit rowid.
BigId = BigInteger().with_variant(Integer(), "sqlite")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)
    type_annotation_map: ClassVar[dict[Any, Any]] = {
        datetime: DateTime(timezone=True),
        dict[str, Any]: JSON,
    }


class Task(Base):
    """Public task metadata mirrored from content, for joins and analytics.

    Answers and solutions are not stored here: they ship inside the API image
    (build/private) and are served from memory by ContentStore.
    """

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(80))
    ege_task: Mapped[int] = mapped_column(SmallInteger)
    max_points: Mapped[int] = mapped_column(SmallInteger)
    answer_type: Mapped[str] = mapped_column(String(16))
    topics: Mapped[list[str]] = mapped_column(JSON)
    content_version: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (Index("ix_attempts_actor_task", "anon_id", "task_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    # Anonymous actor id from the pp_anon cookie. M3 adds user_id and merges on sign-up.
    anon_id: Mapped[str | None] = mapped_column(String(32))
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"))
    # correct | partial | wrong | revealed  (invalid input is never stored)
    outcome: Mapped[str] = mapped_column(String(16))
    raw_answer: Mapped[str | None] = mapped_column(String(64))
    points: Mapped[int] = mapped_column(SmallInteger)
    max_points: Mapped[int] = mapped_column(SmallInteger)
    content_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
