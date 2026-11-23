"""payments, entitlements, users.consent_version

Revision ID: c7d2e9a14f3b
Revises: b3f1c2d4e5a6
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7d2e9a14f3b"
down_revision: str | None = "b3f1c2d4e5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("consent_version", sa.String(32), nullable=True))

    op.create_table(
        "payments",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("plan", sa.String(16), nullable=False),
        sa.Column("amount_kop", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("offer_version", sa.String(32), nullable=False),
        sa.Column("raw", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_payments_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payments")),
    )
    op.create_index("ix_payments_user_created", "payments", ["user_id", "created_at"])

    op.create_table(
        "entitlements",
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("plan", sa.String(16), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_entitlements_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_entitlements")),
    )


def downgrade() -> None:
    op.drop_table("entitlements")
    op.drop_index("ix_payments_user_created", table_name="payments")
    op.drop_table("payments")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("consent_version")
