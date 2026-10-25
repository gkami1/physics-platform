"""Pure decision rules. No I/O; table-tested."""

from __future__ import annotations

from collections.abc import Sequence

from content_schema.models import AnswerKind

GRADED = frozenset({"correct", "partial", "wrong"})


def can_reveal_solution(answer_kind: AnswerKind, outcomes: Sequence[str]) -> bool:
    """Part 2 solutions are always viewable (they are self-assessed). Part 1 solutions open
    after at least one real try, so the reveal button is never a free answer lookup."""
    if answer_kind is AnswerKind.EXTENDED:
        return True
    return any(o in GRADED or o == "revealed" for o in outcomes)
