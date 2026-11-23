import hashlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, unquote, urlsplit

import pytest

from platform_api import billing
from platform_api.access import TutorLimit, daily_limit
from platform_api.billing import MSK


def msk(*args: int) -> datetime:
    return datetime(*args, tzinfo=MSK).astimezone(UTC)  # type: ignore[misc]


@pytest.mark.parametrize(
    ("now", "end"),
    [
        (msk(2026, 11, 15, 12, 0), msk(2027, 6, 30, 23, 59, 59)),
        (msk(2027, 1, 1, 0, 0), msk(2027, 6, 30, 23, 59, 59)),
        # 31 May is still this season; from 1 June (Moscow time) a pass is for the next one.
        (msk(2027, 5, 31, 23, 59), msk(2027, 6, 30, 23, 59, 59)),
        (msk(2027, 6, 1, 0, 0), msk(2028, 6, 30, 23, 59, 59)),
        # 31 May 22:00 UTC is already 1 June in Moscow.
        (datetime(2027, 5, 31, 22, 0, tzinfo=UTC), msk(2028, 6, 30, 23, 59, 59)),
        (msk(2027, 8, 20, 9, 0), msk(2028, 6, 30, 23, 59, 59)),
    ],
)
def test_season_end(now: datetime, end: datetime) -> None:
    assert billing.season_end(now) == end


NOW = msk(2026, 11, 15, 12, 0)


@pytest.mark.parametrize(
    ("valid_until", "plan", "expected"),
    [
        (None, "month", NOW + timedelta(days=30)),
        # Expired access starts from now, not from its old end.
        (NOW - timedelta(days=3), "month", NOW + timedelta(days=30)),
        # Active access is extended from its end.
        (NOW + timedelta(days=10), "month", NOW + timedelta(days=40)),
        (None, "season", msk(2027, 6, 30, 23, 59, 59)),
        (NOW + timedelta(days=10), "season", msk(2027, 6, 30, 23, 59, 59)),
        # A season pass never shortens access that already runs past the season.
        (msk(2027, 7, 15), "season", msk(2027, 7, 15)),
    ],
)
def test_extend(valid_until: datetime | None, plan: billing.PlanId, expected: datetime) -> None:
    assert billing.extend(valid_until, plan, NOW) == expected


@pytest.mark.parametrize(
    ("kop", "text"), [(69000, "690.00"), (299000, "2990.00"), (5, "0.05"), (100050, "1000.50")]
)
def test_format_sum(kop: int, text: str) -> None:
    assert billing.format_sum(kop) == text
    assert billing.parse_sum(text) == kop


@pytest.mark.parametrize(
    ("raw", "kop"),
    [
        ("690.000000", 69000),
        ("690", 69000),
        (" 2990.00 ", 299000),
        ("690.005", None),
        ("-1", None),
        ("abc", None),
        ("", None),
        ("NaN", None),
        ("Infinity", None),
        ("6.9e2", None),
        ("6_90", None),
    ],
)
def test_parse_sum(raw: str, kop: int | None) -> None:
    assert billing.parse_sum(raw) == kop


@pytest.mark.parametrize("algo", ["md5", "sha256"])
def test_result_signature(algo: billing.HashName) -> None:
    good = hashlib.new(algo, b"690.000000:17:pass-two").hexdigest()
    assert billing.verify_result("690.000000", "17", good, "pass-two", algo)
    # Robokassa sends the hash in upper case.
    assert billing.verify_result("690.000000", "17", good.upper(), "pass-two", algo)
    assert not billing.verify_result("690.000000", "18", good, "pass-two", algo)
    assert not billing.verify_result("1.000000", "17", good, "pass-two", algo)
    assert not billing.verify_result("690.000000", "17", good, "pass-one", algo)
    assert not billing.verify_result("690.000000", "17", "", "pass-two", algo)


def test_checkout_url() -> None:
    shop = billing.Shop("demo-shop", "pass-one", "md5", test=True)
    plan = billing.plans(69000, 299000)["month"]
    url = billing.checkout_url(shop, 42, plan, "student@example.ru")
    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == billing.CHECKOUT_URL
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert q["MerchantLogin"] == "demo-shop"
    assert q["OutSum"] == "690.00"
    assert q["InvId"] == "42"
    assert q["Email"] == "student@example.ru"
    assert q["IsTest"] == "1"
    # The query carries the URL-encoded receipt (encoded once more for the URL itself).
    receipt = json.loads(unquote(q["Receipt"]))
    assert receipt["items"] == [
        {
            "name": "Физика ЕГЭ: доступ на 30 дней",
            "quantity": 1,
            "sum": 690.0,
            "payment_method": "full_payment",
            "payment_object": "service",
            "tax": "none",
        }
    ]
    signed = f"demo-shop:690.00:42:{q['Receipt']}:pass-one".encode()
    expected = hashlib.md5(signed).hexdigest()  # noqa: S324 — Robokassa's default hash
    assert q["SignatureValue"] == expected


def test_checkout_url_live_mode_has_no_test_flag() -> None:
    shop = billing.Shop("demo-shop", "pass-one", "sha256", test=False)
    url = billing.checkout_url(shop, 1, billing.plans(69000, 299000)["season"], "a@b.ru")
    assert "IsTest" not in parse_qs(urlsplit(url).query)


@pytest.mark.parametrize(
    ("paid", "spend", "budget", "expected"),
    [
        (False, 0, 40000, TutorLimit(20, False)),
        (True, 0, 40000, TutorLimit(100, True)),
        (True, 39999, 40000, TutorLimit(100, True)),
        # Fair use spent: back to the free cap, still shown as a paid user.
        (True, 40000, 40000, TutorLimit(20, True)),
        # Budget 0 turns the check off.
        (True, 10**9, 0, TutorLimit(100, True)),
    ],
)
def test_daily_limit(paid: bool, spend: int, budget: int, expected: TutorLimit) -> None:
    assert daily_limit(paid, spend, free=20, paid_cap=100, budget_kop=budget) == expected
