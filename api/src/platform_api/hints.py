"""Hint ladder: the server, never the model, decides how much help the tutor may give.

Levels: 0 nudge → 1 key idea → 2 partial step → 3 full solution.
"""

from __future__ import annotations

from dataclasses import dataclass

MAX_LEVEL = 3
# Without an explicit request, help grows after this many exchanges at one level,
# but only once the student has actually tried (a wrong attempt).
AUTO_ESCALATE_AFTER = 3


@dataclass(frozen=True)
class LadderState:
    level: int
    turns_at_level: int


def next_level(
    state: LadderState, *, asked_for_hint: bool, wrong_attempts: int, solution_allowed: bool
) -> LadderState:
    """State for the coming turn.

    - "Подсказка" button: one level up.
    - Plain messages: one level up after AUTO_ESCALATE_AFTER turns, if the student has tried.
    - Level 3 (full solution) only when the reveal policy already allows the solution
      (Part 1: after a graded attempt; Part 2: always) and the student asked for it.
    """
    ceiling = MAX_LEVEL if solution_allowed else MAX_LEVEL - 1
    up = asked_for_hint or (state.turns_at_level >= AUTO_ESCALATE_AFTER and wrong_attempts > 0)
    if up and state.level < ceiling:
        if state.level + 1 == MAX_LEVEL and not asked_for_hint:
            return LadderState(state.level, state.turns_at_level + 1)
        return LadderState(state.level + 1, 1)
    return LadderState(state.level, state.turns_at_level + 1)
