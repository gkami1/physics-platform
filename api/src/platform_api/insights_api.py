"""`GET /api/insights`: the student profile («Мой профиль», ARCHITECTURE §10).

Loads the actor's evidence with a few queries and hands it to the pure functions in
`insights.py`. The response is ids and numbers only: titles and statements come from the
site's public bundle, and nothing here touches answers, solutions or hints.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, select

from content_schema.models import AnswerKind
from platform_api import insights as ins
from platform_api.access import paid_until
from platform_api.actor import Actor, CurrentActor, as_utc, now
from platform_api.content import ContentStore
from platform_api.db import Attempt, Task, TheoryVisit, TutorMessage, TutorThread, VariantRun
from platform_api.deps import Db, Store

router = APIRouter(prefix="/api")

# Decided 2026-11-24: the full profile is part of the paid plan (offer §2.2 lists it); free
# users get the teaser. Switching this off again needs the pricing page and offer updated.
PROFILE_REQUIRES_PASS = True


class Insights(BaseModel):
    exam_id: str
    teaser: bool  # True: only `counts` and the teaser topic are filled
    as_of: datetime
    counts: dict[str, int]
    topics: list[ins.TopicInsight]
    practice: list[ins.PracticeItem] | None
    mistakes: list[ins.Mistake] | None
    prediction: ins.Prediction | None


async def _evidence(
    db: Db, store: ContentStore, actor: Actor, exam_id: str, season: int
) -> ins.EvidenceBundle:
    tasks = {
        t.id: ins.TaskInfo(
            t.id,
            t.ege_task,
            t.topics,
            t.difficulty,
            t.published,
            t.in_season(season),
            checkable=t.scoring.answer_kind is not AnswerKind.EXTENDED,
        )
        for t in store.all()
        if t.exam_id == exam_id
    }

    attempts: list[ins.AttemptRow] = []
    rows = await db.execute(
        select(
            Attempt.task_id,
            Attempt.outcome,
            Attempt.points,
            Attempt.max_points,
            Attempt.created_at,
            Task.ege_task,
            Task.topics,
        )
        .join(Task, Task.id == Attempt.task_id)
        .where(actor.owns(), Task.exam_id == exam_id)
        .order_by(Attempt.created_at, Attempt.id)
    )
    for task_id, outcome, points, max_points, at, ege_task, topics in rows:
        if task_id not in tasks:  # removed from content: evidence, never offered again
            tasks[task_id] = ins.TaskInfo(task_id, ege_task, tuple(topics), active=False)
        attempts.append(ins.AttemptRow(task_id, outcome, points, max_points, as_utc(at)))

    pages: dict[str, list[str]] = defaultdict(list)
    for page_id in store.theory_pages():
        page = store.theory(page_id)
        if page is not None and page.exam_id == exam_id:
            pages[page.topic].append(page_id)
    visits = [
        ins.VisitRow(page_id, n, active_s, finished)
        for page_id, n, active_s, finished in await db.execute(
            select(
                TheoryVisit.page_id,
                TheoryVisit.visits,
                TheoryVisit.active_s,
                TheoryVisit.finished_at.is_not(None),
            ).where(actor.owns(TheoryVisit))
        )
        if page_id.split("/", 1)[0] in pages
    ]

    threads: list[ins.ThreadStat] = []
    if actor.user is not None:  # the tutor is for signed-in users only
        questions = func.count(TutorMessage.id)
        for kind, context_id, level, n in await db.execute(
            select(
                TutorThread.context_kind, TutorThread.context_id, TutorThread.hint_level, questions
            )
            .outerjoin(
                TutorMessage,
                and_(TutorMessage.thread_id == TutorThread.id, TutorMessage.role == "user"),
            )
            .where(TutorThread.user_id == actor.user.id)
            .group_by(TutorThread.id)
        ):
            threads.append(ins.ThreadStat(kind, context_id, level, int(n)))

    runs = [
        _run(at, results, self_points)
        for at, results, self_points in await db.execute(
            select(VariantRun.created_at, VariantRun.results, VariantRun.self_points)
            .where(actor.owns(VariantRun), VariantRun.exam_id == exam_id)
            .order_by(VariantRun.created_at.desc(), VariantRun.id.desc())
            .limit(ins.RECENT_RUNS)
        )
    ]
    return ins.EvidenceBundle(tasks, attempts, visits, threads, runs, dict(pages))


def _run(
    at: datetime, results: list[dict[str, Any]], self_points: dict[str, Any]
) -> ins.VariantRunRow:
    out = []
    for r in results:
        points: int | None = r["points"]
        if r["outcome"] == "self":  # Part 2: only once self-assessed
            points = int(self_points[r["task_id"]]) if r["task_id"] in self_points else None
        out.append(ins.RunResult(r["task_id"], r["ege_task"], r["part"], points, r["max_points"]))
    return ins.VariantRunRow(as_utc(at), tuple(out))


@router.get("/insights")
async def insights(exam: str, store: Store, db: Db, actor: CurrentActor) -> Insights:
    spec = store.exam(exam)
    if spec is None:
        raise HTTPException(404, "exam not found")
    exam_spec, roadmap = spec
    t = now()
    ev = await _evidence(db, store, actor, exam, exam_spec.season)

    topics = ins.topic_insights(roadmap, ev, t.date())
    practice = ins.practice_set(roadmap, ev, t)
    notebook = ins.mistakes(ev, t.date())
    counts: dict[str, int] = {s: sum(1 for x in topics if x.status == s) for s in ins.STATUSES}
    counts |= {
        "practice": len(practice),
        "mistakes": len(notebook),
        "mistakes_due": sum(1 for m in notebook if m.due),
    }

    paid = actor.user is not None and await paid_until(db, actor.user) is not None
    if PROFILE_REQUIRES_PASS and not paid:
        first = ins.teaser_topic(topics)
        return Insights(
            exam_id=exam,
            teaser=True,
            as_of=t,
            counts=counts,
            topics=[first] if first else [],
            practice=None,
            mistakes=None,
            prediction=None,
        )
    return Insights(
        exam_id=exam,
        teaser=False,
        as_of=t,
        counts=counts,
        topics=topics,
        practice=practice,
        mistakes=notebook,
        prediction=ins.predict(exam_spec, roadmap, ev),
    )
