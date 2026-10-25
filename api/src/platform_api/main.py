from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from content_schema.checking import NotAutoCheckableError, Outcome, check, format_answer
from content_schema.models import AnswerKind
from platform_api import log
from platform_api.actor import AnonId
from platform_api.content import ContentStore, PrivateTask, sync_tasks
from platform_api.db import Attempt, make_engine, make_sessionmaker
from platform_api.policy import can_reveal_solution
from platform_api.settings import Settings

logger = logging.getLogger("api")

HISTORY_LIMIT = 20


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


def _content(request: Request) -> ContentStore:
    store: ContentStore = request.app.state.content
    return store


async def _session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


Store = Annotated[ContentStore, Depends(_content)]
Session = Annotated[AsyncSession, Depends(_session)]


def _task_or_404(store: ContentStore, task_id: str) -> PrivateTask:
    task = store.task(task_id)
    if task is None:
        raise HTTPException(404, "task not found")
    return task


async def _history(session: AsyncSession, anon: str, task_id: str) -> list[Attempt]:
    rows = await session.scalars(
        select(Attempt)
        .where(Attempt.anon_id == anon, Attempt.task_id == task_id)
        .order_by(Attempt.created_at.desc(), Attempt.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return list(rows)


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

    @app.get("/api/health")
    def health(store: Store) -> dict[str, object]:
        return {"status": "ok", "content": store.versions}

    @app.post("/api/tasks/{task_id}/attempts")
    async def submit_attempt(
        task_id: str, body: AttemptRequest, store: Store, session: Session, anon: AnonId
    ) -> AttemptResponse:
        task = _task_or_404(store, task_id)
        try:
            v = check(task.answer, task.scoring, body.answer)
        except NotAutoCheckableError:
            raise HTTPException(422, "task is not auto-checkable") from None

        outcomes = [a.outcome for a in await _history(session, anon, task_id)]
        if v.outcome is not Outcome.INVALID:
            session.add(
                Attempt(
                    anon_id=anon,
                    task_id=task.id,
                    outcome=v.outcome.value,
                    raw_answer=body.answer,
                    points=v.points,
                    max_points=v.max_points,
                    content_version=task.content_version,
                )
            )
            await session.commit()
            outcomes.append(v.outcome.value)
        return AttemptResponse(
            outcome=v.outcome,
            points=v.points,
            max_points=v.max_points,
            normalized=v.normalized,
            solution_available=can_reveal_solution(task.scoring.answer_kind, outcomes),
        )

    @app.get("/api/tasks/{task_id}/state")
    async def task_state(task_id: str, store: Store, session: Session, anon: AnonId) -> TaskState:
        task = _task_or_404(store, task_id)
        history = await _history(session, anon, task_id)
        return TaskState(
            attempts=[
                AttemptOut(
                    outcome=a.outcome,
                    points=a.points,
                    max_points=a.max_points,
                    answer=a.raw_answer,
                    created_at=a.created_at,
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
    async def reveal_solution(
        task_id: str, store: Store, session: Session, anon: AnonId
    ) -> Solution:
        task = _task_or_404(store, task_id)
        history = await _history(session, anon, task_id)
        kind = task.scoring.answer_kind
        if not can_reveal_solution(kind, [a.outcome for a in history]):
            raise HTTPException(403, "try the task first")
        if kind is not AnswerKind.EXTENDED and not any(a.outcome == "revealed" for a in history):
            # Recorded so mastery can discount tasks solved after seeing the solution.
            session.add(
                Attempt(
                    anon_id=anon,
                    task_id=task.id,
                    outcome="revealed",
                    raw_answer=None,
                    points=0,
                    max_points=task.scoring.max_points,
                    content_version=task.content_version,
                )
            )
            await session.commit()
        return Solution(answer=format_answer(task.answer), solution=task.solution)

    return app


app = create_app()
