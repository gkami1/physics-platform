import asyncio
import os
import re
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from content_schema.build import build
from content_schema.loader import load_exam_dir
from platform_api.db import Base, make_engine
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


@pytest.fixture(scope="session")
def _schema(database_url: str) -> str:
    # Full down/up round trip once, on an empty schema: exercises every downgrade without
    # tripping the ones that refuse to destroy data (step-task rows referenced by attempts).
    cfg = alembic_config(database_url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    return database_url


def _clear_rows(url: str) -> None:
    async def run() -> None:
        engine = make_engine(url)
        async with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(table.delete())
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture
def migrated_db(_schema: str) -> str:
    """A migrated database with no rows left over from earlier tests."""
    _clear_rows(_schema)
    return _schema


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


PASSWORD = "correct horse battery"


def signup_form(email: str, **fields: object) -> dict[str, object]:
    form: dict[str, object] = {
        "first_name": "Анна",
        "last_name": "Иванова",
        "email": email,
        "password": PASSWORD,
        "consent": True,
    }
    return form | fields


@pytest.fixture
def sign_up(client: TestClient, outbox: MemoryMailer) -> Callable[[str], None]:
    """Register `email` on `client` and confirm it with the mailed code (signs in)."""

    def run(email: str) -> None:
        r = client.post("/api/auth/signup", json=signup_form(email))
        assert r.status_code == 202, r.text
        code = re.search(r"\d{6}", outbox.sent[-1][1])
        assert code
        r = client.post("/api/auth/verify", json={"email": email, "code": code.group()})
        assert r.status_code == 200, r.text

    return run


@pytest.fixture
def signed_in(client: TestClient, sign_up: Callable[[str], None]) -> TestClient:
    """`client` with a signed-in student session."""
    sign_up("student@example.ru")
    return client
