"""step tasks: tasks.ege_task nullable

Theory step tasks have no EGE task number.

Revision ID: b3f1c2d4e5a6
Revises: 5a1e9c3d7b20
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3f1c2d4e5a6"
down_revision: str | None = "5a1e9c3d7b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("ege_task", existing_type=sa.SmallInteger(), nullable=True)


def downgrade() -> None:
    # Step tasks have no number to restore; drop their mirror rows (attempts keep task_id
    # as a foreign key, so this fails while any step-task attempts exist — by design).
    op.execute("DELETE FROM tasks WHERE ege_task IS NULL")
    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("ege_task", existing_type=sa.SmallInteger(), nullable=False)
