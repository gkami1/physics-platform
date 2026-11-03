"""One tutor turn on a task page: ladder step, model context and leak guard. Pure.

Shared by the API endpoint and the eval harness, so evals exercise the same decisions
students get.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from platform_api.content import PrivateTask
from platform_api.hints import MAX_LEVEL, LadderState, next_level
from platform_api.leak import LeakDetector
from platform_api.policy import can_reveal_solution
from platform_api.prompt import hints_for_level, task_context

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
