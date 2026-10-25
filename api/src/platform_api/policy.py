"""Pure decision rules. No I/O; table-tested."""

from __future__ import annotations

from collections.abc import Sequence
from urllib.parse import urlsplit

from content_schema.models import AnswerKind

GRADED = frozenset({"correct", "partial", "wrong"})


def can_reveal_solution(answer_kind: AnswerKind, outcomes: Sequence[str]) -> bool:
    """Part 2 solutions are always viewable (they are self-assessed). Part 1 solutions open
    after at least one real try, so the reveal button is never a free answer lookup."""
    if answer_kind is AnswerKind.EXTENDED:
        return True
    return any(o in GRADED or o == "revealed" for o in outcomes)


def same_origin(origin: str | None, host: str | None) -> bool:
    """CSRF check for state-changing requests. Browsers always send Origin on cross-origin
    POSTs, so a missing header means a non-browser client (curl, tests), which is allowed.
    Caddy and the Vite dev proxy both pass the browser's Host through unchanged."""
    if origin is None:
        return True
    if origin == "null" or not host:
        return False
    return urlsplit(origin).netloc.lower() == host.lower()
