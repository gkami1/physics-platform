"""tutor threads, messages, llm calls

Revision ID: 387b1676f517
Revises: 775bf03d30d3
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "387b1676f517"
down_revision: str | None = "775bf03d30d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _user_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["user_id"], ["users.id"], name=op.f(f"fk_{table}_user_id_users"), ondelete="CASCADE"
    )


def upgrade() -> None:
    op.create_table(
        "tutor_threads",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("context_kind", sa.String(16), nullable=False),
        sa.Column("context_id", sa.String(80), nullable=False),
        sa.Column("hint_level", sa.SmallInteger(), nullable=False),
        sa.Column("turns_at_level", sa.SmallInteger(), nullable=False),
        _created_at(),
        _user_fk("tutor_threads"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tutor_threads")),
        sa.UniqueConstraint(
            "user_id", "context_kind", "context_id", name="uq_tutor_threads_context"
        ),
    )
    op.create_table(
        "tutor_messages",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("thread_id", BigId, nullable=False),
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("hint_level", sa.SmallInteger(), nullable=True),
        sa.Column("flags", sa.JSON(), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["tutor_threads.id"],
            name=op.f("fk_tutor_messages_thread_id_tutor_threads"),
            ondelete="CASCADE",
        ),
        _user_fk("tutor_messages"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tutor_messages")),
    )
    op.create_index("ix_tutor_messages_thread", "tutor_messages", ["thread_id", "id"])
    op.create_index(op.f("ix_tutor_messages_user_id"), "tutor_messages", ["user_id"])
    op.create_table(
        "llm_calls",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("message_id", BigId, nullable=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("ttft_ms", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("cost_kop", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(300), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["tutor_messages.id"],
            name=op.f("fk_llm_calls_message_id_tutor_messages"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_llm_calls")),
    )
    op.create_index(op.f("ix_llm_calls_message_id"), "llm_calls", ["message_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_llm_calls_message_id"), table_name="llm_calls")
    op.drop_table("llm_calls")
    op.drop_index(op.f("ix_tutor_messages_user_id"), table_name="tutor_messages")
    op.drop_index("ix_tutor_messages_thread", table_name="tutor_messages")
    op.drop_table("tutor_messages")
    op.drop_table("tutor_threads")
