"""Timed exam variants: submit a whole variant, self-assess Part 2, list past runs.

Variants are composed at build time by the site (one task per EGE number); the server
does not need to know the composition, only that every task exists and belongs to the exam.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from content_schema.checking import Outcome, check
from content_schema.models import AnswerKind
from platform_api.actor import Actor, CurrentActor, as_utc, now
from platform_api.content import ContentStore, PrivateTask
from platform_api.db import Attempt, VariantRun
from platform_api.deps import Db, Store

router = APIRouter(prefix="/api")

MAX_TASKS = 40
RUNS_PER_HOUR = 10
LIST_LIMIT = 50

# Outcomes beyond the checker's: Part 2 waiting for self-assessment, Part 1 left empty.
SELF = "self"
SKIPPED = "skipped"


@dataclass(frozen=True)
class TaskResult:
    task_id: str
    ege_task: int
    part: int
    outcome: str
    points: int
    max_points: int
    answer: str | None

    def as_json(self) -> dict[str, Any]:
        return self.__dict__.copy()


def score_variant(tasks: Sequence[PrivateTask], answers: Mapping[str, str]) -> list[TaskResult]:
    """Pure: check every Part 1 answer; Part 2 waits for self-assessment."""
    out = []
    for t in tasks:
        if t.ege_task is None:
            raise ValueError(f"step task {t.id} cannot be part of a variant")
        answer = (answers.get(t.id) or "").strip() or None
        if t.scoring.answer_kind is AnswerKind.EXTENDED:
            outcome, points, answer = SELF, 0, None
        elif answer is None:
            outcome, points = SKIPPED, 0
        else:
            # Unreadable input scores 0 ("invalid"), as on the real exam.
            v = check(t.answer, t.scoring, answer)
            outcome, points = v.outcome.value, v.points
        out.append(
            TaskResult(
                task_id=t.id,
                ege_task=t.ege_task,
                part=t.scoring.part,
                outcome=outcome,
                points=points,
                max_points=t.scoring.max_points,
                answer=answer,
            )
        )
    return out


class VariantSubmit(BaseModel):
    exam_id: str = Field(max_length=40)
    variant: int = Field(ge=1, le=999)
    tasks: list[str] = Field(min_length=1, max_length=MAX_TASKS)
    answers: dict[str, str] = Field(default_factory=dict, max_length=MAX_TASKS)
    duration_s: int | None = Field(default=None, ge=0, le=24 * 3600)


class SelfAssessment(BaseModel):
    points: dict[str, int] = Field(max_length=MAX_TASKS)


class TaskResultOut(BaseModel):
    task_id: str
    ege_task: int
    part: int
    outcome: str
    points: int
    max_points: int
    answer: str | None


class VariantRunOut(BaseModel):
    id: int
    exam_id: str
    variant: int
    results: list[TaskResultOut]
    auto_points: int
    self_points: dict[str, int]
    total_points: int
    max_points: int
    # Part 2 tasks not yet self-assessed.
    pending: int
    duration_s: int | None
    created_at: datetime


class VariantRunSummary(BaseModel):
    id: int
    exam_id: str
    variant: int
    total_points: int
    max_points: int
    pending: int
    created_at: datetime


class TaskStatuses(BaseModel):
    # task_id -> "solved" (full points at least once) | "attempted"
    tasks: dict[str, str]


def _pending(run: VariantRun) -> int:
    return sum(
        1 for r in run.results if r["outcome"] == SELF and r["task_id"] not in run.self_points
    )


def _total(run: VariantRun) -> int:
    return run.auto_points + sum(int(p) for p in run.self_points.values())


def _out(run: VariantRun) -> VariantRunOut:
    return VariantRunOut(
        id=run.id,
        exam_id=run.exam_id,
        variant=run.variant,
        results=[TaskResultOut(**r) for r in run.results],
        auto_points=run.auto_points,
        self_points={k: int(v) for k, v in run.self_points.items()},
        total_points=_total(run),
        max_points=run.max_points,
        pending=_pending(run),
        duration_s=run.duration_s,
        created_at=as_utc(run.created_at),
    )


def _tasks_or_422(store: ContentStore, exam_id: str, ids: Sequence[str]) -> list[PrivateTask]:
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "duplicate_tasks")
    tasks = []
    for i in ids:
        t = store.task(i)
        # Step tasks (no EGE number) belong to theory pages, never to a variant.
        if t is None or t.exam_id != exam_id or t.ege_task is None:
            raise HTTPException(422, "unknown_task")
        tasks.append(t)
    return tasks


async def _run_or_404(db: Db, actor: Actor, run_id: int) -> VariantRun:
    run = await db.scalar(select(VariantRun).where(VariantRun.id == run_id, actor.owns(VariantRun)))
    if run is None:
        raise HTTPException(404, "run not found")
    return run


@router.post("/variants/runs", status_code=201)
async def submit_variant(
    body: VariantSubmit, store: Store, db: Db, actor: CurrentActor
) -> VariantRunOut:
    tasks = _tasks_or_422(store, body.exam_id, body.tasks)
    if any(len(a) > 64 for a in body.answers.values()):
        raise HTTPException(422, "answer_too_long")
    recent = await db.scalar(
        select(func.count())
        .select_from(VariantRun)
        .where(actor.owns(VariantRun), VariantRun.created_at > now() - timedelta(hours=1))
    )
    if (recent or 0) >= RUNS_PER_HOUR:
        raise HTTPException(429, "too_many_runs")

    results = score_variant(tasks, body.answers)
    t = now()
    by_id = {task.id: task for task in tasks}
    for r in results:
        if r.outcome in (SELF, SKIPPED, Outcome.INVALID.value):
            continue
        task = by_id[r.task_id]
        # Each checked answer is an ordinary attempt: mastery and history see it.
        db.add(
            Attempt(
                anon_id=actor.anon_id,
                user_id=actor.user_id,
                task_id=task.id,
                outcome=r.outcome,
                raw_answer=r.answer,
                points=r.points,
                max_points=r.max_points,
                content_version=task.content_version,
                created_at=t,
            )
        )
    run = VariantRun(
        anon_id=actor.anon_id,
        user_id=actor.user_id,
        exam_id=body.exam_id,
        variant=body.variant,
        content_version=store.versions.get(body.exam_id, ""),
        results=[r.as_json() for r in results],
        auto_points=sum(r.points for r in results),
        self_points={},
        max_points=sum(r.max_points for r in results),
        duration_s=body.duration_s,
        created_at=t,
    )
    db.add(run)
    await db.commit()
    return _out(run)


@router.put("/variants/runs/{run_id}/self-assessment")
async def self_assess(
    run_id: int, body: SelfAssessment, db: Db, actor: CurrentActor
) -> VariantRunOut:
    run = await _run_or_404(db, actor, run_id)
    allowed = {r["task_id"]: r["max_points"] for r in run.results if r["outcome"] == SELF}
    for task_id, points in body.points.items():
        if task_id not in allowed:
            raise HTTPException(422, "not_self_assessed_task")
        if not 0 <= points <= allowed[task_id]:
            raise HTTPException(422, "points_out_of_range")
    # Reassign so SQLAlchemy sees the JSON change.
    run.self_points = {**run.self_points, **body.points}
    await db.commit()
    return _out(run)


@router.get("/variants/runs/{run_id}")
async def get_run(run_id: int, db: Db, actor: CurrentActor) -> VariantRunOut:
    return _out(await _run_or_404(db, actor, run_id))


@router.get("/variants/runs")
async def list_runs(
    db: Db, actor: CurrentActor, exam_id: str | None = None
) -> list[VariantRunSummary]:
    q = select(VariantRun).where(actor.owns(VariantRun))
    if exam_id:
        q = q.where(VariantRun.exam_id == exam_id)
    runs = await db.scalars(q.order_by(VariantRun.id.desc()).limit(LIST_LIMIT))
    return [
        VariantRunSummary(
            id=r.id,
            exam_id=r.exam_id,
            variant=r.variant,
            total_points=_total(r),
            max_points=r.max_points,
            pending=_pending(r),
            created_at=as_utc(r.created_at),
        )
        for r in runs
    ]


@router.get("/tasks/status")
async def task_statuses(db: Db, actor: CurrentActor) -> TaskStatuses:
    rows = await db.execute(
        select(Attempt.task_id, func.max(Attempt.points), func.max(Attempt.max_points))
        .where(actor.owns(), Attempt.outcome != "revealed")
        .group_by(Attempt.task_id)
    )
    return TaskStatuses(
        tasks={tid: "solved" if best >= top else "attempted" for tid, best, top in rows}
    )
