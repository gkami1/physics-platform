from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from content_schema.checking import NotAutoCheckableError, check
from platform_api import log
from platform_api.content import ContentStore
from platform_api.settings import Settings

logger = logging.getLogger("api")


class CheckRequest(BaseModel):
    answer: str = Field(max_length=64)


class CheckResponse(BaseModel):
    outcome: str
    points: int
    max_points: int
    normalized: str | None


def _content(request: Request) -> ContentStore:
    store: ContentStore = request.app.state.content
    return store


Store = Annotated[ContentStore, Depends(_content)]


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
        app.state.content = store
        logger.info("content loaded", extra={"tasks": len(store), "versions": store.versions})
        yield

    app = FastAPI(
        title="physics-platform api",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.env != "prod" else None,
        openapi_url="/api/openapi.json" if settings.env != "prod" else None,
    )

    @app.get("/api/health")
    def health(store: Store) -> dict[str, object]:
        return {"status": "ok", "content": store.versions}

    @app.post("/api/tasks/{task_id}/check")
    def check_answer(task_id: str, body: CheckRequest, store: Store) -> CheckResponse:
        task = store.task(task_id)
        if task is None:
            raise HTTPException(404, "task not found")
        try:
            v = check(task.answer, task.scoring, body.answer)
        except NotAutoCheckableError:
            raise HTTPException(422, "task is not auto-checkable") from None
        return CheckResponse(
            outcome=v.outcome, points=v.points, max_points=v.max_points, normalized=v.normalized
        )

    return app


app = create_app()
