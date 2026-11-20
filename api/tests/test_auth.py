import asyncio
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from platform_api import auth, main
from platform_api.actor import ANON_COOKIE, SESSION_COOKIE
from platform_api.db import (
    Attempt,
    AuthSession,
    ConsentEvent,
    LoginCode,
    PasswordFailure,
    User,
    make_engine,
)
from platform_api.mail import MemoryMailer
from platform_api.main import create_app
from platform_api.settings import Settings

EMAIL = "student@example.ru"
PASSWORD = "correct horse battery"  # as in conftest.py (importlib mode: no shared import)
SignUp = Callable[[str], None]


def signup_form(email: str, **fields: object) -> dict[str, object]:
    form: dict[str, object] = {
        "first_name": "Анна",
        "last_name": "Иванова",
        "email": email,
        "password": PASSWORD,
        "consent": True,
    }
    return form | fields


def last_code(outbox: MemoryMailer) -> str:
    m = re.search(r"\d{6}", outbox.sent[-1][1])
    assert m
    return m.group()


def me(client: TestClient) -> dict[str, object] | None:
    user: dict[str, object] | None = client.get("/api/me").json()["user"]
    return user


def rows(db_url: str, stmt: object) -> list[object]:
    async def run() -> list[object]:
        engine = make_engine(db_url)
        async with engine.begin() as conn:
            result = await conn.execute(stmt)  # type: ignore[call-overload]
            out = list(result.all()) if result.returns_rows else []
        await engine.dispose()
        return out

    return asyncio.run(run())


def login(client: TestClient, email: str = EMAIL, password: str = PASSWORD) -> tuple[int, str]:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    return r.status_code, r.json().get("detail", "") if r.status_code != 200 else ""


def request_code(client: TestClient, email: str = EMAIL, purpose: str = "login") -> int:
    return client.post("/api/auth/code", json={"email": email, "purpose": purpose}).status_code


# --- sign-up ---


def test_sign_up_flow(client: TestClient, outbox: MemoryMailer, migrated_db: str) -> None:
    form = signup_form(" Student@Example.RU ", phone="8 (916) 123-45-67", marketing=True)
    r = client.post("/api/auth/signup", json=form)
    assert r.status_code == 202, r.text
    to, subject, _ = outbox.sent[-1]
    assert to == EMAIL
    assert subject.startswith("Код подтверждения: ")
    # No account until the address is confirmed.
    assert rows(migrated_db, select(User.id)) == []
    assert me(client) is None

    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    assert r.status_code == 200, r.text
    expected = {
        "email": EMAIL,
        "first_name": "Анна",
        "last_name": "Иванова",
        "phone": "+79161234567",
        "marketing": True,
        "has_password": True,
    }
    assert r.json() == {"user": expected}
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert me(client) == expected

    # Only hashes are stored: the password as argon2id, the session token as sha256.
    [(stored,)] = rows(migrated_db, select(User.password_hash))  # type: ignore[misc]
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    assert [r[0] for r in rows(migrated_db, select(AuthSession.id))] != [token]  # type: ignore[index]
    # The waiting form (with its password hash) is gone from the code row.
    assert rows(migrated_db, select(LoginCode.id).where(LoginCode.signup.is_not(None))) == []
    events = rows(migrated_db, select(ConsentEvent.kind, ConsentEvent.granted))
    assert sorted(events) == [("marketing", True), ("personal_data", True)]  # type: ignore[type-var]

    # A code works once.
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    assert r.status_code == 400

    assert client.post("/api/auth/logout").status_code == 204
    assert me(client) is None
    assert rows(migrated_db, select(AuthSession.id)) == []


@pytest.mark.parametrize(
    ("fields", "detail"),
    [
        ({"consent": False}, "consent_required"),
        ({"first_name": " "}, "invalid_name"),
        ({"last_name": "R2D2"}, "invalid_name"),
        ({"email": "a@b"}, "invalid_email"),
        ({"phone": "12345"}, "invalid_phone"),
        ({"password": "short"}, "weak_password"),
    ],
)
def test_sign_up_validation(
    client: TestClient, outbox: MemoryMailer, fields: dict[str, object], detail: str
) -> None:
    r = client.post("/api/auth/signup", json=signup_form(EMAIL) | fields)
    assert (r.status_code, r.json()["detail"]) == (422, detail)
    assert outbox.sent == []


def test_sign_up_without_phone_or_marketing(
    client: TestClient, outbox: MemoryMailer, migrated_db: str
) -> None:
    assert client.post("/api/auth/signup", json=signup_form(EMAIL, phone="")).status_code == 202
    client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    user = me(client)
    assert user
    assert (user["phone"], user["marketing"]) == (None, False)
    assert rows(migrated_db, select(ConsentEvent.kind)) == [("personal_data",)]


