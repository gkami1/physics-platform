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
    Text,
    UniqueConstraint,
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
    ege_task: Mapped[int | None] = mapped_column(SmallInteger)  # None: theory step task
    max_points: Mapped[int] = mapped_column(SmallInteger)
    answer_type: Mapped[str] = mapped_column(String(16))
    topics: Mapped[list[str]] = mapped_column(JSON)
    content_version: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    # Normalised (lower-cased) address; the only sign-in method until OAuth providers land.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # 152-FZ: when the user ticked the personal-data consent box.
    consented_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AuthSession(Base):
    __tablename__ = "sessions"

    # sha256 of the cookie token; the token itself is never stored.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LoginCode(Base):
    __tablename__ = "login_codes"
    __table_args__ = (
        Index("ix_login_codes_email_created", "email", "created_at"),
        Index("ix_login_codes_ip_created", "ip", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254))
    code_hash: Mapped[str] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(45))
    tries: Mapped[int] = mapped_column(SmallInteger, default=0)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (
        Index("ix_attempts_actor_task", "anon_id", "task_id", "created_at"),
        Index("ix_attempts_user_task", "user_id", "task_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    # Anonymous actor id from the pp_anon cookie. Rows get user_id on sign-in.
    anon_id: Mapped[str | None] = mapped_column(String(32))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"))
    # correct | partial | wrong | revealed  (invalid input is never stored)
    outcome: Mapped[str] = mapped_column(String(16))
    raw_answer: Mapped[str | None] = mapped_column(String(64))
    points: Mapped[int] = mapped_column(SmallInteger)
    max_points: Mapped[int] = mapped_column(SmallInteger)
    content_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TutorThread(Base):
    """One dialogue per user and page (a task or a theory topic)."""

    __tablename__ = "tutor_threads"
    __table_args__ = (
        UniqueConstraint("user_id", "context_kind", "context_id", name="uq_tutor_threads_context"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    context_kind: Mapped[str] = mapped_column(String(16))  # task | theory
    context_id: Mapped[str] = mapped_column(String(80))
    # Hint ladder (task threads): decided by the server, see hints.py.
    hint_level: Mapped[int] = mapped_column(SmallInteger, default=0)
    turns_at_level: Mapped[int] = mapped_column(SmallInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TutorMessage(Base):
    __tablename__ = "tutor_messages"
    __table_args__ = (Index("ix_tutor_messages_thread", "thread_id", "id"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("tutor_threads.id", ondelete="CASCADE"))
    # Denormalised for the daily cap query.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    hint_level: Mapped[int | None] = mapped_column(SmallInteger)
    # e.g. {"leak": true, "error": "…", "intent": "hint"}
    flags: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LlmCall(Base):
    """Trace of every model call, one row per provider attempt (fallbacks included)."""

    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutor_messages.id", ondelete="SET NULL"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(80))
    prompt_version: Mapped[str] = mapped_column(String(32))
    ttft_ms: Mapped[int | None]
    latency_ms: Mapped[int | None]
    tokens_in: Mapped[int | None]
    tokens_out: Mapped[int | None]
    cost_kop: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


class VariantRun(Base):
    """One timed exam variant. Part 1 is checked on submit (each answer is also an attempt);
    Part 2 is self-assessed afterwards against the reference solution."""

    __tablename__ = "variant_runs"
    __table_args__ = (
        Index("ix_variant_runs_user", "user_id", "id"),
        Index("ix_variant_runs_anon", "anon_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    # Same ownership as attempts: anonymous rows get user_id on sign-in.
    anon_id: Mapped[str | None] = mapped_column(String(32))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    exam_id: Mapped[str] = mapped_column(String(40))
    variant: Mapped[int] = mapped_column(SmallInteger)
    content_version: Mapped[str] = mapped_column(String(32))
    # Per task, in variant order: task_id, ege_task, outcome, points, max_points, answer.
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    auto_points: Mapped[int] = mapped_column(SmallInteger)
    # Part 2 self-assessment: task_id -> points.
    self_points: Mapped[dict[str, Any]] = mapped_column(default=dict)
    max_points: Mapped[int] = mapped_column(SmallInteger)
    # Reported by the client (the timer runs there); informational only.
    duration_s: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
