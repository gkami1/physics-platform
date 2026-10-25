from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from content_schema.checking import NotAutoCheckableError, Outcome, check, format_answer
from content_schema.models import AnswerKind
from platform_api import auth, log
from platform_api.actor import Actor, CurrentActor, as_utc, now
from platform_api.content import ContentStore, PrivateTask, sync_tasks
from platform_api.db import Attempt, Task, make_engine, make_sessionmaker
from platform_api.deps import Db, Store
from platform_api.mail import make_mailer
from platform_api.mastery import Evidence, compute_mastery
from platform_api.policy import can_reveal_solution, same_origin
from platform_api.settings import Settings

logger = logging.getLogger("api")

HISTORY_LIMIT = 20
ATTEMPTS_PER_MINUTE = 30


class AttemptRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=64)


class AttemptOut(BaseModel):
    outcome: str
    points: int
    max_points: int
    answer: str | None
    created_at: datetime


class AttemptResponse(BaseModel):
    outcome: str
    points: int
    max_points: int
    normalized: str | None
    solution_available: bool


class TaskState(BaseModel):
    attempts: list[AttemptOut]
    best_points: int
    max_points: int
    solution_available: bool


class Solution(BaseModel):
    answer: str | None
    solution: str  # Markdown + LaTeX, rendered client-side


class TopicProgress(BaseModel):
    exam_id: str
    topic_id: str
    score: float
    n: int


class Progress(BaseModel):
    topics: list[TopicProgress]


def _task_or_404(store: ContentStore, task_id: str) -> PrivateTask:
    task = store.task(task_id)
    if task is None:
        raise HTTPException(404, "task not found")
    return task


async def _history(db: AsyncSession, actor: Actor, task_id: str) -> list[Attempt]:
    rows = await db.scalars(
        select(Attempt)
        .where(actor.owns(), Attempt.task_id == task_id)
        .order_by(Attempt.created_at.desc(), Attempt.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return list(rows)


def _new_attempt(
    actor: Actor, task: PrivateTask, outcome: str, raw_answer: str | None, points: int
) -> Attempt:
    return Attempt(
        anon_id=actor.anon_id,
        user_id=actor.user_id,
        task_id=task.id,
        outcome=outcome,
        raw_answer=raw_answer,
        points=points,
        max_points=task.scoring.max_points,
        content_version=task.content_version,
        created_at=now(),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    log.configure(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        store = ContentStore.load(settings.private_content_dir)
        if not len(store):
            logger.warning(
                "no private content loaded", extra={"dir": str(settings.private_content_dir)}
            )
        engine = make_engine(settings.database_url)
        app.state.settings = settings
        app.state.content = store
        app.state.mailer = make_mailer(settings)
        app.state.sessionmaker = make_sessionmaker(engine)
        async with app.state.sessionmaker() as session:
            await sync_tasks(session, store)
        logger.info("content loaded", extra={"tasks": len(store), "versions": store.versions})
        yield
        await engine.dispose()

    app = FastAPI(
        title="physics-platform api",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.env != "prod" else None,
        openapi_url="/api/openapi.json" if settings.env != "prod" else None,
    )

    @app.middleware("http")
    async def csrf_origin_check(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # On top of SameSite=Lax cookies: also blocks POSTs from other same-site origins.
        if request.method not in ("GET", "HEAD", "OPTIONS") and not same_origin(
            request.headers.get("origin"), request.headers.get("host")
        ):
            return JSONResponse({"detail": "bad_origin"}, status_code=403)
        return await call_next(request)

    app.include_router(auth.router)

    @app.get("/api/health")
    def health(store: Store) -> dict[str, object]:
        return {"status": "ok", "content": store.versions}

    @app.post("/api/tasks/{task_id}/attempts")
    async def submit_attempt(
        task_id: str, body: AttemptRequest, store: Store, db: Db, actor: CurrentActor
    ) -> AttemptResponse:
        task = _task_or_404(store, task_id)
        try:
            v = check(task.answer, task.scoring, body.answer)
        except NotAutoCheckableError:
            raise HTTPException(422, "task is not auto-checkable") from None

        outcomes = [a.outcome for a in await _history(db, actor, task_id)]
        if v.outcome is not Outcome.INVALID:
            recent = await db.scalar(
                select(func.count())
                .select_from(Attempt)
                .where(actor.owns(), Attempt.created_at > now() - timedelta(minutes=1))
            )
            if (recent or 0) >= ATTEMPTS_PER_MINUTE:
                raise HTTPException(429, "too_many_attempts")
            db.add(_new_attempt(actor, task, v.outcome.value, body.answer, v.points))
            await db.commit()
            outcomes.append(v.outcome.value)
        return AttemptResponse(
            outcome=v.outcome,
            points=v.points,
            max_points=v.max_points,
            normalized=v.normalized,
            solution_available=can_reveal_solution(task.scoring.answer_kind, outcomes),
        )

    @app.get("/api/tasks/{task_id}/state")
    async def task_state(task_id: str, store: Store, db: Db, actor: CurrentActor) -> TaskState:
        task = _task_or_404(store, task_id)
        history = await _history(db, actor, task_id)
        return TaskState(
            attempts=[
                AttemptOut(
                    outcome=a.outcome,
                    points=a.points,
                    max_points=a.max_points,
                    answer=a.raw_answer,
                    created_at=as_utc(a.created_at),
                )
                for a in history
            ],
            best_points=max((a.points for a in history), default=0),
            max_points=task.scoring.max_points,
            solution_available=can_reveal_solution(
                task.scoring.answer_kind, [a.outcome for a in history]
            ),
        )

    @app.post("/api/tasks/{task_id}/reveal")
    async def reveal_solution(task_id: str, store: Store, db: Db, actor: CurrentActor) -> Solution:
        task = _task_or_404(store, task_id)
        history = await _history(db, actor, task_id)
        kind = task.scoring.answer_kind
        if not can_reveal_solution(kind, [a.outcome for a in history]):
            raise HTTPException(403, "try the task first")
        if kind is not AnswerKind.EXTENDED and not any(a.outcome == "revealed" for a in history):
            # Recorded once, for analytics. Mastery ignores it: only first graded attempts count.
            db.add(_new_attempt(actor, task, "revealed", None, 0))
            await db.commit()
        return Solution(answer=format_answer(task.answer), solution=task.solution)

    @app.get("/api/progress")
    async def progress(db: Db, actor: CurrentActor) -> Progress:
        rows = await db.execute(
            select(Attempt.task_id, Attempt.outcome, Attempt.points, Attempt.max_points, Task)
            .join(Task, Task.id == Attempt.task_id)
            .where(actor.owns())
            .order_by(Attempt.created_at, Attempt.id)
        )
        exam_of: dict[str, str] = {}
        evidence: list[Evidence] = []
        for task_id, outcome, points, max_points, task in rows:
            evidence.append(Evidence(task_id, task.topics, outcome, points, max_points))
            for topic in task.topics:
                exam_of[topic] = task.exam_id
        return Progress(
            topics=[
                TopicProgress(exam_id=exam_of[t], topic_id=t, score=round(m.score, 3), n=m.n)
                for t, m in sorted(compute_mastery(evidence).items())
            ]
        )

    return app


app = create_app()
