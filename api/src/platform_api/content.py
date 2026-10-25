"""Private content store, loaded once from content-build output.

M2 moves this into Postgres (`task_private`); the interface stays the same.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter

from content_schema.models import AnswerSpec, ExamSpec, TaskNumberSpec

_answer = TypeAdapter[AnswerSpec](AnswerSpec)


@dataclass(frozen=True)
class PrivateTask:
    id: str
    exam_id: str
    answer: AnswerSpec
    scoring: TaskNumberSpec


class ContentStore:
    def __init__(self, tasks: dict[str, PrivateTask], versions: dict[str, str]) -> None:
        self._tasks = tasks
        self.versions = versions

    def task(self, task_id: str) -> PrivateTask | None:
        return self._tasks.get(task_id)

    def __len__(self) -> int:
        return len(self._tasks)

    @classmethod
    def load(cls, private_dir: Path) -> ContentStore:
        tasks: dict[str, PrivateTask] = {}
        versions: dict[str, str] = {}
        for f in sorted(private_dir.glob("*.json")):
            data = json.loads(f.read_text("utf-8"))
            exam = ExamSpec.model_validate(data["exam"])
            versions[exam.id] = data["content_version"]
            for t in data["tasks"]:
                if t["id"] in tasks:
                    raise ValueError(f"task id {t['id']} appears in more than one exam")
                tasks[t["id"]] = PrivateTask(
                    id=t["id"],
                    exam_id=exam.id,
                    answer=_answer.validate_python(t["answer"]),
                    scoring=exam.tasks[t["ege_task"]],
                )
        return cls(tasks, versions)
