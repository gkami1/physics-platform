"""Plays scripted conversations against the tutor, in-process.

Uses the API's own pieces (ladder, context, prompt, output guard, model client), so a
conversation here gets exactly the prompts and guard a student would. Persistence and
HTTP are left out: history is the text the student would have seen.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

from content_schema.checking import format_answer
from platform_api.content import ContentStore, PrivateTask, Theory
from platform_api.hints import LadderState
from platform_api.leak import Detector, OutputGuard, visible_text
from platform_api.llm import CallInfo, ChatModel, LLMUnavailableError, stream_with_fallback
from platform_api.prompt import Turn, build_messages
from platform_api.turn import HINT_REQUEST_TEXT, plan_task_turn, plan_theory_turn
from platform_api.tutor import leak_note
from tutor_evals.checks import Limits, ReplyChecks, check_reply
from tutor_evals.suite import Persona, Suite


@dataclass
class TurnResult:
    persona: str
    kind: str
    target: str
    repeat: int
    index: int
    hint_level: int | None
    student: str
    raw: str  # model output, thinking removed, before the guard
    shown: str  # what the student would see
    leak: bool | None  # None when no leak check applies (level 3, theory without steps)
    checks: ReplyChecks
    error: str | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)

    def failures(self) -> list[str]:
        out = self.checks.failures()
        if self.leak:
            out.insert(0, "leak")
        if self.error:
            out.append("error")
        return out


def task_targets(suite: Suite, store: ContentStore, persona: Persona) -> list[PrivateTask]:
    tasks = (
        store.all()
        if suite.tasks == "all"
        else [t for i in suite.tasks if (t := store.task(i)) is not None]
    )
    if persona.answer_kinds is not None:
        tasks = [t for t in tasks if t.scoring.answer_kind in persona.answer_kinds]
    return sorted(tasks, key=lambda t: t.id)


def theory_targets(suite: Suite, store: ContentStore) -> list[str]:
    topics = store.theory_pages() if suite.theory == "all" else suite.theory
    return sorted(t for t in topics if store.theory(t) is not None)


async def _reply(
    models: Sequence[ChatModel],
    messages: list[dict[str, str]],
    detector: Detector | None,
    note: str,
) -> tuple[str, str, bool, str | None, list[CallInfo]]:
    """Returns (raw visible, shown, guard stopped, error, calls). Reads the whole answer
    even after the guard stops, so the raw text can be inspected."""
    guard = OutputGuard(detector)
    calls: list[CallInfo] = []
    raw = ""
    error = None
    try:
        async for chunk in stream_with_fallback(models, messages, calls):
            raw += chunk
            guard.feed(chunk)
        guard.finish()
    except LLMUnavailableError as e:
        error = str(e)
    shown = guard.text + (note if guard.leaked else "")
    return visible_text(raw), shown, guard.leaked, error, calls


# Free tiers (Google AI Studio) answer 429 over the per-minute quota and 503 or time out
# under load: wait and retry the turn.
RATE_LIMIT_WAITS = (10.0, 30.0, 60.0)
RETRYABLE = ("HTTP 429", "HTTP 503", "Timeout", "ConnectError", "RemoteProtocolError")


async def _reply_with_retry(
    models: Sequence[ChatModel],
    messages: list[dict[str, str]],
    detector: Detector | None,
    note: str,
    waits: Sequence[float],
) -> tuple[str, str, bool, str | None, list[CallInfo]]:
    calls: list[CallInfo] = []
    for wait in (*waits, None):
        raw, shown, stopped, error, attempt_calls = await _reply(models, messages, detector, note)
        calls += attempt_calls
        if wait is None or raw or not error or not any(r in error for r in RETRYABLE):
            return raw, shown, stopped, error, calls
        await asyncio.sleep(wait)
    raise AssertionError("unreachable")  # pragma: no cover


async def run_conversation(
    models: Sequence[ChatModel],
    persona: Persona,
    *,
    limits: Limits,
    task: PrivateTask | None = None,
    theory: Theory | None = None,
    steps: Sequence[PrivateTask] = (),  # step tasks embedded in the theory page
    repeat: int = 0,
    rate_limit_waits: Sequence[float] = RATE_LIMIT_WAITS,
) -> list[TurnResult]:
    target = task.id if task else theory.id if theory else ""
    answer = (format_answer(task.answer) or "") if task else ""
    history: list[Turn] = []
    state = LadderState(0, 0)
    outcomes: list[str] = []
    results: list[TurnResult] = []
    for i, st in enumerate(persona.turns):
        text = st.text.replace("{answer}", answer).strip()
        if not text and st.intent == "hint":
            text = HINT_REQUEST_TEXT
        if st.attempt:
            outcomes.append(st.attempt)
        level: int | None = None
        detector: Detector | None = None
        new_state = state
        if task is not None:
            plan = plan_task_turn(
                task, state, asked_for_hint=st.intent == "hint", outcomes=outcomes
            )
            new_state, level, context, detector = (
                plan.state,
                plan.level,
                plan.context,
                plan.detector,
            )
        elif theory is not None:
            tplan = plan_theory_turn(theory, steps)
            context, detector = tplan.context, tplan.detector
        else:
            raise ValueError("run_conversation needs a task or a theory page")
        messages = build_messages(context, history, text, level)
        raw, shown, stopped, error, calls = await _reply_with_retry(
            models, messages, detector, leak_note(persona.kind), rate_limit_waits
        )
        leak = None if detector is None else stopped or detector.leaks(raw)
        results.append(
            TurnResult(
                persona=persona.id,
                kind=persona.kind,
                target=target,
                repeat=repeat,
                index=i,
                hint_level=level,
                student=text,
                raw=raw,
                shown=shown,
                leak=leak,
                checks=check_reply(raw, limits),
                error=error,
                calls=[{k: v for k, v in asdict(c).items() if k != "started"} for c in calls],
            )
        )
        # As in the API: a turn with no reply shown is not saved and moves nothing.
        if shown.strip():
            state = new_state
            history += [Turn("user", text), Turn("assistant", shown)]
    return results


async def run_suite(
    suite: Suite,
    store: ContentStore,
    models: Sequence[ChatModel],
    *,
    repeats: int = 1,
    concurrency: int = 4,
    personas: Sequence[str] | None = None,
    on_done: Callable[[int, int, list[TurnResult]], None] | None = None,
) -> list[TurnResult]:
    """`on_done(done, total, turns)` after each conversation (progress output)."""
    sem = asyncio.Semaphore(concurrency)
    finished: list[int] = []
    jobs: list[Coroutine[Any, Any, list[TurnResult]]] = []

    async def guarded(**kw: Any) -> list[TurnResult]:
        async with sem:
            turns = await run_conversation(models, **kw)
        finished.append(1)
        if on_done:
            on_done(len(finished), len(jobs), turns)
        return turns

    for r in range(repeats):
        for p in suite.personas:
            if personas and p.id not in personas:
                continue
            lim = suite.limits[p.kind]
            limits = Limits(lim.max_chars, lim.max_sentences)
            if p.kind == "task":
                for t in task_targets(suite, store, p):
                    jobs.append(guarded(persona=p, limits=limits, task=t, repeat=r))
            else:
                for topic in theory_targets(suite, store):
                    if (page := store.theory(topic)) is None:
                        continue
                    steps = store.theory_steps(page)
                    jobs.append(
                        guarded(persona=p, limits=limits, theory=page, steps=steps, repeat=r)
                    )
    return [t for conv in await asyncio.gather(*jobs) for t in conv]
