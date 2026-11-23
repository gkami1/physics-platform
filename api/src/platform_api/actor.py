"""Who is acting: a signed-in user (session cookie) or an anonymous visitor (pp_anon cookie)."""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_api.db import Attempt, AuthSession, TheoryVisit, User, VariantRun
from platform_api.deps import Db

ANON_COOKIE = "pp_anon"
SESSION_COOKIE = "pp_session"
_ANON_RE = re.compile(r"^[0-9a-f]{32}$")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_YEAR = 60 * 60 * 24 * 365
SESSION_TTL = timedelta(days=60)


def now() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; everything we store is UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class Actor:
    user: User | None
    anon_id: str | None

    @property
    def user_id(self) -> int | None:
        return self.user.id if self.user else None

    def owns(
        self, model: type[Attempt | VariantRun | TheoryVisit] = Attempt
    ) -> ColumnElement[bool]:
        """Filter for this actor's rows (attempts, variant runs, theory visits). Anonymous rows
        already merged into an account stay hidden from the cookie, so signing out on a shared
        device hides the history."""
        if self.user is not None:
            return model.user_id == self.user.id
        return and_(model.anon_id == self.anon_id, model.user_id.is_(None))


def _set_cookie(request: Request, response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.secure_cookies,
        path="/api",
    )


def clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/api")


def anon_id(request: Request, response: Response) -> str:
    current = request.cookies.get(ANON_COOKIE, "")
    if _ANON_RE.fullmatch(current):
        return current
    new = secrets.token_hex(16)
    _set_cookie(request, response, ANON_COOKIE, new, _YEAR)
    return new


async def start_session(db: AsyncSession, request: Request, response: Response, user: User) -> None:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(id=token_hash(token), user_id=user.id, expires_at=now() + SESSION_TTL))
    _set_cookie(request, response, SESSION_COOKIE, token, int(SESSION_TTL.total_seconds()))


async def session_user(request: Request, response: Response, db: Db) -> User | None:
    """The signed-in user, or None. Sessions slide: used in their second half, they renew."""
    token = request.cookies.get(SESSION_COOKIE, "")
    if not _TOKEN_RE.fullmatch(token):
        return None
    t = now()
    row = (
        await db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.id == token_hash(token), AuthSession.expires_at > t)
        )
    ).first()
    if row is None:
        clear_cookie(response, SESSION_COOKIE)
        return None
    sess, user = row
    if as_utc(sess.expires_at) - t < SESSION_TTL / 2:
        sess.expires_at = t + SESSION_TTL
        await db.commit()
        _set_cookie(request, response, SESSION_COOKIE, token, int(SESSION_TTL.total_seconds()))
    return user


SessionUser = Annotated[User | None, Depends(session_user)]


async def current_actor(request: Request, response: Response, user: SessionUser) -> Actor:
    if user is not None:
        return Actor(user=user, anon_id=None)
    return Actor(user=None, anon_id=anon_id(request, response))


CurrentActor = Annotated[Actor, Depends(current_actor)]
