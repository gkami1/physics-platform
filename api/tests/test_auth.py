import asyncio
import re
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from platform_api import auth, main
from platform_api.actor import ANON_COOKIE, SESSION_COOKIE
from platform_api.db import Attempt, AuthSession, make_engine
from platform_api.mail import MemoryMailer
from platform_api.main import create_app
from platform_api.settings import Settings

EMAIL = "Student@Example.ru"


def request_code(client: TestClient, email: str = EMAIL, consent: bool = True) -> int:
    r = client.post("/api/auth/code", json={"email": email, "consent": consent})
    return r.status_code


def last_code(outbox: MemoryMailer) -> str:
    m = re.search(r"\d{6}", outbox.sent[-1][1])
    assert m
    return m.group()


def sign_in(client: TestClient, outbox: MemoryMailer, email: str = EMAIL) -> None:
    assert request_code(client, email) == 202
    r = client.post("/api/auth/verify", json={"email": email, "code": last_code(outbox)})
    assert r.status_code == 200, r.text


def me(client: TestClient) -> object:
    return client.get("/api/me").json()["user"]


def rows(db_url: str, stmt: object) -> list[object]:
    async def run() -> list[object]:
        engine = make_engine(db_url)
        async with engine.connect() as conn:
            result = list((await conn.execute(stmt)).all())  # type: ignore[call-overload]
        await engine.dispose()
        return result

    return asyncio.run(run())


def test_sign_in_flow(client: TestClient, outbox: MemoryMailer, migrated_db: str) -> None:
    assert me(client) is None
    assert request_code(client) == 202
    to, _, body = outbox.sent[-1]
    assert to == "student@example.ru"
    code = last_code(outbox)
    assert code in body

    r = client.post("/api/auth/verify", json={"email": " STUDENT@example.ru ", "code": code})
    assert r.status_code == 200
    assert r.json() == {"user": {"email": "student@example.ru", "paid_until": None}}
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert me(client) == {"email": "student@example.ru", "paid_until": None}

    # Only the token's hash is stored.
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    stored = [r[0] for r in rows(migrated_db, select(AuthSession.id))]
    assert token not in stored
    assert len(stored) == 1

    # A code works once.
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": code})
    assert r.status_code == 400

    assert client.post("/api/auth/logout").status_code == 204
    assert me(client) is None
    assert rows(migrated_db, select(AuthSession.id)) == []


def test_request_validation(client: TestClient, outbox: MemoryMailer) -> None:
    assert request_code(client, consent=False) == 422
    assert request_code(client, email="not-an-email") == 422
    assert request_code(client, email="a@b") == 422
    assert outbox.sent == []


def test_code_rate_limit(client: TestClient, outbox: MemoryMailer) -> None:
    assert request_code(client) == 202
    assert request_code(client) == 429  # one per minute per address
    assert request_code(client, "other@example.ru") == 202
    assert len(outbox.sent) == 2


def test_wrong_code_attempts_are_limited(client: TestClient, outbox: MemoryMailer) -> None:
    assert request_code(client) == 202
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
    assert request_code(client) == 202
    r = client.post("/api/auth/verify", json={"email": EMAIL, "code": last_code(outbox)})
    assert r.json()["detail"] == "code_expired"


def test_anonymous_progress_moves_into_account(
    client: TestClient, outbox: MemoryMailer, migrated_db: str
) -> None:
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "12,5"})
    assert client.cookies.get(ANON_COOKIE)
    sign_in(client, outbox)
    assert client.cookies.get(ANON_COOKIE) is None

    state = client.get("/api/tasks/kin-0001/state").json()
    assert [a["outcome"] for a in state["attempts"]] == ["correct"]
    client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"})
    assert all(r[0] is not None for r in rows(migrated_db, select(Attempt.user_id)))

    # Signing out on a shared device hides the account's history.
    client.post("/api/auth/logout")
    assert client.get("/api/tasks/kin-0001/state").json()["attempts"] == []


def test_progress_persists_across_devices(
    client: TestClient,
    outbox: MemoryMailer,
    private_dir: Path,
    migrated_db: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "EMAIL_LIMITS", ())
    sign_in(client, outbox)
    client.post("/api/tasks/kin-0002/attempts", json={"answer": "14"})

    other = create_app(
        Settings(env="test", private_content_dir=private_dir, database_url=migrated_db)
    )
    with TestClient(other) as phone:
        phone.app.state.mailer = outbox  # type: ignore[attr-defined]
        assert phone.get("/api/tasks/kin-0002/state").json()["attempts"] == []
        sign_in(phone, outbox, "student@example.ru")
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
        (None, 202),
        ("http://testserver", 202),
        ("https://evil.example", 403),
        ("null", 403),
    ],
)
def test_csrf_origin_check(
    client: TestClient, outbox: MemoryMailer, origin: str | None, status: int
) -> None:
    headers = {"origin": origin} if origin else {}
    r = client.post("/api/auth/code", json={"email": EMAIL, "consent": True}, headers=headers)
    assert r.status_code == status
