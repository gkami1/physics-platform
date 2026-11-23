"""Theory reading evidence: the theory page pings while it is read (ARCHITECTURE §10).

Pings carry active seconds since the last ping (the tab visible and the reader not idle),
whether this is a new page load and whether the reader reached the end of the text. The
profile reads them later; nothing here affects mastery.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from platform_api.actor import CurrentActor, now
from platform_api.db import TheoryVisit
from platform_api.deps import Db, Store

router = APIRouter(prefix="/api")

# The page pings about once a minute; a longer delta is a client bug or tampering.
MAX_ACTIVE_S = 300


class VisitPing(BaseModel):
    page_id: str = Field(min_length=1, max_length=120)
    active_s: int = Field(ge=0, le=MAX_ACTIVE_S)
    new_visit: bool = False
    finished: bool = False


@router.post("/theory/visits", status_code=204)
async def ping(body: VisitPing, store: Store, db: Db, actor: CurrentActor) -> None:
    if store.theory(body.page_id) is None:
        raise HTTPException(404, "page not found")
    t = now()
    row = await db.scalar(
        select(TheoryVisit)
        .where(actor.owns(TheoryVisit), TheoryVisit.page_id == body.page_id)
        .order_by(TheoryVisit.id)
        .limit(1)
    )
    if row is None:
        row = TheoryVisit(
            anon_id=actor.anon_id,
            user_id=actor.user_id,
            page_id=body.page_id,
            visits=1,
            active_s=0,
            first_at=t,
            last_at=t,
        )
        db.add(row)
    elif body.new_visit:
        row.visits += 1
    row.active_s += body.active_s
    row.last_at = t
    if body.finished and row.finished_at is None:
        row.finished_at = t
    await db.commit()
