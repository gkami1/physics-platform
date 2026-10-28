"""variant runs

Revision ID: 5a1e9c3d7b20
Revises: 387b1676f517
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5a1e9c3d7b20"
down_revision: str | None = "387b1676f517"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "variant_runs",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("anon_id", sa.String(32), nullable=True),
        sa.Column("user_id", BigId, nullable=True),
        sa.Column("exam_id", sa.String(40), nullable=False),
        sa.Column("variant", sa.SmallInteger(), nullable=False),
        sa.Column("content_version", sa.String(32), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("auto_points", sa.SmallInteger(), nullable=False),
        sa.Column("self_points", sa.JSON(), nullable=False),
        sa.Column("max_points", sa.SmallInteger(), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_variant_runs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_variant_runs")),
    )
    op.create_index("ix_variant_runs_user", "variant_runs", ["user_id", "id"])
    op.create_index("ix_variant_runs_anon", "variant_runs", ["anon_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_variant_runs_anon", table_name="variant_runs")
    op.drop_index("ix_variant_runs_user", table_name="variant_runs")
    op.drop_table("variant_runs")
