"""password sign-in, profile, consents

Users get names, phone, a password hash and marketing consent; a sign-up form waits in
login_codes.signup until its code is typed; consent_events records consents given and
withdrawn; password_failures is the ledger for sign-in rate limits.

Revision ID: c1a2ef3f9c60
Revises: b3f1c2d4e5a6
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1a2ef3f9c60"
down_revision: str | None = "b3f1c2d4e5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "password_failures",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_failures")),
    )
    op.create_index(
        "ix_password_failures_email_created", "password_failures", ["email", "created_at"]
    )
    op.create_index("ix_password_failures_ip_created", "password_failures", ["ip", "created_at"])

    op.create_table(
        "consent_events",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_consent_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_consent_events")),
    )
    op.create_index(op.f("ix_consent_events_user_id"), "consent_events", ["user_id"])

    with op.batch_alter_table("login_codes") as batch:
        batch.add_column(sa.Column("signup", sa.JSON(none_as_null=True), nullable=True))

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("first_name", sa.String(length=50), nullable=True))
        batch.add_column(sa.Column("last_name", sa.String(length=50), nullable=True))
        batch.add_column(sa.Column("phone", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("password_hash", sa.String(length=255), nullable=True))
        batch.add_column(
            sa.Column("marketing_consent_at", sa.DateTime(timezone=True), nullable=True)
        )

    # Accounts made by email code ticked the personal-data box at sign-in.
    users = sa.table("users", sa.column("id"), sa.column("consented_at"))
    events = sa.table(
        "consent_events",
        sa.column("user_id"),
        sa.column("kind"),
        sa.column("granted", sa.Boolean()),
        sa.column("created_at"),
    )
    op.execute(
        events.insert().from_select(
            ["user_id", "kind", "granted", "created_at"],
            sa.select(
                users.c.id,
                sa.literal("personal_data"),
                sa.true(),
                users.c.consented_at,
            ),
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("marketing_consent_at")
        batch.drop_column("password_hash")
        batch.drop_column("phone")
        batch.drop_column("last_name")
        batch.drop_column("first_name")

    with op.batch_alter_table("login_codes") as batch:
        batch.drop_column("signup")

    op.drop_index(op.f("ix_consent_events_user_id"), table_name="consent_events")
    op.drop_table("consent_events")
    op.drop_index("ix_password_failures_ip_created", table_name="password_failures")
    op.drop_index("ix_password_failures_email_created", table_name="password_failures")
    op.drop_table("password_failures")
