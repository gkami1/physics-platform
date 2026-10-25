"""Shared FastAPI dependencies. Aliases stay module-level (see CLAUDE.md gotchas)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from platform_api.content import ContentStore


def _content(request: Request) -> ContentStore:
    store: ContentStore = request.app.state.content
    return store


async def _db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


Store = Annotated[ContentStore, Depends(_content)]
Db = Annotated[AsyncSession, Depends(_db)]
