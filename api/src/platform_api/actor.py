"""Who is acting. M2: an anonymous id in a cookie. M3 adds signed-in users."""

from __future__ import annotations

import re
import secrets
from typing import Annotated

from fastapi import Depends, Request, Response

ANON_COOKIE = "pp_anon"
_ANON_RE = re.compile(r"^[0-9a-f]{32}$")
_YEAR = 60 * 60 * 24 * 365


def anon_id(request: Request, response: Response) -> str:
    current = request.cookies.get(ANON_COOKIE, "")
    if _ANON_RE.fullmatch(current):
        return current
    new = secrets.token_hex(16)
    response.set_cookie(
        ANON_COOKIE,
        new,
        max_age=_YEAR,
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.secure_cookies,
        path="/api",
    )
    return new


AnonId = Annotated[str, Depends(anon_id)]
