"""Password hashing: argon2id with the library's recommended parameters (RFC 9106, low
memory profile: 64 MiB, 3 passes). Hashing takes tens of milliseconds of CPU, so it runs
in a worker thread to keep the event loop free."""

from __future__ import annotations

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()
# Verified against when the account has no password, so a missing account or password
# takes as long to reject as a wrong one.
_DUMMY_HASH = _hasher.hash("not a real password")


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


def _verify(stored: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY_HASH, password) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


async def verify_password(stored: str | None, password: str) -> bool:
    return await asyncio.to_thread(_verify, stored, password)


def needs_rehash(stored: str) -> bool:
    """True after the default parameters change: re-hash on the next good sign-in."""
    return _hasher.check_needs_rehash(stored)
