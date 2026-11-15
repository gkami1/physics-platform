"""Answer checking for Part 1 tasks. Pure functions, no I/O.

Scoring follows the rule attached to the EGE task number in exam.yaml; the task
file only says what the right answer is.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal
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
_DECIMAL = re.compile(r"([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?")
# Far beyond any physical answer (Planck's constant is ~1e-34), and small enough that
# the plain form of the number stays short.
MAX_EXPONENT = 99


def parse_number(raw: str) -> Decimal | None:
    s = _SPACES.sub("", raw).replace(",", ".").replace("−", "-")
    if not s:
        return None
    pow10 = None
    if m := _POW10.match(s):
        s, pow10 = m.group(1), m.group(2)
    if not (m := _DECIMAL.fullmatch(s)):
        return None
    e1, e2 = _exponent(pow10), _exponent(m.group(2))
    if e1 is None or e2 is None or abs(e1 + e2) > MAX_EXPONENT:
        return None
    # The constructor is exact; scaleb() would round to the context's 28 digits.
    return Decimal(f"{m.group(1)}E{e1 + e2}")


def _exponent(s: str | None) -> int | None:
    """The exponent (0 if absent), or None if it is beyond ±MAX_EXPONENT."""
    if s is None:
        return 0
    if len(s.lstrip("+-").lstrip("0")) > len(str(MAX_EXPONENT)):  # int() of huge strings is slow
        return None
    n = int(s)
    return n if abs(n) <= MAX_EXPONENT else None


def _plain(d: Decimal) -> str:
    # normalize() rounds to the context precision; give it exactly enough digits.
    exact = Context(prec=max(len(d.as_tuple().digits), 1))
    return format(d.normalize(exact), "f")


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


def _unwrap(raw: str) -> str:
    """Drop the parentheses of "(2,4 ± 0,2)", the form format_answer() shows on reveal."""
    s = raw.strip()
    return s[1:-1] if s.startswith("(") and s.endswith(")") else s


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
            parts = [p for p in re.split(r"(?:\+/?-|[;±|\s])+", _unwrap(raw)) if p]
            nums = [n for p in parts if (n := parse_number(p)) is not None]
            if len(parts) != 2 or len(nums) != 2:
                return Verdict(Outcome.INVALID, 0, mp)
            value, error = nums
            ok = value == spec.value and error == spec.error
            outcome, pts = _score(0 if ok else 1, ScoringRule.EXACT, mp)
            return Verdict(outcome, pts, mp, normalized=f"{_plain(value)} ± {_plain(error)}")
