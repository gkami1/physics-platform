"""Private content store, loaded once from content-build output baked into the image.

Answers, solutions and hints are served from memory; the `tasks` table only mirrors
public metadata so attempts have something to reference.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from content_schema.models import AnswerSpec, ExamSpec, TaskNumberSpec, embedded_task_ids
from platform_api.db import Task

_answer = TypeAdapter[AnswerSpec](AnswerSpec)


@dataclass(frozen=True)
class PrivateTask:
    id: str
    exam_id: str
    ege_task: int | None  # None: step task embedded in a theory page
    topics: tuple[str, ...]
    statement: str
    answer: AnswerSpec
    scoring: TaskNumberSpec
    solution: str
    hints: tuple[str, ...]
    tutor_notes: str | None
    content_version: str


@dataclass(frozen=True)
class Theory:
    exam_id: str
    topic: str
    title: str
    body: str
    steps: tuple[str, ...] = ()  # ids of step tasks embedded in the body, in order


class ContentStore:
    def __init__(
        self,
        tasks: dict[str, PrivateTask],
        versions: dict[str, str],
        theory: dict[str, Theory] | None = None,
    ) -> None:
        self._tasks = tasks
        self._theory = theory or {}
        self.versions = versions

    def task(self, task_id: str) -> PrivateTask | None:
        return self._tasks.get(task_id)

    def theory(self, topic: str) -> Theory | None:
        return self._theory.get(topic)

    def theory_steps(self, page: Theory) -> list[PrivateTask]:
        return [t for i in page.steps if (t := self._tasks.get(i)) is not None]

    def theory_topics(self) -> list[str]:
        return list(self._theory)

    def all(self) -> list[PrivateTask]:
        return list(self._tasks.values())

    def __len__(self) -> int:
        return len(self._tasks)

    @classmethod
    def load(cls, private_dir: Path) -> ContentStore:
        tasks: dict[str, PrivateTask] = {}
        theory: dict[str, Theory] = {}
        versions: dict[str, str] = {}
        for f in sorted(private_dir.glob("*.json")):
            data = json.loads(f.read_text("utf-8"))
            exam = ExamSpec.model_validate(data["exam"])
            version = data["content_version"]
            versions[exam.id] = version
            for t in data["tasks"]:
                if t["id"] in tasks:
                    raise ValueError(f"task id {t['id']} appears in more than one exam")
                scoring = exam.spec_for(t["ege_task"])
                if scoring is None:
                    raise ValueError(f"task {t['id']}: no scoring spec in exam.yaml")
                tasks[t["id"]] = PrivateTask(
                    id=t["id"],
                    exam_id=exam.id,
                    ege_task=t["ege_task"],
                    topics=tuple(t["topics"]),
                    statement=t["statement"],
                    answer=_answer.validate_python(t["answer"]),
                    scoring=scoring,
                    solution=t["solution"],
                    hints=tuple(t["hints"]),
                    tutor_notes=t["tutor_notes"],
                    content_version=version,
                )
            for page in data.get("theory", []):
                theory[page["topic"]] = Theory(
                    exam.id,
                    page["topic"],
                    page["title"],
                    page["body"],
                    tuple(embedded_task_ids(page["body"])),
                )
        return cls(tasks, versions, theory)


async def sync_tasks(session: AsyncSession, store: ContentStore) -> None:
    """Upsert task metadata; deactivate tasks removed from content (attempts keep their FK)."""
    existing = {t.id: t for t in (await session.scalars(select(Task))).all()}
    for p in store.all():
        row = existing.get(p.id) or Task(id=p.id)
        row.exam_id = p.exam_id
        row.ege_task = p.ege_task
        row.max_points = p.scoring.max_points
        row.answer_type = p.answer.type
        row.topics = list(p.topics)
        row.content_version = p.content_version
        row.active = True
        session.add(row)
    gone = set(existing) - {p.id for p in store.all()}
    if gone:
        await session.execute(update(Task).where(Task.id.in_(gone)).values(active=False))
    await session.commit()
