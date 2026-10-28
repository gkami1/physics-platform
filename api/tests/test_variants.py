import re

import pytest
from fastapi.testclient import TestClient

from platform_api.mail import MemoryMailer

VARIANT = ["kin-0001", "dyn-0001", "kin-0002", "meas-0001", "dyn-0002"]


def submit(client: TestClient, answers: dict[str, str], **extra: object) -> dict[str, object]:
    body = {"exam_id": "ege-physics", "variant": 1, "tasks": VARIANT, "answers": answers}
    r = client.post("/api/variants/runs", json=body | extra)
    assert r.status_code == 201, r.text
    data: dict[str, object] = r.json()
    return data


def test_variant_is_scored_on_the_server(client: TestClient) -> None:
    run = submit(
        client,
        {"kin-0001": "12,5", "dyn-0001": "5", "kin-0002": "14", "meas-0001": "мусор"},
        duration_s=600,
    )
    outcomes = {r["task_id"]: (r["outcome"], r["points"]) for r in run["results"]}  # type: ignore[attr-defined]
    assert outcomes == {
        "kin-0001": ("correct", 1),
        "dyn-0001": ("wrong", 0),
        "kin-0002": ("partial", 1),
        "meas-0001": ("invalid", 0),
        "dyn-0002": ("self", 0),
    }
    assert (run["auto_points"], run["total_points"], run["pending"]) == (2, 2, 1)
    assert run["max_points"] == 1 + 1 + 2 + 1 + 3
    assert "4,1" not in str(run)  # Part 2 final answer is not revealed by scoring


def test_checked_answers_become_attempts(client: TestClient) -> None:
    submit(client, {"kin-0001": "12,5", "dyn-0001": "5"})
    statuses = client.get("/api/tasks/status").json()["tasks"]
    assert statuses == {"kin-0001": "solved", "dyn-0001": "attempted"}
    assert client.get("/api/tasks/kin-0001/state").json()["best_points"] == 1


def test_empty_answers_are_skipped_not_attempts(client: TestClient) -> None:
    run = submit(client, {"kin-0001": "  "})
    assert run["results"][0]["outcome"] == "skipped"  # type: ignore[index]
    assert client.get("/api/tasks/status").json()["tasks"] == {}


def test_self_assessment_completes_the_score(client: TestClient) -> None:
    run = submit(client, {"kin-0001": "12,5"})
    url = f"/api/variants/runs/{run['id']}/self-assessment"
    r = client.put(url, json={"points": {"dyn-0002": 2}})
    assert r.status_code == 200, r.text
    assert (r.json()["total_points"], r.json()["pending"]) == (3, 0)
    assert client.put(url, json={"points": {"dyn-0002": 4}}).status_code == 422
    assert client.put(url, json={"points": {"kin-0001": 1}}).status_code == 422
    listed = client.get("/api/variants/runs?exam_id=ege-physics").json()
    assert [(x["id"], x["total_points"]) for x in listed] == [(run["id"], 3)]


@pytest.mark.parametrize(
    ("tasks", "detail"),
    [
        (["kin-0001", "kin-0001"], "duplicate_tasks"),
        (["kin-0001", "nope"], "unknown_task"),
    ],
)
def test_bad_task_lists_are_rejected(client: TestClient, tasks: list[str], detail: str) -> None:
    r = client.post(
        "/api/variants/runs",
        json={"exam_id": "ege-physics", "variant": 1, "tasks": tasks, "answers": {}},
    )
    assert (r.status_code, r.json()["detail"]) == (422, detail)


def test_runs_are_private_and_merge_on_sign_in(client: TestClient, outbox: MemoryMailer) -> None:
    run = submit(client, {"kin-0001": "12,5"})
    anon = client.cookies.get("pp_anon")
    client.cookies.clear()
    assert client.get(f"/api/variants/runs/{run['id']}").status_code == 404
    assert client.get("/api/variants/runs").json() == []

    client.cookies.set("pp_anon", anon or "")
    email = "variant@example.ru"
    client.post("/api/auth/code", json={"email": email, "consent": True})
    code = re.search(r"\d{6}", outbox.sent[-1][1])
    assert code
    assert client.post("/api/auth/verify", json={"email": email, "code": code.group()}).is_success
    assert [x["id"] for x in client.get("/api/variants/runs").json()] == [run["id"]]


def test_run_rate_limit(client: TestClient) -> None:
    for _ in range(10):
        submit(client, {})
    r = client.post(
        "/api/variants/runs",
        json={"exam_id": "ege-physics", "variant": 1, "tasks": VARIANT, "answers": {}},
    )
    assert (r.status_code, r.json()["detail"]) == (429, "too_many_runs")
