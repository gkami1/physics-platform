import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from platform_api.actor import as_utc, now
from platform_api.db import (
    Entitlement,
    LlmCall,
    Payment,
    TutorMessage,
    TutorThread,
    User,
    make_engine,
    make_sessionmaker,
)

PASS2 = "pass-two"


def md5(text: str) -> str:
    """Robokassa's default signature hash (the protocol's choice, not ours)."""
    return hashlib.md5(text.encode()).hexdigest()  # noqa: S324


def run_db(url: str, fn: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async def run() -> Any:
        engine = make_engine(url)
        async with make_sessionmaker(engine)() as s:
            result = await fn(s)
            await s.commit()
        await engine.dispose()
        return result

    return asyncio.run(run())


@pytest.fixture
def shop(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    s = client.app.state.settings  # type: ignore[attr-defined]
    monkeypatch.setattr(s, "robokassa_login", "demo-shop")
    monkeypatch.setattr(s, "robokassa_password1", "pass-one")
    monkeypatch.setattr(s, "robokassa_password2", PASS2)
    return client


def checkout(client: TestClient, plan: str = "month") -> int:
    r = client.post("/api/billing/checkout", json={"plan": plan, "accept_offer": True})
    assert r.status_code == 200, r.text
    q = parse_qs(urlsplit(r.json()["url"]).query)
    return int(q["InvId"][0])


def result(
    client: TestClient, inv_id: int, out_sum: str = "690.000000", password: str = PASS2
) -> Response:
    sig = md5(f"{out_sum}:{inv_id}:{password}").upper()
    return client.post(
        "/api/billing/robokassa/result",
        data={"OutSum": out_sum, "InvId": str(inv_id), "SignatureValue": sig},
    )


def test_plans_are_public(client: TestClient) -> None:
    r = client.get("/api/billing/plans")
    assert r.status_code == 200
    body = r.json()
    assert [(p["id"], p["price_kop"]) for p in body["plans"]] == [
        ("month", 69000),
        ("season", 299000),
    ]
    assert body["enabled"] is False
    assert body["paid_until"] is None


def test_checkout_needs_sign_in(shop: TestClient) -> None:
    r = shop.post("/api/billing/checkout", json={"plan": "month", "accept_offer": True})
    assert r.status_code == 401


def test_checkout_rules(signed_in: TestClient) -> None:
    r = signed_in.post("/api/billing/checkout", json={"plan": "month", "accept_offer": False})
    assert r.json()["detail"] == "offer_required"
    r = signed_in.post("/api/billing/checkout", json={"plan": "month", "accept_offer": True})
    assert (r.status_code, r.json()["detail"]) == (503, "payments_unavailable")
    r = signed_in.post("/api/billing/checkout", json={"plan": "year", "accept_offer": True})
    assert r.status_code == 422


def test_checkout_locks_in_the_configured_price(
    shop: TestClient, signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = signed_in.app.state.settings  # type: ignore[attr-defined]
    monkeypatch.setattr(settings, "price_month_kop", 74550)
    response = signed_in.post(
        "/api/billing/checkout", json={"plan": "month", "accept_offer": True, "amount_kop": 1}
    )
    assert response.status_code == 200
    params = parse_qs(urlsplit(response.json()["url"]).query)
    assert params["OutSum"] == ["745.50"]
    inv = int(params["InvId"][0])

    monkeypatch.setattr(settings, "price_month_kop", 79000)
    assert result(shop, inv, out_sum="790.00").status_code == 400
    assert result(shop, inv, out_sum="745.500000").text == f"OK{inv}"


def test_payment_grants_access_once(shop: TestClient, signed_in: TestClient) -> None:
    inv = checkout(signed_in)
    assert signed_in.get("/api/me").json()["user"]["paid_until"] is None

    r = result(signed_in, inv)
    assert (r.status_code, r.text) == (200, f"OK{inv}")
    until = signed_in.get("/api/me").json()["user"]["paid_until"]
    assert until is not None
    assert signed_in.get("/api/billing/plans").json()["paid_until"] == until

    # Robokassa retries until it sees OK: a repeat must not extend access again.
    r = result(signed_in, inv)
    assert (r.status_code, r.text) == (200, f"OK{inv}")
    assert signed_in.get("/api/me").json()["user"]["paid_until"] == until


def test_second_pass_extends_access(
    shop: TestClient, signed_in: TestClient, migrated_db: str
) -> None:
    result(signed_in, checkout(signed_in))
    result(signed_in, checkout(signed_in))

    async def until(s: AsyncSession) -> Any:
        return (await s.scalars(select(Entitlement))).one().valid_until

    left = as_utc(run_db(migrated_db, until)) - now()
    assert timedelta(days=59) < left <= timedelta(days=60)


def test_concurrent_payments_and_retries_grant_access_once_per_invoice(
    shop: TestClient, signed_in: TestClient
) -> None:
    first, second = checkout(signed_in), checkout(signed_in)
    invoices = [first, first, second]
    with ThreadPoolExecutor(max_workers=len(invoices)) as pool:
        callbacks = list(pool.map(lambda inv: result(shop, inv), invoices))
    assert [(r.status_code, r.text) for r in callbacks] == [(200, f"OK{i}") for i in invoices]
    until = signed_in.get("/api/me").json()["user"]["paid_until"]
    assert timedelta(days=59) < datetime.fromisoformat(until) - now() <= timedelta(days=60)


def test_status_checks_the_specific_invoice_and_requires_its_owner(
    shop: TestClient, signed_in: TestClient, sign_up: Callable[[str], None]
) -> None:
    result(shop, checkout(signed_in))
    inv = checkout(signed_in)
    path = f"/api/billing/payments/{inv}"
    pending = signed_in.get(path)
    assert pending.json() == {"status": "pending", "paid_until": None}
    assert pending.headers["cache-control"] == "no-store"

    assert result(shop, inv).text == f"OK{inv}"
    until = signed_in.get("/api/me").json()["user"]["paid_until"]
    assert signed_in.get(path).json() == {"status": "paid", "paid_until": until}
    assert signed_in.get("/api/billing/payments/999999").status_code == 404

    assert signed_in.post("/api/auth/logout").status_code == 204
    assert signed_in.get(path).status_code == 401

    sign_up("other@example.ru")
    assert signed_in.get(path).status_code == 404


@pytest.mark.parametrize(
    ("kwargs", "status"),
    [
        ({"password": "pass-one"}, 400),  # signed with the wrong password
        ({"out_sum": "1.000000"}, 400),  # signature fine, amount not the invoice's
    ],
)
def test_bad_callbacks_change_nothing(
    shop: TestClient, signed_in: TestClient, kwargs: dict[str, str], status: int
) -> None:
    inv = checkout(signed_in)
    assert result(signed_in, inv, **kwargs).status_code == status
    assert signed_in.get("/api/me").json()["user"]["paid_until"] is None


def test_unknown_invoice(shop: TestClient) -> None:
    assert result(shop, 999_999).status_code == 404


def test_malformed_callback_is_rejected(shop: TestClient) -> None:
    bad_signature = shop.post(
        "/api/billing/robokassa/result",
        data={"OutSum": "690.00", "InvId": "1", "SignatureValue": "не подпись"},
    )
    assert bad_signature.status_code == 400
    assert result(shop, 2**63).status_code == 400


def test_callback_without_shop_is_refused(client: TestClient) -> None:
    assert result(client, 1).status_code == 503


def test_get_callback(shop: TestClient, signed_in: TestClient) -> None:
    inv = checkout(signed_in)
    sig = md5(f"690.00:{inv}:{PASS2}")
    r = signed_in.get(
        "/api/billing/robokassa/result",
        params={"OutSum": "690.00", "InvId": str(inv), "SignatureValue": sig},
    )
    assert (r.status_code, r.text) == (200, f"OK{inv}")


def test_pending_checkouts_are_limited(shop: TestClient, signed_in: TestClient) -> None:
    for _ in range(10):
        checkout(signed_in)
    r = signed_in.post("/api/billing/checkout", json={"plan": "month", "accept_offer": True})
    assert r.status_code == 429


def tutor_meta(client: TestClient) -> dict[str, object]:
    thread = client.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    return {k: thread[k] for k in ("messages_left", "daily_limit", "paid")}


def test_tutor_limits_follow_access(
    shop: TestClient, signed_in: TestClient, migrated_db: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert tutor_meta(signed_in) == {"messages_left": 20, "daily_limit": 20, "paid": False}

    result(signed_in, checkout(signed_in))
    assert tutor_meta(signed_in) == {"messages_left": 100, "daily_limit": 100, "paid": True}

    # Fair use: once the month's model spend reaches the budget, the free cap applies.
    async def spend(s: AsyncSession) -> None:
        user = (await s.scalars(select(User))).one()
        thread = TutorThread(user_id=user.id, context_kind="task", context_id="kin-0001")
        s.add(thread)
        await s.flush()
        msg = TutorMessage(
            thread_id=thread.id, user_id=user.id, role="assistant", content="…", created_at=now()
        )
        s.add(msg)
        await s.flush()
        s.add(
            LlmCall(
                message_id=msg.id,
                provider="test",
                model="m",
                prompt_version="v",
                cost_kop=40000,
                created_at=now(),
            )
        )

    run_db(migrated_db, spend)
    assert tutor_meta(signed_in) == {"messages_left": 20, "daily_limit": 20, "paid": True}

    # Budget 0 turns fair use off.
    monkeypatch.setattr(signed_in.app.state.settings, "tutor_paid_monthly_budget_kop", 0)  # type: ignore[attr-defined]
    assert tutor_meta(signed_in)["daily_limit"] == 100

    # Expired pass: the free cap again.
    async def expire(s: AsyncSession) -> None:
        await s.execute(update(Entitlement).values(valid_until=now() - timedelta(seconds=1)))

    run_db(migrated_db, expire)
    assert tutor_meta(signed_in) == {"messages_left": 20, "daily_limit": 20, "paid": False}


def test_payment_records_offer_and_callback(
    shop: TestClient, signed_in: TestClient, migrated_db: str
) -> None:
    inv = checkout(signed_in, "season")
    assert result(signed_in, inv, out_sum="2990.000000").text == f"OK{inv}"

    async def payment(s: AsyncSession) -> Payment:
        p = await s.get(Payment, inv)
        assert p is not None
        return p

    p = run_db(migrated_db, payment)
    assert (p.plan, p.status, p.amount_kop) == ("season", "paid", 299000)
    assert p.offer_version
    assert p.raw == {"OutSum": "2990.000000", "InvId": str(inv)}
    assert p.paid_at is not None
