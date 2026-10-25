"""Topic mastery from attempts. Pure; computed on read (cheap at MVP scale).

Rule:
- Evidence is the *first graded* attempt on each task (points / max_points). Retrying a task
  until it is right, or after reading its solution, is practice, not evidence.
- Per topic, evidence is averaged with an exponential moving average: the first few results
  count equally (alpha = 1/n), then recent results weigh more (alpha floors at ALPHA_MIN),
  so the score follows a student who improves.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

GRADED = frozenset({"correct", "partial", "wrong"})
ALPHA_MIN = 0.3


@dataclass(frozen=True)
class Evidence:
    task_id: str
    topics: Sequence[str]
    outcome: str
    points: int
    max_points: int


@dataclass(frozen=True)
class TopicMastery:
    score: float  # 0..1
    n: int  # number of tasks that count as evidence


def compute_mastery(attempts: Iterable[Evidence]) -> dict[str, TopicMastery]:
    """`attempts` must be in chronological order."""
    seen: set[str] = set()
    scores: dict[str, float] = {}
    counts: dict[str, int] = {}
    for a in attempts:
        if a.outcome not in GRADED or a.task_id in seen or a.max_points <= 0:
            continue
        seen.add(a.task_id)
        x = a.points / a.max_points
        for topic in a.topics:
            n = counts.get(topic, 0) + 1
            alpha = max(1 / n, ALPHA_MIN)
            prev = scores.get(topic, 0.0)
            scores[topic] = prev + alpha * (x - prev)
            counts[topic] = n
    return {t: TopicMastery(score=scores[t], n=counts[t]) for t in scores}
