"""initial tasks and attempts

Revision ID: 7cd17a3a4181
Revises:
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7cd17a3a4181"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(80), nullable=False),
        sa.Column("exam_id", sa.String(80), nullable=False),
        sa.Column("ege_task", sa.SmallInteger(), nullable=False),
        sa.Column("max_points", sa.SmallInteger(), nullable=False),
        sa.Column("answer_type", sa.String(16), nullable=False),
        sa.Column("topics", sa.JSON(), nullable=False),
        sa.Column("content_version", sa.String(32), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    op.create_table(
        "attempts",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("anon_id", sa.String(32), nullable=True),
        sa.Column("task_id", sa.String(80), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("raw_answer", sa.String(64), nullable=True),
        sa.Column("points", sa.SmallInteger(), nullable=False),
        sa.Column("max_points", sa.SmallInteger(), nullable=False),
        sa.Column("content_version", sa.String(32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], name=op.f("fk_attempts_task_id_tasks")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attempts")),
    )
    op.create_index(
        "ix_attempts_actor_task", "attempts", ["anon_id", "task_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_attempts_actor_task", table_name="attempts")
    op.drop_table("attempts")
    op.drop_table("tasks")