def test_taken_email(client: TestClient, sign_up: SignUp, outbox: MemoryMailer) -> None:
    sign_up(EMAIL)
    client.post("/api/auth/logout")
    sent = len(outbox.sent)
    r = client.post("/api/auth/signup", json=signup_form(EMAIL.upper()))
    assert (r.status_code, r.json()["detail"]) == (409, "email_taken")
    assert len(outbox.sent) == sent


def test_only_the_typed_code_decides_the_form(
    client: TestClient, outbox: MemoryMailer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second sign-up for the same address (someone else's, say) replaces the first code:
    the first one stops working, so nobody can slip a password in under another's code."""
    monkeypatch.setattr(auth, "EMAIL_LIMITS", ())
    client.post("/api/auth/signup", json=signup_form(EMAIL))
    first = last_code(outbox)
    client.post("/api/auth/signup", json=signup_form(EMAIL, first_name="Пётр"))
    second = last_code(outbox)
    if first != second:
        r = client.post("/api/auth/verify", json={"email": EMAIL, "code": first})
        assert r.json()["detail"] == "wrong_code"
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": second})
    assert r.json()["user"]["first_name"] == "Пётр"


def test_unconfirmed_forms_are_dropped(
    client: TestClient, outbox: MemoryMailer, migrated_db: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth, "CODE_TTL", timedelta(seconds=-1))
    client.post("/api/auth/signup", json=signup_form(EMAIL))
    client.post("/api/auth/signup", json=signup_form("other@example.ru"))
    waiting = rows(migrated_db, select(LoginCode.email).where(LoginCode.signup.is_not(None)))
    assert waiting == [("other@example.ru",)]


# --- password sign-in ---


def test_password_sign_in(client: TestClient, sign_up: SignUp) -> None:
    sign_up(EMAIL)
    client.post("/api/auth/logout")
    assert login(client, password="wrong password") == (400, "wrong_credentials")
    assert login(client, email="nobody@example.ru") == (400, "wrong_credentials")
    assert me(client) is None
    assert login(client, email=" STUDENT@example.ru ") == (200, "")
    assert me(client) is not None


def test_account_without_password(client: TestClient, migrated_db: str) -> None:
    """Accounts made by email code before passwords existed: same answer as a wrong one."""
    rows(migrated_db, insert(User).values(email=EMAIL, consented_at=datetime.now(UTC)))
    assert login(client) == (400, "wrong_credentials")
    assert login(client, password="") == (400, "wrong_credentials")


def test_wrong_passwords_are_limited(
    client: TestClient, sign_up: SignUp, migrated_db: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_up(EMAIL)
    client.post("/api/auth/logout")
    monkeypatch.setattr(auth, "PASSWORD_EMAIL_LIMITS", ((timedelta(minutes=15), 3),))
    for _ in range(3):
        assert login(client, password="nope nope nope") == (400, "wrong_credentials")
    assert login(client) == (429, "too_many_attempts")  # even the right password
    assert len(rows(migrated_db, select(PasswordFailure.id))) == 3
    assert login(client, email="other@example.ru") == (400, "wrong_credentials")


# --- code sign-in and password reset ---


def test_code_sign_in(client: TestClient, sign_up: SignUp, outbox: MemoryMailer) -> None:
    assert request_code(client) == 404  # no account yet
    assert outbox.sent == []
    sign_up(EMAIL)
    client.post("/api/auth/logout")
    client.cookies.clear()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(auth, "EMAIL_LIMITS", ())
        assert request_code(client) == 202
    assert outbox.sent[-1][1].startswith("Код для входа: ")
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    assert r.status_code == 200
    assert me(client) is not None


def test_password_reset(
    client: TestClient,
    sign_up: SignUp,
    outbox: MemoryMailer,
    private_dir: Path,
    migrated_db: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "EMAIL_LIMITS", ())
    sign_up(EMAIL)
    other = create_app(
        Settings(env="test", private_content_dir=private_dir, database_url=migrated_db)
    )
    with TestClient(other) as laptop:
        assert login(laptop) == (200, "")

        assert request_code(client, purpose="reset") == 202
        assert outbox.sent[-1][1].startswith("Код для смены пароля: ")
        code = last_code(outbox)
        new = "a brand new password"
        body = {"email": EMAIL, "code": code, "password": "short"}
        r = client.post("/api/auth/reset", json=body)
        assert r.json()["detail"] == "weak_password"  # checked before the code is spent
        r = client.post("/api/auth/reset", json=body | {"password": new})
        assert r.status_code == 200, r.text

        assert me(client) is not None
        assert me(laptop) is None  # every other device is signed out
        assert login(laptop) == (400, "wrong_credentials")
        assert login(laptop, password=new) == (200, "")


def test_reset_needs_the_code(client: TestClient, sign_up: SignUp, outbox: MemoryMailer) -> None:
    sign_up(EMAIL)
    r = client.post(
        "/api/auth/reset", json={"email": EMAIL, "code": "000000", "password": "x" * 10}
    )
    assert r.json()["detail"] in {"wrong_code", "code_expired"}


def test_code_rate_limit(client: TestClient, sign_up: SignUp, outbox: MemoryMailer) -> None:
    sign_up(EMAIL)
    assert request_code(client) == 429  # one per minute per address (sign-up sent one)
    r = client.post("/api/auth/signup", json=signup_form("other@example.ru"))
    assert r.status_code == 202


def test_wrong_code_attempts_are_limited(client: TestClient, outbox: MemoryMailer) -> None:
    client.post("/api/auth/signup", json=signup_form(EMAIL))
    code = last_code(outbox)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(auth.MAX_TRIES_PER_CODE):
        r = client.post("/api/auth/verify", json={"email": EMAIL, "code": wrong})
        assert r.json()["detail"] == "wrong_code"
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": code})
    assert r.json()["detail"] == "too_many_tries"
    assert me(client) is None


def test_expired_code(
    client: TestClient, outbox: MemoryMailer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth, "CODE_TTL", timedelta(seconds=-1))
    client.post("/api/auth/signup", json=signup_form(EMAIL))
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    assert r.json()["detail"] == "code_expired"


# --- profile ---


def test_profile_update(client: TestClient, sign_up: SignUp, migrated_db: str) -> None:
    body = {"first_name": "Аня", "last_name": "Петрова-Иванова", "phone": None, "marketing": False}
    assert client.patch("/api/me", json=body).status_code == 401
    sign_up(EMAIL)

    r = client.patch("/api/me", json=body | {"phone": "+44 20 7946 0958", "marketing": True})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert (user["first_name"], user["last_name"]) == ("Аня", "Петрова-Иванова")
    assert (user["phone"], user["marketing"]) == ("+442079460958", True)

    r = client.patch("/api/me", json=body | {"phone": "  "})
    assert (r.json()["user"]["phone"], r.json()["user"]["marketing"]) == (None, False)
    r = client.patch("/api/me", json=body | {"phone": "abc"})
    assert (r.status_code, r.json()["detail"]) == (422, "invalid_phone")

    marketing = rows(
        migrated_db,
        select(ConsentEvent.granted)
        .where(ConsentEvent.kind == "marketing")
        .order_by(ConsentEvent.id),
    )
    assert marketing == [(True,), (False,)]


# --- sessions and progress ---


def test_anonymous_progress_moves_into_account(
    client: TestClient, sign_up: SignUp, migrated_db: str
) -> None:
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "12,5"})
    assert client.cookies.get(ANON_COOKIE)
    sign_up(EMAIL)
    assert client.cookies.get(ANON_COOKIE) is None

    state = client.get("/api/tasks/kin-0001/state").json()
    assert [a["outcome"] for a in state["attempts"]] == ["correct"]
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"})
    assert all(r[0] is not None for r in rows(migrated_db, select(Attempt.user_id)))  # type: ignore[index]

    # Signing out on a shared device hides the account's history.
    client.post("/api/auth/logout")
    assert client.get("/api/tasks/kin-0001/state").json()["attempts"] == []


def test_progress_persists_across_devices(
    client: TestClient, sign_up: SignUp, private_dir: Path, migrated_db: str
) -> None:
    sign_up(EMAIL)
    client.post("/api/tasks/kin-0002/attempts", json={"answer": "14"})

    other = create_app(
        Settings(env="test", private_content_dir=private_dir, database_url=migrated_db)
    )
    with TestClient(other) as phone:
        assert phone.get("/api/tasks/kin-0002/state").json()["attempts"] == []
        assert login(phone) == (200, "")
        attempts = phone.get("/api/tasks/kin-0002/state").json()["attempts"]
        assert [a["outcome"] for a in attempts] == ["partial"]


def test_progress_endpoint(client: TestClient) -> None:
    assert client.get("/api/progress").json() == {"topics": []}
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"})  # wrong first: counts
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "12,5"})  # retry: ignored
    client.post("/api/tasks/kin-0002/attempts", json={"answer": "31"})
    topics = {t["topic_id"]: t for t in client.get("/api/progress").json()["topics"]}
    assert topics["mech.kinematics.uniform-accel"]["n"] == 2
    assert topics["mech.kinematics.uniform-accel"]["score"] == 0.5
    assert topics["mech.kinematics.uniform-accel"]["exam_id"] == "ege-physics"


def test_attempt_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "ATTEMPTS_PER_MINUTE", 2)
    codes = [
        client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"}).status_code
        for _ in range(3)
    ]
    assert codes == [200, 200, 429]


@pytest.mark.parametrize(
    ("origin", "status"),
    [
        (None, 400),
        ("http://testserver", 400),
        ("https://evil.example", 403),
        ("null", 403),
    ],
)
def test_csrf_origin_check(client: TestClient, origin: str | None, status: int) -> None:
    headers = {"origin": origin} if origin else {}
    body = {"email": EMAIL, "password": PASSWORD}
    r = client.post("/api/auth/login", json=body, headers=headers)
    assert r.status_code == status  # 400: reached the handler (no such account)
