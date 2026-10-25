from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from content_schema.build import build
from content_schema.loader import load_exam_dir
from platform_api.main import create_app
from platform_api.settings import Settings

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    out = tmp_path_factory.mktemp("build")
    res = load_exam_dir(REPO / "content" / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, out)
    app = create_app(Settings(env="test", private_content_dir=out / "private"))
    with TestClient(app) as c:
        yield c


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
        ("kin-0001", "двенадцать", "invalid", 0),
    ],
)
def test_check(client: TestClient, task_id: str, answer: str, outcome: str, points: int) -> None:
    r = client.post(f"/api/tasks/{task_id}/check", json={"answer": answer})
    assert r.status_code == 200
    body = r.json()
    assert (body["outcome"], body["points"]) == (outcome, points)
    assert "value" not in body  # never echo the reference answer


def test_check_unknown_task(client: TestClient) -> None:
    assert client.post("/api/tasks/nope/check", json={"answer": "1"}).status_code == 404


def test_check_extended_task(client: TestClient) -> None:
    assert client.post("/api/tasks/dyn-0002/check", json={"answer": "4,1"}).status_code == 422


def test_check_rejects_long_input(client: TestClient) -> None:
    assert client.post("/api/tasks/kin-0001/check", json={"answer": "1" * 65}).status_code == 422
