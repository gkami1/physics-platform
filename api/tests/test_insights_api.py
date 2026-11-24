"""GET /api/insights: full profile, teaser switch, ownership and the no-leak invariant."""

import json
from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from platform_api import insights_api
from platform_api.actor import now
from platform_api.content import ContentStore
from platform_api.db import Entitlement, User

from .test_auth import rows

URL = "/api/insights?exam=ege-physics"
TOPIC = "mech.kinematics.uniform-accel"
TOPIC_TASKS = ["kin-0001", "kin-0005", "kin-0006"]  # numeric, №1, this topic only


def wrong(client: TestClient, task_id: str) -> None:
    r = client.post(f"/api/tasks/{task_id}/attempts", json={"answer": "987654"})
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == "wrong"


def make_weak(client: TestClient) -> None:
    for t in TOPIC_TASKS:
        wrong(client, t)


def grant_pass(db_url: str, email: str) -> None:
    (user_id,) = rows(db_url, select(User.id).where(User.email == email))[0]  # type: ignore[misc]
    rows(
        db_url,
        insert(Entitlement).values(
            user_id=user_id, plan="month", valid_until=now() + timedelta(days=30)
        ),
    )


def test_empty_profile(client: TestClient) -> None:
    r = client.get(URL)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["teaser"] is False
    store: ContentStore = client.app.state.content  # type: ignore[attr-defined]
    exam = store.exam("ege-physics")
    assert exam is not None
    assert len(body["topics"]) == len(exam[1].topics())
    assert body["counts"]["not_started"] == len(body["topics"])
    assert body["practice"] == []
    assert body["mistakes"] == []
    pred = body["prediction"]
    assert pred["enough_data"] is False
    assert pred["primary"] is None
    assert pred["test"] is None
    assert pred["max_primary"] == 45


@pytest.mark.parametrize(("url", "status"), [("/api/insights", 422), ("/api/insights?exam=x", 404)])
def test_unknown_exam(client: TestClient, url: str, status: int) -> None:
    assert client.get(url).status_code == status


def test_weak_topic_practice_and_mistakes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_weak(client)
    # Today's set was picked this morning, before the mistakes; tomorrow's includes them.
    assert not [p for p in client.get(URL).json()["practice"] if p["topic_id"] == TOPIC]
    tomorrow = now() + timedelta(days=1)
    monkeypatch.setattr(insights_api, "now", lambda: tomorrow)
    body = client.get(URL).json()
    topic = next(t for t in body["topics"] if t["topic_id"] == TOPIC)
    assert topic["status"] == "weak"
    assert topic["reasons"]["graded_tasks"] == 3
    assert topic["reasons"]["first_try_accuracy"] == 0
    assert topic["reasons"]["lessons"]["total"] >= 1
    assert {m["task_id"] for m in body["mistakes"]} == set(TOPIC_TASKS)
    assert all(m["due"] is False for m in body["mistakes"])  # back in a few days
    practice = [p for p in body["practice"] if p["topic_id"] == TOPIC]
    assert 1 <= len(practice) <= 3
    assert all(p["reason"] == "weak" for p in practice)
    assert body["counts"]["weak"] == 1
    assert body["counts"]["mistakes"] == 3


def test_variant_self_assessment_feeds_the_prediction(client: TestClient) -> None:
    body = {
        "exam_id": "ege-physics",
        "variant": 1,
        "tasks": ["kin-0001", "dyn-0002"],
        "answers": {"kin-0001": "12,5"},
    }
    run = client.post("/api/variants/runs", json=body).json()
    by_n = {n["number"]: n for n in client.get(URL).json()["prediction"]["per_number"]}
    assert by_n[24]["basis"] == "none"  # Part 2 not self-assessed yet
    client.put(f"/api/variants/runs/{run['id']}/self-assessment", json={"points": {"dyn-0002": 2}})
    by_n = {n["number"]: n for n in client.get(URL).json()["prediction"]["per_number"]}
    assert (by_n[24]["basis"], by_n[24]["expected"]) == ("variants", 2.0)
    assert by_n[1]["basis"] == "blend"


def test_profile_is_per_actor(client: TestClient, sign_up: Callable[[str], None]) -> None:
    make_weak(client)
    sign_up("student@example.ru")  # anonymous history merges into the account
    assert client.get(URL).json()["counts"]["weak"] == 1
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get(URL).json()["counts"]["weak"] == 0


def test_teaser_switch(
    client: TestClient,
    sign_up: Callable[[str], None],
    migrated_db: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(insights_api, "PROFILE_REQUIRES_PASS", True)
    make_weak(client)

    anon = client.get(URL).json()
    assert anon["teaser"] is True
    assert [t["topic_id"] for t in anon["topics"]] == [TOPIC]
    assert anon["practice"] is None
    assert anon["mistakes"] is None
    assert anon["prediction"] is None
    assert anon["counts"]["weak"] == 1
    assert anon["counts"]["mistakes"] == 3

    sign_up("student@example.ru")
    assert client.get(URL).json()["teaser"] is True  # signed in, no pass

    grant_pass(migrated_db, "student@example.ru")
    paid = client.get(URL).json()
    assert paid["teaser"] is False
    assert paid["prediction"] is not None
    assert len(paid["mistakes"]) == 3


def _keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


def test_insights_never_contain_answers_or_solutions(
    client: TestClient, sign_up: Callable[[str], None]
) -> None:
    """Invariant 1: the profile carries ids and numbers, never private task content."""
    sign_up("student@example.ru")
    make_weak(client)
    client.post("/api/tasks/kin-0001/reveal")
    client.post("/api/theory/visits", json={"page_id": f"{TOPIC}", "active_s": 60})
    run = client.post(
        "/api/variants/runs",
        json={"exam_id": "ege-physics", "variant": 1, "tasks": ["kin-0002", "dyn-0002"]},
    ).json()
    client.put(f"/api/variants/runs/{run['id']}/self-assessment", json={"points": {"dyn-0002": 1}})

    body = client.get(URL).json()
    text = json.dumps(body, ensure_ascii=False)
    assert not _keys(body) & {"answer", "solution", "hints", "tutor_notes", "statement", "final"}
    store: ContentStore = client.app.state.content  # type: ignore[attr-defined]
    for t in store.all():
        for secret in (t.solution.strip(), *t.hints, t.tutor_notes or ""):
            if secret:
                assert secret not in text, t.id
