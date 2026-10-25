"""Answer checking for Part 1 tasks. Pure functions, no I/O.

Scoring follows the rule attached to the EGE task number in exam.yaml; the task
file only says what the right answer is.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import StrEnum

from content_schema.models import (
    AnswerSpec,
    ExtendedAnswer,
    MeasurementAnswer,
    NumericAnswer,
    ScoringRule,
    SequenceAnswer,
    TaskNumberSpec,
)


class Outcome(StrEnum):
    CORRECT = "correct"
    PARTIAL = "partial"
    WRONG = "wrong"
    INVALID = "invalid"  # could not parse the input; the student should retry, not lose points


@dataclass(frozen=True)
class Verdict:
    outcome: Outcome
    points: int
    max_points: int
    normalized: str | None = None


class NotAutoCheckableError(ValueError):
    pass


_SPACES = re.compile(r"[\s  ]+")
_POW10 = re.compile(r"^(.+?)[·*×xх]10\^?\(?([+\-−]?\d+)\)?$")


def parse_number(raw: str) -> Decimal | None:
    s = _SPACES.sub("", raw).replace(",", ".").replace("−", "-")
    if not s:
        return None
    exp = 0
    if m := _POW10.match(s):
        s, exp = m.group(1), int(m.group(2).replace("−", "-"))
    if not re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s):
        return None
    try:
        return Decimal(s).scaleb(exp)
    except InvalidOperation:
        return None


def _plain(d: Decimal) -> str:
    return format(d.normalize(), "f")


def _rounded(reference: Decimal, precision: Decimal | None) -> Decimal:
    if precision is None:
        return reference
    return reference.quantize(precision.normalize(), rounding=ROUND_HALF_UP)


def _num_equal(student: Decimal, reference: Decimal, precision: Decimal | None) -> bool:
    return student == _rounded(reference, precision)


def _ru(d: Decimal) -> str:
    return _plain(d).replace(".", ",")


def format_answer(spec: AnswerSpec) -> str | None:
    """The reference answer as a student would write it (Russian decimal comma)."""
    match spec:
        case NumericAnswer():
            s = _ru(_rounded(spec.value, spec.precision))
            return f"{s} {spec.unit}" if spec.unit else s
        case SequenceAnswer():
            return spec.value
        case MeasurementAnswer():
            s = f"({_ru(spec.value)} ± {_ru(spec.error)})"
            return f"{s} {spec.unit}" if spec.unit else s
        case ExtendedAnswer():
            return spec.final


def sequence_errors(student: str, reference: str, *, ordered: bool) -> int:
    if ordered:
        mismatched = sum(a != b for a, b in zip(student, reference, strict=False))
        return mismatched + abs(len(student) - len(reference))
    s, r = Counter(student), Counter(reference)
    missing = sum((r - s).values())
    extra = sum((s - r).values())
    # A wrong digit in place of a right one is one error, not two (FIPI convention).
    return max(missing, extra)


def _score(errors: int, rule: ScoringRule, max_points: int) -> tuple[Outcome, int]:
    if errors == 0:
        return Outcome.CORRECT, max_points
    if rule is ScoringRule.ONE_ERROR_PARTIAL and errors == 1:
        return Outcome.PARTIAL, max_points - 1
    return Outcome.WRONG, 0


def check(spec: AnswerSpec, scoring: TaskNumberSpec, raw: str) -> Verdict:
    mp = scoring.max_points
    match spec:
        case ExtendedAnswer():
            raise NotAutoCheckableError("extended answers are assessed manually")

        case NumericAnswer():
            n = parse_number(raw)
            if n is None:
                return Verdict(Outcome.INVALID, 0, mp)
            ok = _num_equal(n, spec.value, spec.precision)
            outcome, pts = _score(0 if ok else 1, ScoringRule.EXACT, mp)
            return Verdict(outcome, pts, mp, normalized=_plain(n))

        case SequenceAnswer():
            digits = _SPACES.sub("", raw).replace(",", "").replace(";", "")
            if not digits.isdigit() or not digits.isascii():
                return Verdict(Outcome.INVALID, 0, mp)
            errors = sequence_errors(digits, spec.value, ordered=spec.ordered)
            outcome, pts = _score(errors, scoring.scoring, mp)
            return Verdict(outcome, pts, mp, normalized=digits)

        case MeasurementAnswer():
            parts = [p for p in re.split(r"(?:\+/?-|[;±|\s])+", raw.strip()) if p]
            nums = [n for p in parts if (n := parse_number(p)) is not None]
            if len(parts) != 2 or len(nums) != 2:
                return Verdict(Outcome.INVALID, 0, mp)
            value, error = nums
            ok = value == spec.value and error == spec.error
            outcome, pts = _score(0 if ok else 1, ScoringRule.EXACT, mp)
            return Verdict(outcome, pts, mp, normalized=f"{_plain(value)} ± {_plain(error)}")
