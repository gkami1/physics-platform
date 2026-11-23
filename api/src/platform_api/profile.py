"""Pure normalisers for account fields: email, names, phone, password policy.

Each returns the normalised value, or None when the input is not acceptable.
"""

from __future__ import annotations

import re

NAME_MAX = 50
PASSWORD_MIN = 8
PASSWORD_MAX = 128

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Letters (any script) in words joined by single spaces, hyphens or apostrophes:
# «Анна-Мария», «д'Артаньян», «Мария Луиза».
_NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '’-][^\W\d_]+)*$")
_PHONE_JUNK_RE = re.compile(r"[\s()\-.]")
_DIGITS_RE = re.compile(r"[0-9]+")


def normalize_email(raw: str) -> str | None:
    email = raw.strip().lower()
    return email if len(email) <= 254 and _EMAIL_RE.fullmatch(email) else None


def normalize_name(raw: str) -> str | None:
    name = " ".join(raw.split())
    if not name or len(name) > NAME_MAX or not _NAME_RE.fullmatch(name):
        return None
    return name


def normalize_phone(raw: str) -> str | None:
    """E.164 (`+79161234567`). Russian numbers may be typed as 8…, 7… or bare 9…;
    other countries need a leading `+`."""
    s = _PHONE_JUNK_RE.sub("", raw.strip())
    plus = s.startswith("+")
    digits = s[1:] if plus else s
    if not _DIGITS_RE.fullmatch(digits):  # str.isdigit() would accept «²» and other scripts
        return None
    if not plus:
        if len(digits) == 11 and digits[0] in "78":
            digits = "7" + digits[1:]
        elif len(digits) == 10 and digits[0] == "9":
            digits = "7" + digits
        else:
            return None
    if digits.startswith("7") and len(digits) != 11:
        return None
    if not 10 <= len(digits) <= 15 or digits[0] == "0":
        return None
    return "+" + digits


def password_ok(password: str) -> bool:
    return PASSWORD_MIN <= len(password) <= PASSWORD_MAX and not password.isspace()
