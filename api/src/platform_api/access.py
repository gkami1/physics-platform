"""Who has paid access, and how many tutor messages a day that buys."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_api.actor import as_utc, now
from platform_api.db import Entitlement, LlmCall, TutorMessage, User
from platform_api.settings import Settings

BUDGET_WINDOW = timedelta(days=30)


@dataclass(frozen=True)
class TutorLimit:
    daily: int
    paid: bool


def daily_limit(
    paid: bool, spend_kop: int, *, free: int, paid_cap: int, budget_kop: int
) -> TutorLimit:
    """Pure rule: a pass raises the daily cap unless its fair-use budget is spent."""
    if paid and (budget_kop <= 0 or spend_kop < budget_kop):
        return TutorLimit(paid_cap, True)
    return TutorLimit(free, paid)


async def paid_until(db: AsyncSession, user: User) -> datetime | None:
    """End of the user's paid access, or None if they have none now."""
    row = await db.get(Entitlement, user.id)
    if row is None:
        return None
    until = as_utc(row.valid_until)
    return until if until > now() else None


async def tutor_spend(db: AsyncSession, user: User) -> int:
    """Model spend on this user's threads over the budget window, in kopecks."""
    spent = await db.scalar(
        select(func.coalesce(func.sum(LlmCall.cost_kop), 0))
        .join(TutorMessage, TutorMessage.id == LlmCall.message_id)
        .where(TutorMessage.user_id == user.id, LlmCall.created_at > now() - BUDGET_WINDOW)
    )
    return int(spent or 0)


async def tutor_limit(db: AsyncSession, settings: Settings, user: User) -> TutorLimit:
    paid = await paid_until(db, user) is not None
    spend = await tutor_spend(db, user) if paid and settings.tutor_paid_monthly_budget_kop else 0
    return daily_limit(
        paid,
        spend,
        free=settings.tutor_daily_messages,
        paid_cap=settings.tutor_paid_daily_messages,
        budget_kop=settings.tutor_paid_monthly_budget_kop,
    )
