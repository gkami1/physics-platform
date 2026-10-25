"""AI tutor endpoints: thread history and a streamed reply (SSE)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from platform_api.actor import SessionUser, as_utc, now
from platform_api.db import Attempt, LlmCall, TutorMessage, TutorThread, User
from platform_api.deps import Db, Store
from platform_api.hints import MAX_LEVEL, LadderState, next_level
from platform_api.leak import LeakDetector, OutputGuard
from platform_api.llm import CallInfo, ChatModel, LLMUnavailableError, stream_with_fallback
from platform_api.policy import can_reveal_solution
from platform_api.prompt import (
    HISTORY_TURNS,
    PROMPT_VERSION,
    Turn,
    build_messages,
    hints_for_level,
    task_context,
    theory_context,
)

logger = logging.getLogger("api.tutor")

HINT_REQUEST_TEXT = "Дай, пожалуйста, подсказку."
LEAK_NOTE = (
    "\n\n*Дальше я чуть не назвал ответ. Попробуй сделать этот шаг сам — или попроси подсказку.*"
)
ContextKind = Literal["task", "theory"]

router = APIRouter(prefix="/api/tutor")


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    hint_level: int | None
    leak: bool
    created_at: datetime


class ThreadOut(BaseModel):
    messages: list[MessageOut]
    hint_level: int | None
    max_hint_level: int
    messages_left: int


class MessageIn(BaseModel):
    kind: ContextKind
    id: str = Field(max_length=80)
    text: str = Field(default="", max_length=2000)
    intent: Literal["message", "hint"] = "message"


def _user_or_401(user: User | None) -> User:
    if user is None:
        raise HTTPException(401, "sign_in_required")
    return user


def _check_context(store: Store, kind: ContextKind, context_id: str) -> None:
    found = store.task(context_id) if kind == "task" else store.theory(context_id)
    if found is None:
        raise HTTPException(404, "context not found")


async def _thread(db: AsyncSession, user: User, kind: str, context_id: str) -> TutorThread | None:
    return await db.scalar(
        select(TutorThread).where(
            TutorThread.user_id == user.id,
            TutorThread.context_kind == kind,
            TutorThread.context_id == context_id,
        )
    )


async def _messages_left(db: AsyncSession, request: Request, user: User) -> int:
    used = await db.scalar(
        select(func.count())
        .select_from(TutorMessage)
        .where(
            TutorMessage.user_id == user.id,
            TutorMessage.role == "user",
            TutorMessage.created_at > now() - timedelta(days=1),
        )
    )
    limit: int = request.app.state.settings.tutor_daily_messages
    return max(limit - (used or 0), 0)


def _out(m: TutorMessage) -> MessageOut:
    return MessageOut(
        id=m.id,
        role=m.role,
        content=m.content,
        hint_level=m.hint_level,
        leak=bool(m.flags.get("leak")),
        created_at=as_utc(m.created_at),
    )


@router.get("/thread")
async def get_thread(
    kind: ContextKind, id: str, request: Request, store: Store, db: Db, user: SessionUser
) -> ThreadOut:
    u = _user_or_401(user)
    _check_context(store, kind, id)
    thread = await _thread(db, u, kind, id)
    messages: list[TutorMessage] = []
    if thread is not None:
        messages = list(
            await db.scalars(
                select(TutorMessage)
                .where(TutorMessage.thread_id == thread.id)
                .order_by(TutorMessage.id)
            )
        )
    return ThreadOut(
        messages=[_out(m) for m in messages],
        hint_level=(thread.hint_level if thread else 0) if kind == "task" else None,
        max_hint_level=MAX_LEVEL,
        messages_left=await _messages_left(db, request, u),
    )


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/messages")
async def post_message(
    body: MessageIn, request: Request, store: Store, db: Db, user: SessionUser
) -> StreamingResponse:
    u = _user_or_401(user)
    text = body.text.strip() or (HINT_REQUEST_TEXT if body.intent == "hint" else "")
    if not text:
        raise HTTPException(422, "empty_message")
    models: list[ChatModel] = request.app.state.llm
    if not models:
        raise HTTPException(503, "tutor_unavailable")
    if await _messages_left(db, request, u) <= 0:
        raise HTTPException(429, "daily_limit")

    thread = await _thread(db, u, body.kind, body.id)
    if thread is None:
        thread = TutorThread(
            user_id=u.id, context_kind=body.kind, context_id=body.id, hint_level=0, turns_at_level=0
        )
        db.add(thread)
        await db.flush()
    history = [
        Turn(m.role, m.content)
        for m in reversed(
            list(
                await db.scalars(
                    select(TutorMessage)
                    .where(TutorMessage.thread_id == thread.id)
                    .order_by(TutorMessage.id.desc())
                    .limit(HISTORY_TURNS)
                )
            )
        )
    ]

    level: int | None = None
    detector: LeakDetector | None = None
    if body.kind == "task":
        task = store.task(body.id)
        if task is None:
            raise HTTPException(404, "context not found")
        outcomes = list(
            await db.scalars(
                select(Attempt.outcome).where(Attempt.user_id == u.id, Attempt.task_id == task.id)
            )
        )
        state = next_level(
            LadderState(thread.hint_level, thread.turns_at_level),
            asked_for_hint=body.intent == "hint",
            wrong_attempts=sum(o in ("wrong", "partial") for o in outcomes),
            solution_allowed=can_reveal_solution(task.scoring.answer_kind, outcomes),
        )
        thread.hint_level, thread.turns_at_level = state.level, state.turns_at_level
        level = state.level
        context = task_context(task, level)
        if level < MAX_LEVEL:
            allowed = "\n".join([task.statement, *hints_for_level(task, level)])
            detector = LeakDetector(task.answer, allowed)
    else:
        page = store.theory(body.id)
        if page is None:
            raise HTTPException(404, "context not found")
        context = theory_context(page)

    db.add(
        TutorMessage(
            thread_id=thread.id,
            user_id=u.id,
            role="user",
            content=text,
            hint_level=level,
            flags={"intent": body.intent},
            created_at=now(),
        )
    )
    await db.commit()
    messages = build_messages(context, history, text, level)
    left = await _messages_left(db, request, u)

    async def events() -> AsyncIterator[str]:
        yield _sse("meta", {"hint_level": level, "messages_left": left})
        guard = OutputGuard(detector)
        calls: list[CallInfo] = []
        error: str | None = None
        try:
            stream = stream_with_fallback(models, messages, calls)
            async with aclosing(stream) as chunks:
                async for chunk in chunks:
                    if out := guard.feed(chunk):
                        yield _sse("delta", {"text": out})
                    if guard.leaked:
                        break
            if tail := guard.finish():
                yield _sse("delta", {"text": tail})
        except LLMUnavailableError as e:
            error = str(e)
        content = guard.text
        if guard.leaked:
            content += LEAK_NOTE
            yield _sse("delta", {"text": LEAK_NOTE})
            logger.warning("tutor answer leak stopped", extra={"thread_id": thread.id})

        maker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
        async with maker() as s:
            message_id: int | None = None
            if content.strip():
                msg = TutorMessage(
                    thread_id=thread.id,
                    user_id=u.id,
                    role="assistant",
                    content=content,
                    hint_level=level,
                    flags={"leak": True} if guard.leaked else {},
                    created_at=now(),
                )
                s.add(msg)
                await s.flush()
                message_id = msg.id
            for c in calls:
                s.add(
                    LlmCall(
                        message_id=message_id,
                        provider=c.provider,
                        model=c.model,
                        prompt_version=PROMPT_VERSION,
                        ttft_ms=c.ttft_ms,
                        latency_ms=c.latency_ms,
                        tokens_in=c.tokens_in,
                        tokens_out=c.tokens_out,
                        cost_kop=c.cost_kop,
                        error=c.error,
                    )
                )
            await s.commit()
        if error and message_id is None:
            yield _sse("error", {"detail": "tutor_unavailable"})
        else:
            yield _sse("done", {"message_id": message_id, "leak": guard.leaked})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
