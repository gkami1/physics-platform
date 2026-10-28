import os
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from content_schema.build import build
from content_schema.loader import load_exam_dir
from platform_api.mail import MemoryMailer
from platform_api.main import create_app
from platform_api.settings import Settings

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def private_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("build")
    res = load_exam_dir(REPO / "content" / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, out)
    return out / "private"


@pytest.fixture(scope="session")
def database_url(tmp_path_factory: pytest.TempPathFactory) -> str:
    # CI sets API_TEST_DATABASE_URL to a throwaway Postgres; locally SQLite is enough.
    url = os.environ.get("API_TEST_DATABASE_URL")
    if url:
        return url
    db = tmp_path_factory.mktemp("db") / "test.db"
    return f"sqlite+aiosqlite:///{db.as_posix()}"


def alembic_config(url: str) -> Config:
    cfg = Config(str(REPO / "api" / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


@pytest.fixture
def migrated_db(database_url: str) -> str:
    cfg = alembic_config(database_url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    return database_url


@pytest.fixture
def client(private_dir: Path, migrated_db: str) -> Iterator[TestClient]:
    app = create_app(
        Settings(env="test", private_content_dir=private_dir, database_url=migrated_db)
    )
    with TestClient(app) as c:
        yield c


@pytest.fixture
def outbox(client: TestClient) -> MemoryMailer:
    box = MemoryMailer()
    client.app.state.mailer = box  # type: ignore[attr-defined]
    return box


@pytest.fixture
def signed_in(client: TestClient, outbox: MemoryMailer) -> TestClient:
    """`client` with a signed-in student session."""
    email = "student@example.ru"
    r = client.post("/api/auth/code", json={"email": email, "consent": True})
    assert r.status_code == 202
    code = re.search(r"\d{6}", outbox.sent[-1][1])
    assert code
    r = client.post("/api/auth/verify", json={"email": email, "code": code.group()})
    assert r.status_code == 200
    return client
