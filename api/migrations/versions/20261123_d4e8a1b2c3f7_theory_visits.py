"""theory visits

Revision ID: d4e8a1b2c3f7
Revises: c1a2ef3f9c60
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8a1b2c3f7"
down_revision: str | None = "c1a2ef3f9c60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "theory_visits",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("anon_id", sa.String(32), nullable=True),
        sa.Column("user_id", BigId, nullable=True),
        sa.Column("page_id", sa.String(120), nullable=False),
        sa.Column("visits", sa.Integer(), nullable=False),
        sa.Column("active_s", sa.Integer(), nullable=False),
        sa.Column("first_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_theory_visits_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_theory_visits")),
    )
    op.create_index("ix_theory_visits_user", "theory_visits", ["user_id", "page_id"])
    op.create_index("ix_theory_visits_anon", "theory_visits", ["anon_id", "page_id"])


def downgrade() -> None:
    op.drop_index("ix_theory_visits_anon", table_name="theory_visits")
    op.drop_index("ix_theory_visits_user", table_name="theory_visits")
    op.drop_table("theory_visits")
