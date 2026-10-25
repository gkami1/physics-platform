"""users, sessions, login codes; attempts.user_id

Revision ID: 775bf03d30d3
Revises: 7cd17a3a4181
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "775bf03d30d3"
down_revision: str | None = "7cd17a3a4181"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("user_id", BigId, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(op.f("ix_sessions_user_id"), "sessions", ["user_id"], unique=False)

    op.create_table(
        "login_codes",
        sa.Column("id", BigId, autoincrement=True, nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("tries", sa.SmallInteger(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_login_codes")),
    )
    op.create_index("ix_login_codes_email_created", "login_codes", ["email", "created_at"])
    op.create_index("ix_login_codes_ip_created", "login_codes", ["ip", "created_at"])

    # batch mode so SQLite (tests, local dev) can add the foreign key.
    with op.batch_alter_table("attempts") as batch:
        batch.add_column(sa.Column("user_id", BigId, nullable=True))
        batch.create_foreign_key(
            op.f("fk_attempts_user_id_users"), "users", ["user_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_index("ix_attempts_user_task", ["user_id", "task_id", "created_at"])


def downgrade() -> None:
    with op.batch_alter_table("attempts") as batch:
        batch.drop_index("ix_attempts_user_task")
        batch.drop_constraint(op.f("fk_attempts_user_id_users"), type_="foreignkey")
        batch.drop_column("user_id")
    op.drop_index("ix_login_codes_ip_created", table_name="login_codes")
    op.drop_index("ix_login_codes_email_created", table_name="login_codes")
    op.drop_table("login_codes")
    op.drop_index(op.f("ix_sessions_user_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("users")
