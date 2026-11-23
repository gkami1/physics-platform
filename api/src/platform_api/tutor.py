"""AI tutor endpoints: thread history and a streamed reply (SSE)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import aclosing
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import anyio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from platform_api.access import tutor_limit
from platform_api.actor import SessionUser, as_utc, now
from platform_api.db import Attempt, LlmCall, TutorMessage, TutorThread, User
from platform_api.deps import Db, Store
from platform_api.hints import MAX_LEVEL, LadderState
from platform_api.leak import Detector, OutputGuard
from platform_api.llm import CallInfo, ChatModel, LLMUnavailableError, stream_with_fallback
from platform_api.prompt import (
    HISTORY_TURNS,
    PROMPT_VERSION,
    Turn,
    build_messages,
)
from platform_api.turn import (
    HINT_REQUEST_TEXT,
    max_reply_tokens,
    plan_task_turn,
    plan_theory_turn,
)

logger = logging.getLogger("api.tutor")

LEAK_NOTE = (
    "\n\n*Дальше я чуть не назвал ответ. Попробуй сделать этот шаг сам — или попроси подсказку.*"
)
# Theory pages have no hint button: send the student to the step task's answer field.
THEORY_LEAK_NOTE = (
    "\n\n*Дальше я чуть не назвал ответ задачи. Попробуй дойти до него сам"
    " и проверь в поле ответа под задачей.*"
)

# The model failed after part of the reply was shown.
TRUNCATED_NOTE = "\n\n*Ответ оборвался: репетитор перестал отвечать. Спроси ещё раз.*"
# The model stopped at the output cap: the history holds the text so far, so it can go on.
CUT_AT_LIMIT_NOTE = "\n\n*Ответ не поместился целиком. Напиши «продолжи», и я закончу.*"


def leak_note(kind: str) -> str:
    return THEORY_LEAK_NOTE if kind == "theory" else LEAK_NOTE


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
    daily_limit: int
    paid: bool


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


@dataclass(frozen=True)
class Allowance:
    left: int
    daily_limit: int
    paid: bool


async def _allowance(db: AsyncSession, request: Request, user: User) -> Allowance:
    used = await db.scalar(
        select(func.count())
        .select_from(TutorMessage)
        .where(
            TutorMessage.user_id == user.id,
            TutorMessage.role == "user",
            TutorMessage.created_at > now() - timedelta(days=1),
        )
    )
    limit = await tutor_limit(db, request.app.state.settings, user)
    return Allowance(max(limit.daily - (used or 0), 0), limit.daily, limit.paid)


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
    allowance = await _allowance(db, request, u)
    return ThreadOut(
        messages=[_out(m) for m in messages],
        hint_level=(thread.hint_level if thread else 0) if kind == "task" else None,
        max_hint_level=MAX_LEVEL,
        messages_left=allowance.left,
        daily_limit=allowance.daily_limit,
        paid=allowance.paid,
    )


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@dataclass(frozen=True)
class _PendingTurn:
    """Everything a turn writes, decided before the model answers and saved after."""

    user_id: int
    kind: str
    context_id: str
    text: str
    intent: str
    level: int | None
    # New ladder state (task threads); applied only once the student got a reply.
    state: LadderState | None


async def _save_turn(
    maker: async_sessionmaker[AsyncSession],
    turn: _PendingTurn,
    *,
    reply: str,
    reply_flags: dict[str, object],
    calls: Sequence[CallInfo],
    client_gone: bool,
) -> int | None:
    """Saves a finished turn; returns the assistant message id.

    A turn counts (quota, ladder step, history) only if the student saw a reply. When
    every model failed before answering, only the call traces are kept, so an outage
    costs the student neither a message nor a hint level. A student who left mid-reply
    still spent a model call: their message counts, without a ladder step if nothing
    was shown, and is marked `no_reply` so the next prompt skips it.
    """
    replied = bool(reply.strip())
    async with maker() as s:
        message_id: int | None = None
        if replied or client_gone:
            thread = await s.scalar(
                select(TutorThread).where(
                    TutorThread.user_id == turn.user_id,
                    TutorThread.context_kind == turn.kind,
                    TutorThread.context_id == turn.context_id,
                )
            )
            if thread is None:
                thread = TutorThread(
                    user_id=turn.user_id,
                    context_kind=turn.kind,
                    context_id=turn.context_id,
                    hint_level=0,
                    turns_at_level=0,
                )
                s.add(thread)
                await s.flush()
            if replied and turn.state is not None:
                thread.hint_level = turn.state.level
                thread.turns_at_level = turn.state.turns_at_level
            flags: dict[str, object] = {"intent": turn.intent}
            if not replied:
                flags["no_reply"] = True
            s.add(
                TutorMessage(
                    thread_id=thread.id,
                    user_id=turn.user_id,
                    role="user",
                    content=turn.text,
                    hint_level=turn.level,
                    flags=flags,
                    created_at=now(),
                )
            )
            if replied:
                msg = TutorMessage(
                    thread_id=thread.id,
                    user_id=turn.user_id,
                    role="assistant",
                    content=reply,
                    hint_level=turn.level,
                    flags=reply_flags,
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
    return message_id


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
    allowance = await _allowance(db, request, u)
    if allowance.left <= 0:
        raise HTTPException(429, "daily_limit")

    thread = await _thread(db, u, body.kind, body.id)
    history: list[Turn] = []
    if thread is not None:
        recent = await db.scalars(
            select(TutorMessage)
            .where(TutorMessage.thread_id == thread.id)
            .order_by(TutorMessage.id.desc())
            .limit(HISTORY_TURNS)
        )
        history = [
            Turn(m.role, m.content) for m in reversed(list(recent)) if not m.flags.get("no_reply")
        ]

    level: int | None = None
    prev_level: int | None = None
    state: LadderState | None = None
    detector: Detector | None = None
    if body.kind == "task":
        task = store.task(body.id)
        if task is None:
            raise HTTPException(404, "context not found")
        outcomes = list(
            await db.scalars(
                select(Attempt.outcome).where(Attempt.user_id == u.id, Attempt.task_id == task.id)
            )
        )
        current = (
            LadderState(thread.hint_level, thread.turns_at_level) if thread else LadderState(0, 0)
        )
        turn = plan_task_turn(
            task, current, asked_for_hint=body.intent == "hint", outcomes=outcomes
        )
        prev_level, state = current.level, turn.state
        level, context, detector = turn.level, turn.context, turn.detector
    else:
        page = store.theory(body.id)
        if page is None:
            raise HTTPException(404, "context not found")
        theory_turn = plan_theory_turn(page, store.theory_steps(page))
        context, detector = theory_turn.context, theory_turn.detector
    # Nothing is written yet: the turn is saved once the reply is known (`_save_turn`).
    await db.close()

    messages = build_messages(context, history, text, level)
    pending = _PendingTurn(u.id, body.kind, body.id, text, body.intent, level, state)
    maker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker

    async def events() -> AsyncIterator[str]:
        guard = OutputGuard(detector)
        calls: list[CallInfo] = []
        shown = ""  # everything sent to the student
        saved = False
        try:
            yield _sse(
                "meta",
                {
                    "hint_level": level,
                    "messages_left": allowance.left - 1,
                    "daily_limit": allowance.daily_limit,
                    "paid": allowance.paid,
                },
            )
            error: str | None = None
            try:
                stream = stream_with_fallback(models, messages, calls, max_reply_tokens(level))
                async with aclosing(stream) as chunks:
                    async for chunk in chunks:
                        if out := guard.feed(chunk):
                            shown += out
                            yield _sse("delta", {"text": out})
                        if guard.leaked:
                            break
                if tail := guard.finish():
                    shown += tail
                    yield _sse("delta", {"text": tail})
            except LLMUnavailableError as e:
                error = str(e)
            note = ""
            if guard.leaked:
                note = leak_note(body.kind)
                logger.warning("tutor answer leak stopped", extra={"context_id": body.id})
            elif error and shown.strip():
                note = TRUNCATED_NOTE  # the model died mid-answer
            elif calls and calls[-1].finish_reason == "length":
                note = CUT_AT_LIMIT_NOTE
            if note:
                shown += note
                yield _sse("delta", {"text": note})
            reply_flags: dict[str, object] = {}
            if guard.leaked:
                reply_flags["leak"] = True
            if note == TRUNCATED_NOTE:
                reply_flags["truncated"] = True
            if note == CUT_AT_LIMIT_NOTE:
                reply_flags["cut_at_limit"] = True
            saved = True
            with anyio.CancelScope(shield=True):
                message_id = await _save_turn(
                    maker,
                    pending,
                    reply=shown,
                    reply_flags=reply_flags,
                    calls=calls,
                    client_gone=False,
                )
            if message_id is None:
                # Nothing was counted: let the client restore its level and counter.
                yield _sse(
                    "error",
                    {
                        "detail": "tutor_unavailable",
                        "hint_level": prev_level,
                        "messages_left": allowance.left,
                        "daily_limit": allowance.daily_limit,
                        "paid": allowance.paid,
                    },
                )
            else:
                yield _sse("done", {"message_id": message_id, "leak": guard.leaked})
        finally:
            if not saved:
                # The student left mid-stream (cancelled or closed generator). The model
                # call already happened, so the turn still counts; save it unshielded
                # from the cancellation.
                with anyio.CancelScope(shield=True):
                    await _save_turn(
                        maker,
                        pending,
                        reply=shown,
                        reply_flags={"interrupted": True},
                        calls=calls,
                        client_gone=True,
                    )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
