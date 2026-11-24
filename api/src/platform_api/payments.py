"""Paid passes: plans, Robokassa checkout and its ResultURL callback."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import parse_qsl

from fastapi import APIRouter, HTTPException, Path, Request, Response
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update

from platform_api import billing
from platform_api.access import paid_until
from platform_api.actor import SessionUser, as_utc, now
from platform_api.billing import PlanId
from platform_api.db import Entitlement, Payment, User
from platform_api.deps import Db
from platform_api.settings import Settings

logger = logging.getLogger("api.payments")

# Bump with LEGAL_VERSION in web/src/lib/seller.ts when web/src/pages/legal/offer.astro changes.
OFFER_VERSION = "2026-11-24.1"
PENDING_PER_HOUR = 10
MAX_INVOICE_ID = 2**63 - 1  # payments.id is a signed BIGINT

router = APIRouter(prefix="/api/billing")


class PlanOut(BaseModel):
    id: PlanId
    title: str
    price_kop: int
    valid_until: datetime  # what buying it now would give a user without access


class PlansOut(BaseModel):
    plans: list[PlanOut]
    enabled: bool
    paid_until: datetime | None


class CheckoutIn(BaseModel):
    plan: PlanId
    accept_offer: bool


class CheckoutOut(BaseModel):
    url: str


class PaymentStatusOut(BaseModel):
    status: Literal["pending", "paid"]
    paid_until: datetime | None


def _settings(request: Request) -> Settings:
    s: Settings = request.app.state.settings
    return s


def _plans(s: Settings) -> dict[PlanId, billing.Plan]:
    return billing.plans(s.price_month_kop, s.price_season_kop)


@router.get("/plans")
async def get_plans(request: Request, db: Db, user: SessionUser) -> PlansOut:
    s = _settings(request)
    t = now()
    return PlansOut(
        plans=[
            PlanOut(
                id=p.id,
                title=p.title,
                price_kop=p.price_kop,
                valid_until=billing.extend(None, p.id, t),
            )
            for p in _plans(s).values()
        ],
        enabled=s.payments_enabled,
        paid_until=await paid_until(db, user) if user else None,
    )


@router.post("/checkout")
async def checkout(body: CheckoutIn, request: Request, db: Db, user: SessionUser) -> CheckoutOut:
    if user is None:
        raise HTTPException(401, "sign_in_required")
    if not body.accept_offer:
        raise HTTPException(422, "offer_required")
    s = _settings(request)
    if not s.payments_enabled:
        raise HTTPException(503, "payments_unavailable")
    # Serialize the pending-invoice limit for this customer on Postgres.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
    t = now()
    pending = await db.scalar(
        select(func.count())
        .select_from(Payment)
        .where(
            Payment.user_id == user.id,
            Payment.status == "pending",
            Payment.created_at > t - timedelta(hours=1),
        )
    )
    if (pending or 0) >= PENDING_PER_HOUR:
        raise HTTPException(429, "too_many_checkouts")

    plan = _plans(s)[body.plan]
    payment = Payment(
        user_id=user.id,
        provider="robokassa",
        plan=plan.id,
        amount_kop=plan.price_kop,
        status="pending",
        offer_version=OFFER_VERSION,
        raw={},
        created_at=t,
    )
    db.add(payment)
    await db.commit()
    shop = billing.Shop(
        s.robokassa_login, s.robokassa_password1, s.robokassa_hash, s.robokassa_test
    )
    return CheckoutOut(url=billing.checkout_url(shop, payment.id, plan, user.email))


@router.get("/payments/{invoice_id}")
async def payment_status(
    invoice_id: Annotated[int, Path(gt=0, le=MAX_INVOICE_ID)],
    response: Response,
    db: Db,
    user: SessionUser,
) -> PaymentStatusOut:
    if user is None:
        raise HTTPException(401, "sign_in_required")
    status = await db.scalar(
        select(Payment.status).where(
            Payment.id == invoice_id, Payment.user_id == user.id, Payment.provider == "robokassa"
        )
    )
    if status != "pending" and status != "paid":
        raise HTTPException(404, "unknown_invoice")
    response.headers["Cache-Control"] = "no-store"
    return PaymentStatusOut(
        status=status, paid_until=await paid_until(db, user) if status == "paid" else None
    )


async def _form(request: Request) -> dict[str, str]:
    """Robokassa sends ResultURL as a POST form or a GET query, per the shop's settings.

    The form is urlencoded, so the standard library parses it (no python-multipart)."""
    data = dict(request.query_params)
    if request.method == "POST":
        body = (await request.body()).decode("utf-8", errors="replace")
        data.update(parse_qsl(body, keep_blank_values=True))
    return data


@router.api_route("/robokassa/result", methods=["GET", "POST"], response_class=PlainTextResponse)
async def robokassa_result(request: Request, db: Db) -> str:
    s = _settings(request)
    if not s.payments_enabled:
        raise HTTPException(503, "payments_unavailable")
    data = await _form(request)
    out_sum, inv_id, signature = (
        data.get("OutSum", ""),
        data.get("InvId", ""),
        data.get("SignatureValue", ""),
    )
    signed = billing.verify_result(
        out_sum, inv_id, signature, s.robokassa_password2, s.robokassa_hash
    )
    if not signed:
        logger.warning("robokassa result: bad signature", extra={"inv_id": inv_id})
        raise HTTPException(400, "bad_signature")
    if not re.fullmatch(r"[1-9][0-9]{0,18}", inv_id) or int(inv_id) > MAX_INVOICE_ID:
        raise HTTPException(400, "bad_invoice")

    payment = await db.scalar(
        select(Payment).where(Payment.id == int(inv_id), Payment.provider == "robokassa")
    )
    if payment is None:
        logger.warning("robokassa result: unknown invoice", extra={"inv_id": inv_id})
        raise HTTPException(404, "unknown_invoice")
    if billing.parse_sum(out_sum) != payment.amount_kop:
        logger.warning(
            "robokassa result: amount mismatch",
            extra={"inv_id": inv_id, "out_sum": out_sum, "expected": payment.amount_kop},
        )
        raise HTTPException(400, "bad_amount")

    if payment.status == "paid":
        return f"OK{payment.id}"

    t = now()
    # Claim this invoice once. A retry that raced this update will see no matching pending row.
    claimed = await db.scalar(
        update(Payment)
        .where(Payment.id == payment.id, Payment.status == "pending")
        .values(
            status="paid", paid_at=t, raw={k: v for k, v in data.items() if k != "SignatureValue"}
        )
        .returning(Payment.id)
    )
    if claimed is not None:
        # The user row exists even on a first purchase, when there's no entitlement to lock.
        await db.execute(
            select(User.id).where(User.id == payment.user_id).with_for_update(key_share=True)
        )
        t = now()
        ent = await db.get(Entitlement, payment.user_id, with_for_update=True)
        plan: PlanId = "season" if payment.plan == "season" else "month"
        if ent is None:
            db.add(
                Entitlement(
                    user_id=payment.user_id,
                    plan=plan,
                    valid_until=billing.extend(None, plan, t),
                    updated_at=t,
                )
            )
        else:
            ent.plan = plan
            ent.valid_until = billing.extend(as_utc(ent.valid_until), plan, t)
            ent.updated_at = t
        await db.commit()
        logger.info("payment received", extra={"inv_id": payment.id, "plan": plan})
    # Repeated callbacks for a paid invoice are acknowledged without extending again.
    return f"OK{payment.id}"
