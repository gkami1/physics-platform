"""Plans, access periods and Robokassa signatures. Pure functions: no I/O, no settings.

Robokassa protocol (https://docs.robokassa.ru/):
- Checkout: redirect to Merchant/Index.aspx with MerchantLogin, OutSum, InvId, Receipt and
  SignatureValue = hash("MerchantLogin:OutSum:InvId:Receipt:Password1"), where Receipt is
  the URL-encoded JSON (and is URL-encoded once more as a query parameter).
- ResultURL (server to server): OutSum, InvId, SignatureValue = hash("OutSum:InvId:Password2");
  the shop answers "OK<InvId>" or Robokassa keeps retrying.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote, urlencode

PlanId = Literal["month", "season"]
HashName = Literal["md5", "sha256", "sha384", "sha512"]

CHECKOUT_URL = "https://auth.robokassa.ru/Merchant/Index.aspx"
# Moscow has had no daylight saving since 2014: a fixed offset needs no tzdata on Windows.
MSK = timezone(timedelta(hours=3), "MSK")
MONTH = timedelta(days=30)


@dataclass(frozen=True)
class Plan:
    id: PlanId
    title: str
    price_kop: int


def plans(price_month_kop: int, price_season_kop: int) -> dict[PlanId, Plan]:
    return {
        "month": Plan("month", "Доступ на 30 дней", price_month_kop),
        "season": Plan("season", "Доступ до конца сезона", price_season_kop),
    }


def season_end(now: datetime) -> datetime:
    """End of the exam season a pass bought now covers: 30 June, 23:59:59 Moscow time.

    From 1 June on it is next year's season, so nobody buys a «season» of a few days."""
    year = now.astimezone(MSK).year
    if now.astimezone(MSK).month >= 6:
        year += 1
    return datetime(year, 6, 30, 23, 59, 59, tzinfo=MSK).astimezone(UTC)


def extend(valid_until: datetime | None, plan: PlanId, now: datetime) -> datetime:
    """New end of access after paying for `plan`. Never moves the end backwards."""
    current = valid_until if valid_until is not None and valid_until > now else now
    if plan == "month":
        return current + MONTH
    return max(current, season_end(now))


def format_sum(kop: int) -> str:
    """Robokassa's OutSum: roubles with two decimals, e.g. 69000 -> "690.00"."""
    return f"{kop // 100}.{kop % 100:02d}"


def parse_sum(raw: str) -> int | None:
    """OutSum as received ("690.000000" or "690.00") -> kopecks; None if malformed."""
    match = re.fullmatch(r"([0-9]{1,10})(?:\.([0-9]{1,2})0{0,6})?", raw.strip())
    if match is None:
        return None
    rubles, fraction = match.groups()
    return int(rubles) * 100 + int((fraction or "").ljust(2, "0"))


def digest(text: str, algo: HashName) -> str:
    return hashlib.new(algo, text.encode()).hexdigest()


def receipt(item: str, kop: int) -> str:
    """Receipt JSON (54-FZ fields). For самозанятые Robokassa registers it in «Мой налог»."""
    return json.dumps(
        {
            "items": [
                {
                    "name": item[:128],
                    "quantity": 1,
                    "sum": float(format_sum(kop)),
                    "payment_method": "full_payment",
                    "payment_object": "service",
                    "tax": "none",
                }
            ]
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def sign_checkout(
    login: str, out_sum: str, inv_id: int, receipt_encoded: str, password1: str, algo: HashName
) -> str:
    return digest(f"{login}:{out_sum}:{inv_id}:{receipt_encoded}:{password1}", algo)


def verify_result(
    out_sum: str, inv_id: str, signature: str, password2: str, algo: HashName
) -> bool:
    expected = digest(f"{out_sum}:{inv_id}:{password2}", algo)
    return signature.isascii() and hmac.compare_digest(expected, signature.strip().lower())


@dataclass(frozen=True)
class Shop:
    login: str
    password1: str
    algo: HashName
    test: bool


def checkout_url(shop: Shop, inv_id: int, plan: Plan, email: str) -> str:
    out_sum = format_sum(plan.price_kop)
    description = f"Физика ЕГЭ: {plan.title.lower()}"
    receipt_encoded = quote(receipt(description, plan.price_kop), safe="")
    params = {
        "MerchantLogin": shop.login,
        "OutSum": out_sum,
        "InvId": str(inv_id),
        "Description": description,
        "Receipt": receipt_encoded,
        "Email": email,
        "Culture": "ru",
        "Encoding": "utf-8",
        "SignatureValue": sign_checkout(
            shop.login, out_sum, inv_id, receipt_encoded, shop.password1, shop.algo
        ),
    }
    if shop.test:
        params["IsTest"] = "1"
    return f"{CHECKOUT_URL}?{urlencode(params)}"
