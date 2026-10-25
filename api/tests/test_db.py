import asyncio
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import select
from sqlalchemy.engine import Connection

from content_schema.models import AnswerKind
from platform_api.content import ContentStore, sync_tasks
from platform_api.db import Base, Task, make_engine, make_sessionmaker
from platform_api.policy import can_reveal_solution


def test_migrations_match_models(migrated_db: str) -> None:
    def diff(conn: Connection) -> list[object]:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        return list(compare_metadata(ctx, Base.metadata))

    async def run() -> list[object]:
        engine = make_engine(migrated_db)
        async with engine.connect() as conn:
            result = await conn.run_sync(diff)
        await engine.dispose()
        return result

    assert asyncio.run(run()) == []


def test_sync_tasks_upserts_and_deactivates(migrated_db: str, private_dir: Path) -> None:
    store = ContentStore.load(private_dir)

    async def run() -> dict[str, bool]:
        engine = make_engine(migrated_db)
        maker = make_sessionmaker(engine)
        async with maker() as s:
            s.add(
                Task(
                    id="old-0001",
                    exam_id="ege-physics",
                    ege_task=1,
                    max_points=1,
                    answer_type="numeric",
                    topics=[],
                    content_version="x",
                    active=True,
                )
            )
            await s.commit()
            await sync_tasks(s, store)
            await sync_tasks(s, store)  # idempotent
            rows = {t.id: t.active for t in (await s.scalars(select(Task))).all()}
        await engine.dispose()
        return rows

    rows = asyncio.run(run())
    assert rows.pop("old-0001") is False
    assert set(rows) == {t.id for t in store.all()}
    assert all(rows.values())


@pytest.mark.parametrize(
    ("kind", "outcomes", "allowed"),
    [
        (AnswerKind.NUMERIC, [], False),
        (AnswerKind.NUMERIC, ["wrong"], True),
        (AnswerKind.SEQUENCE, ["partial"], True),
        (AnswerKind.NUMERIC, ["correct"], True),
        (AnswerKind.NUMERIC, ["revealed"], True),
        (AnswerKind.EXTENDED, [], True),
    ],
)
def test_can_reveal_solution(kind: AnswerKind, outcomes: list[str], allowed: bool) -> None:
    assert can_reveal_solution(kind, outcomes) is allowed
