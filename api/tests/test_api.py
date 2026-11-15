import pytest
from fastapi.testclient import TestClient

from platform_api.actor import ANON_COOKIE


def attempt(client: TestClient, task_id: str, answer: str) -> dict[str, object]:
    r = client.post(f"/api/tasks/{task_id}/attempts", json={"answer": answer})
    assert r.status_code == 200, r.text
    body: dict[str, object] = r.json()
    return body


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "ege-physics" in r.json()["content"]


@pytest.mark.parametrize(
    ("task_id", "answer", "outcome", "points"),
    [
        ("kin-0001", "12,5", "correct", 1),
        ("kin-0001", "12", "wrong", 0),
        ("kin-0002", "31", "correct", 2),
        ("kin-0002", "14", "partial", 1),
        ("meas-0001", "2,4 0,2", "correct", 1),
        ("meas-0001", "(2,4 ± 0,2)", "correct", 1),  # the form shown on reveal
        ("meas-0001", "(2,4 ± 0,2) Н", "correct", 1),  # ...with its unit
        ("meas-0001", "(2,4 ± 0,2) мН", "invalid", 0),
        ("kin-0001", "двенадцать", "invalid", 0),
        ("kin-0001", "1e999999999", "invalid", 0),  # was decimal.Overflow → HTTP 500
        ("meas-0001", "1e999999999 0,2", "invalid", 0),
        ("ks-accel-03", "-4", "correct", 1),  # step task: scored by exam.yaml `practice`
        ("ks-accel-03", "4", "wrong", 0),
    ],
)
def test_attempt_verdicts(
    client: TestClient, task_id: str, answer: str, outcome: str, points: int
) -> None:
    body = attempt(client, task_id, answer)
    assert (body["outcome"], body["points"]) == (outcome, points)


def test_wrong_attempt_does_not_leak_answer(client: TestClient) -> None:
    body = attempt(client, "kin-0001", "12")
    assert "12,5" not in str(body)
    assert "12.5" not in str(body)


def test_anon_cookie_is_set_once(client: TestClient) -> None:
    r = client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"})
    cookie = r.cookies.get(ANON_COOKIE)
    assert cookie
    assert len(cookie) == 32
    assert "httponly" in r.headers["set-cookie"].lower()
    r2 = client.post("/api/tasks/kin-0001/attempts", json={"answer": "2"})
    assert ANON_COOKIE not in r2.cookies  # reused, not reissued


def test_forged_cookie_is_replaced(client: TestClient) -> None:
    client.cookies.set(ANON_COOKIE, "../../etc/passwd")
    r = client.post("/api/tasks/kin-0001/attempts", json={"answer": "1"})
    assert len(r.cookies.get(ANON_COOKIE) or "") == 32


def test_state_tracks_history_per_actor(client: TestClient) -> None:
    attempt(client, "kin-0002", "45")
    attempt(client, "kin-0002", "не число")  # invalid input is not stored
    attempt(client, "kin-0002", "14")
    s = client.get("/api/tasks/kin-0002/state").json()
    assert [a["outcome"] for a in s["attempts"]] == ["partial", "wrong"]
    assert (s["best_points"], s["max_points"]) == (1, 2)
    assert s["solution_available"] is True

    client.cookies.clear()  # a different anonymous visitor sees nothing
    s2 = client.get("/api/tasks/kin-0002/state").json()
    assert s2["attempts"] == []
    assert s2["solution_available"] is False


def test_solution_requires_an_attempt(client: TestClient) -> None:
    assert client.post("/api/tasks/kin-0001/reveal").status_code == 403
    invalid = attempt(client, "kin-0001", "abc")
    assert invalid["solution_available"] is False
    assert client.post("/api/tasks/kin-0001/reveal").status_code == 403

    wrong = attempt(client, "kin-0001", "10")
    assert wrong["solution_available"] is True
    r = client.post("/api/tasks/kin-0001/reveal")
    assert r.status_code == 200
    assert r.json()["answer"] == "12,5 м/с"
    assert "v_0 + at" in r.json()["solution"]

    client.post("/api/tasks/kin-0001/reveal")  # revealing twice is recorded once
    state = client.get("/api/tasks/kin-0001/state").json()
    assert [a["outcome"] for a in state["attempts"]] == ["revealed", "wrong"]


def test_extended_task(client: TestClient) -> None:
    r = client.post("/api/tasks/dyn-0002/attempts", json={"answer": "4,1"})
    assert r.status_code == 422
    r = client.post("/api/tasks/dyn-0002/reveal")
    assert r.status_code == 200
    assert r.json()["answer"] == "≈ 4,1 м/с"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/tasks/nope/attempts", {"answer": "1"}),
        ("GET", "/api/tasks/nope/state", None),
        ("POST", "/api/tasks/nope/reveal", None),
    ],
)
def test_unknown_task(client: TestClient, method: str, path: str, body: object) -> None:
    assert client.request(method, path, json=body).status_code == 404


@pytest.mark.parametrize("answer", ["", "1" * 65])
def test_answer_length_limits(client: TestClient, answer: str) -> None:
    r = client.post("/api/tasks/kin-0001/attempts", json={"answer": answer})
    assert r.status_code == 422


def test_step_task_counts_toward_topic_mastery(client: TestClient) -> None:
    attempt(client, "ks-basics-05", "48")
    topics = {t["topic_id"]: t for t in client.get("/api/progress").json()["topics"]}
    assert topics["mech.kinematics.basics"]["score"] == 1.0
