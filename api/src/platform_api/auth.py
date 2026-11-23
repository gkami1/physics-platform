"""Sign-in by one-time email code. OAuth providers (Yandex ID, VK ID) come later."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, select, update

from platform_api.access import paid_until
from platform_api.actor import (
    ANON_COOKIE,
    SESSION_COOKIE,
    SessionUser,
    clear_cookie,
    now,
    start_session,
    token_hash,
)
from platform_api.db import Attempt, AuthSession, LoginCode, User, VariantRun
from platform_api.deps import Db
from platform_api.mail import Mailer, login_code_email

logger = logging.getLogger("api.auth")

CODE_TTL = timedelta(minutes=10)
MAX_TRIES_PER_CODE = 5
# (window, max codes) — per address, then per client IP.
EMAIL_LIMITS = ((timedelta(minutes=1), 1), (timedelta(hours=1), 5))
IP_LIMITS = ((timedelta(hours=1), 20),)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CODE_RE = re.compile(r"^\d{6}$")


def normalize_email(raw: str) -> str | None:
    email = raw.strip().lower()
    return email if len(email) <= 254 and _EMAIL_RE.fullmatch(email) else None


def new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def code_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


class CodeRequest(BaseModel):
    email: str = Field(max_length=254)
    consent: bool


class VerifyRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)
    # Version of the personal-data consent text shown next to the checkbox.
    consent_version: str | None = Field(default=None, max_length=32)


class Me(BaseModel):
    email: str
    # End of paid access, if any is active now.
    paid_until: datetime | None = None


class MeResponse(BaseModel):
    user: Me | None


router = APIRouter(prefix="/api")


def _email_or_422(raw: str) -> str:
    email = normalize_email(raw)
    if email is None:
        raise HTTPException(422, "invalid_email")
    return email


@router.post("/auth/code", status_code=202)
async def request_code(body: CodeRequest, request: Request, db: Db) -> dict[str, int]:
    if not body.consent:
        raise HTTPException(422, "consent_required")
    email = _email_or_422(body.email)
    ip = request.client.host if request.client else None
    t = now()

    async def recent(where: ColumnElement[bool], window: timedelta) -> int:
        q = (
            select(func.count())
            .select_from(LoginCode)
            .where(where, LoginCode.created_at > t - window)
        )
        return (await db.scalar(q)) or 0

    for window, limit in EMAIL_LIMITS:
        if await recent(LoginCode.email == email, window) >= limit:
            raise HTTPException(429, "too_many_codes")
    if ip:
        for window, limit in IP_LIMITS:
            if await recent(LoginCode.ip == ip, window) >= limit:
                raise HTTPException(429, "too_many_codes")

    code = new_code()
    db.add(
        LoginCode(
            email=email,
            code_hash=code_hash(email, code),
            ip=ip,
            tries=0,
            created_at=t,
            expires_at=t + CODE_TTL,
        )
    )
    await db.commit()
    mailer: Mailer = request.app.state.mailer
    subject, text = login_code_email(code, int(CODE_TTL.total_seconds() // 60))
    try:
        await mailer.send(email, subject, text)
    except Exception:
        logger.exception("login code email failed")
        raise HTTPException(503, "mail_failed") from None
    # Same answer for new and existing addresses: no account enumeration.
    return {"expires_in": int(CODE_TTL.total_seconds())}


@router.post("/auth/verify")
async def verify_code(
    body: VerifyRequest, request: Request, response: Response, db: Db
) -> MeResponse:
    email = _email_or_422(body.email)
    code = body.code.strip()
    t = now()
    row = await db.scalar(
        select(LoginCode)
        .where(LoginCode.email == email, LoginCode.used_at.is_(None), LoginCode.expires_at > t)
        .order_by(LoginCode.created_at.desc(), LoginCode.id.desc())
        .limit(1)
    )
    if row is None:
        raise HTTPException(400, "code_expired")
    if row.tries >= MAX_TRIES_PER_CODE:
        raise HTTPException(400, "too_many_tries")
    row.tries += 1
    if not (
        _CODE_RE.fullmatch(code) and hmac.compare_digest(row.code_hash, code_hash(email, code))
    ):
        await db.commit()
        raise HTTPException(400, "wrong_code")
    row.used_at = t

    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, consented_at=t, consent_version=body.consent_version, created_at=t)
        db.add(user)
        await db.flush()

    anon = request.cookies.get(ANON_COOKIE)
    if anon:
        # Practice done before signing in moves into the account.
        for model in (Attempt, VariantRun):
            await db.execute(
                update(model)
                .where(model.anon_id == anon, model.user_id.is_(None))
                .values(user_id=user.id)
            )
        clear_cookie(response, ANON_COOKIE)
    await start_session(db, request, response, user)
    await db.commit()
    return MeResponse(user=Me(email=user.email, paid_until=await paid_until(db, user)))


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, db: Db) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        sess = await db.get(AuthSession, token_hash(token))
        if sess is not None:
            await db.delete(sess)
            await db.commit()
    clear_cookie(response, SESSION_COOKIE)
    clear_cookie(response, ANON_COOKIE)


@router.get("/me")
async def me(user: SessionUser, db: Db) -> MeResponse:
    if user is None:
        return MeResponse(user=None)
    return MeResponse(user=Me(email=user.email, paid_until=await paid_until(db, user)))
