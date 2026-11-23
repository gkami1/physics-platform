"""Merge the billing and theory reading migration histories.

Revision ID: e229e0c7df5c
Revises: c7d2e9a14f3b, d4e8a1b2c3f7
Create Date: 2026-11-23
"""

from collections.abc import Sequence

revision: str = "e229e0c7df5c"
down_revision: tuple[str, str] = ("c7d2e9a14f3b", "d4e8a1b2c3f7")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
