"""One tutor turn: ladder step (task pages), model context and leak guard. Pure.

Shared by the API endpoint and the eval harness, so evals exercise the same decisions
students get.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from platform_api.content import PrivateTask, Theory
from platform_api.hints import MAX_LEVEL, LadderState, next_level
from platform_api.leak import AnyLeak, Detector, LeakDetector
from platform_api.policy import can_reveal_solution
from platform_api.prompt import hints_for_level, task_context, theory_context

HINT_REQUEST_TEXT = "Дай, пожалуйста, подсказку."


@dataclass(frozen=True)
class TaskTurn:
    state: LadderState
    context: str
    # None at level 3: the full solution may be shown.
    detector: LeakDetector | None

    @property
    def level(self) -> int:
        return self.state.level


def plan_task_turn(
    task: PrivateTask, state: LadderState, *, asked_for_hint: bool, outcomes: Sequence[str]
) -> TaskTurn:
    """`outcomes`: the student's attempt outcomes on this task so far."""
    new = next_level(
        state,
        asked_for_hint=asked_for_hint,
        wrong_attempts=sum(o in ("wrong", "partial") for o in outcomes),
        solution_allowed=can_reveal_solution(task.scoring.answer_kind, outcomes),
    )
    detector = None
    if new.level < MAX_LEVEL:
        allowed = "\n".join([task.statement, *hints_for_level(task, new.level)])
        detector = LeakDetector(task.answer, allowed)
    return TaskTurn(new, task_context(task, new.level), detector)


@dataclass(frozen=True)
class TheoryTurn:
    context: str
    # None when the page has no step tasks.
    detector: Detector | None


def plan_theory_turn(page: Theory, steps: Sequence[PrivateTask]) -> TheoryTurn:
    """`steps`: the step tasks embedded in the page. Theory has no hint ladder, but the
    tutor must not hand out the answers to the page's step tasks (they count toward
    mastery). Numbers printed anywhere on the page or in a statement are not leaks: the
    tutor has to be able to quote the text."""
    detector: Detector | None = None
    if steps:
        allowed = "\n".join([page.body, *(t.statement for t in steps)])
        detector = AnyLeak([LeakDetector(t.answer, allowed) for t in steps])
    return TheoryTurn(theory_context(page, steps), detector)
