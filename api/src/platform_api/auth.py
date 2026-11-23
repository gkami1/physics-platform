"""Accounts: sign-up, sign-in by password or by one-time email code, password reset.

An account is created only after its email is confirmed: the sign-up form waits in the
code row (`login_codes.signup`) until the code is typed. OAuth providers (Yandex ID,
VK ID) come later as `auth_identities`.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, delete, func, null, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from platform_api.actor import (
    ANON_COOKIE,
    SESSION_COOKIE,
    SessionUser,
    clear_cookie,
    now,
    start_session,
    token_hash,
)
from platform_api.db import (
    Attempt,
    AuthSession,
    ConsentEvent,
    LoginCode,
    PasswordFailure,
    TheoryVisit,
    User,
    VariantRun,
)
from platform_api.deps import Db
from platform_api.mail import CodePurpose, Mailer, code_email
from platform_api.passwords import hash_password, needs_rehash, verify_password
from platform_api.profile import normalize_email, normalize_name, normalize_phone, password_ok

logger = logging.getLogger("api.auth")

CODE_TTL = timedelta(minutes=10)
MAX_TRIES_PER_CODE = 5
# (window, max) pairs.
Limits = tuple[tuple[timedelta, int], ...]
# Codes sent per address, then per client IP.
EMAIL_LIMITS: Limits = ((timedelta(minutes=1), 1), (timedelta(hours=1), 5))
IP_LIMITS: Limits = ((timedelta(hours=1), 20),)
# Wrong passwords per address, then per client IP.
PASSWORD_EMAIL_LIMITS: Limits = ((timedelta(minutes=15), 10),)
PASSWORD_IP_LIMITS: Limits = ((timedelta(minutes=15), 50),)

_CODE_RE = re.compile(r"^\d{6}$")


def new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def code_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


class SignupRequest(BaseModel):
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    email: str = Field(max_length=254)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(max_length=256)
    consent: bool
    marketing: bool = False


class CodeRequest(BaseModel):
    email: str = Field(max_length=254)
    purpose: Literal["login", "reset"] = "login"


class VerifyRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class ResetRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)
    password: str = Field(max_length=256)


class ProfileUpdate(BaseModel):
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    marketing: bool


class Me(BaseModel):
    email: str
    first_name: str | None
    last_name: str | None
    phone: str | None
    marketing: bool
    has_password: bool

    @classmethod
    def of(cls, user: User) -> Me:
        return cls(
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            phone=user.phone,
            marketing=user.marketing_consent_at is not None,
            has_password=user.password_hash is not None,
        )


class MeResponse(BaseModel):
    user: Me | None


router = APIRouter(prefix="/api")


def _email_or_422(raw: str) -> str:
    email = normalize_email(raw)
    if email is None:
        raise HTTPException(422, "invalid_email")
    return email


def _name_or_422(raw: str) -> str:
    name = normalize_name(raw)
    if name is None:
        raise HTTPException(422, "invalid_name")
    return name


def _phone_or_422(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    phone = normalize_phone(raw)
    if phone is None:
        raise HTTPException(422, "invalid_phone")
    return phone


def _password_or_422(password: str) -> str:
    if not password_ok(password):
        raise HTTPException(422, "weak_password")
    return password


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def _over_limit(
    db: AsyncSession,
    model: type[LoginCode] | type[PasswordFailure],
    checks: list[tuple[ColumnElement[bool], Limits]],
) -> bool:
    t = now()
    for where, limits in checks:
        for window, limit in limits:
            q = select(func.count()).select_from(model).where(where, model.created_at > t - window)
            if ((await db.scalar(q)) or 0) >= limit:
                return True
    return False


async def _check_code_limits(db: AsyncSession, email: str, ip: str | None) -> None:
    checks = [(LoginCode.email == email, EMAIL_LIMITS)]
    if ip:
        checks.append((LoginCode.ip == ip, IP_LIMITS))
    if await _over_limit(db, LoginCode, checks):
        raise HTTPException(429, "too_many_codes")


async def _send_code(
    db: AsyncSession,
    request: Request,
    email: str,
    purpose: CodePurpose,
    signup: dict[str, Any] | None = None,
) -> dict[str, int]:
    """Store and email a new code. Call `_check_code_limits` first."""
    t = now()
    # Sign-up forms nobody confirmed hold personal data: drop them once their code expires.
    await db.execute(
        update(LoginCode)
        .where(LoginCode.signup.is_not(None), LoginCode.expires_at <= t)
        .values(signup=null())
    )
    code = new_code()
    db.add(
        LoginCode(
            email=email,
            code_hash=code_hash(email, code),
            ip=_ip(request),
            tries=0,
            signup=signup,
            created_at=t,
            expires_at=t + CODE_TTL,
        )
    )
    await db.commit()
    mailer: Mailer = request.app.state.mailer
    subject, text = code_email(code, int(CODE_TTL.total_seconds() // 60), purpose)
    try:
        await mailer.send(email, subject, text)
    except Exception:
        logger.exception("code email failed")
        raise HTTPException(503, "mail_failed") from None
    return {"expires_in": int(CODE_TTL.total_seconds())}


async def _consume_code(db: AsyncSession, email: str, raw_code: str) -> LoginCode:
    """The address's latest live code, marked used if `raw_code` matches it. Wrong tries
    are committed; the caller commits the success."""
    code = raw_code.strip()
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
    return row


async def _user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == email))


async def _sign_in(
    db: AsyncSession, request: Request, response: Response, user: User
) -> MeResponse:
    anon = request.cookies.get(ANON_COOKIE)
    if anon:
        # Practice done before signing in moves into the account.
        for model in (Attempt, VariantRun, TheoryVisit):
            await db.execute(
                update(model)
                .where(model.anon_id == anon, model.user_id.is_(None))
                .values(user_id=user.id)
            )
        clear_cookie(response, ANON_COOKIE)
    await start_session(db, request, response, user)
    await db.commit()
    return MeResponse(user=Me.of(user))


def _consent_event(
    user: User,
    kind: Literal["personal_data", "marketing"],
    granted: bool,
    ip: str | None,
    at: datetime,
) -> ConsentEvent:
    return ConsentEvent(user_id=user.id, kind=kind, granted=granted, ip=ip, created_at=at)


@router.post("/auth/signup", status_code=202)
async def signup(body: SignupRequest, request: Request, db: Db) -> dict[str, int]:
    """Check the form and email a code; the account appears when the code is typed."""
    if not body.consent:
        raise HTTPException(422, "consent_required")
    first_name = _name_or_422(body.first_name)
    last_name = _name_or_422(body.last_name)
    email = _email_or_422(body.email)
    phone = _phone_or_422(body.phone)
    password = _password_or_422(body.password)
    ip = _ip(request)
    if await _user_by_email(db, email) is not None:
        raise HTTPException(409, "email_taken")
    await _check_code_limits(db, email, ip)  # before hashing: that costs CPU
    form = {
        "first_name": first_name,
        "last_name": last_name,
        "phone": phone,
        "password_hash": await hash_password(password),
        "marketing": body.marketing,
        "consented_at": now().isoformat(),
        "ip": ip,
    }
    return await _send_code(db, request, email, "signup", form)


@router.post("/auth/code", status_code=202)
async def request_code(body: CodeRequest, request: Request, db: Db) -> dict[str, int]:
    """A code to sign in (`login`) or to set a new password (`reset`), existing accounts
    only: new ones go through /auth/signup."""
    email = _email_or_422(body.email)
    await _check_code_limits(db, email, _ip(request))
    if await _user_by_email(db, email) is None:
        raise HTTPException(404, "no_account")
    return await _send_code(db, request, email, body.purpose)


@router.post("/auth/verify")
async def verify_code(
    body: VerifyRequest, request: Request, response: Response, db: Db
) -> MeResponse:
    email = _email_or_422(body.email)
    row = await _consume_code(db, email, body.code)
    form, row.signup = row.signup, None
    user = await _user_by_email(db, email)
    if user is None:
        if form is None:
            await db.commit()
            raise HTTPException(400, "no_account")
        user = await _create_user(db, email, form)
    return await _sign_in(db, request, response, user)


async def _create_user(db: AsyncSession, email: str, form: dict[str, Any]) -> User:
    consented_at = datetime.fromisoformat(form["consented_at"])
    user = User(
        email=email,
        first_name=form["first_name"],
        last_name=form["last_name"],
        phone=form["phone"],
        password_hash=form["password_hash"],
        consented_at=consented_at,
        marketing_consent_at=consented_at if form["marketing"] else None,
        created_at=now(),
    )
    db.add(user)
    await db.flush()
    db.add(_consent_event(user, "personal_data", True, form["ip"], consented_at))
    if form["marketing"]:
        db.add(_consent_event(user, "marketing", True, form["ip"], consented_at))
    return user


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response, db: Db) -> MeResponse:
    email = normalize_email(body.email)
    if email is None:
        raise HTTPException(400, "wrong_credentials")
    ip = _ip(request)
    checks = [(PasswordFailure.email == email, PASSWORD_EMAIL_LIMITS)]
    if ip:
        checks.append((PasswordFailure.ip == ip, PASSWORD_IP_LIMITS))
    if await _over_limit(db, PasswordFailure, checks):
        raise HTTPException(429, "too_many_attempts")
    user = await _user_by_email(db, email)
    stored = user.password_hash if user else None
    # Same answer, and about the same time (a dummy hash is checked), for a missing
    # account, an account without a password and a wrong password.
    ok = await verify_password(stored, body.password)
    if user is None or stored is None or not ok:
        db.add(PasswordFailure(email=email, ip=ip, created_at=now()))
        await db.commit()
        raise HTTPException(400, "wrong_credentials")
    if needs_rehash(stored):
        user.password_hash = await hash_password(body.password)
    return await _sign_in(db, request, response, user)


@router.post("/auth/reset")
async def reset_password(
    body: ResetRequest, request: Request, response: Response, db: Db
) -> MeResponse:
    """Set a new password with a code from /auth/code. Signs out every other device."""
    email = _email_or_422(body.email)
    password = _password_or_422(body.password)
    row = await _consume_code(db, email, body.code)
    row.signup = None
    user = await _user_by_email(db, email)
    if user is None:
        await db.commit()
        raise HTTPException(400, "no_account")
    user.password_hash = await hash_password(password)
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    return await _sign_in(db, request, response, user)


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
async def me(user: SessionUser) -> MeResponse:
    return MeResponse(user=Me.of(user) if user else None)


@router.patch("/me")
async def update_me(body: ProfileUpdate, request: Request, user: SessionUser, db: Db) -> MeResponse:
    if user is None:
        raise HTTPException(401, "sign_in_required")
    user.first_name = _name_or_422(body.first_name)
    user.last_name = _name_or_422(body.last_name)
    user.phone = _phone_or_422(body.phone)
    if body.marketing != (user.marketing_consent_at is not None):
        t = now()
        user.marketing_consent_at = t if body.marketing else None
        db.add(_consent_event(user, "marketing", body.marketing, _ip(request), t))
    await db.commit()
    return MeResponse(user=Me.of(user))
