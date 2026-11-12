from decimal import Decimal

import pytest

from content_schema.checking import (
    NotAutoCheckableError,
    Outcome,
    check,
    parse_number,
    sequence_errors,
)
from content_schema.models import (
    ExtendedAnswer,
    MeasurementAnswer,
    NumericAnswer,
    ScoringRule,
    SequenceAnswer,
    TaskNumberSpec,
)

EXACT = TaskNumberSpec(
    part=1, answer_kind="numeric", max_points=1, scoring=ScoringRule.EXACT, title="t"
)
SEQ2 = TaskNumberSpec(
    part=1, answer_kind="sequence", max_points=2, scoring=ScoringRule.ONE_ERROR_PARTIAL, title="t"
)
SEQ1 = TaskNumberSpec(
    part=1, answer_kind="sequence", max_points=1, scoring=ScoringRule.EXACT, title="t"
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("12.5", "12.5"),
        ("12,5", "12.5"),
        (" 1 200 ", "1200"),
        ("-3", "-3"),
        ("−3", "-3"),
        ("2e-3", "0.002"),
        ("2·10^-3", "0.002"),
        ("2*10^(-3)", "0.002"),
        ("1,5×10^6", "1500000"),
        (".5", "0.5"),
        ("", None),
        ("abc", None),
        ("1.2.3", None),
        ("12 м/с", None),
    ],
)
def test_parse_number(raw: str, expected: str | None) -> None:
    n = parse_number(raw)
    assert (None if n is None else n) == (None if expected is None else Decimal(expected))


@pytest.mark.parametrize(
    ("value", "precision", "raw", "outcome"),
    [
        (12.5, None, "12,5", Outcome.CORRECT),
        (12.5, None, "12.50", Outcome.CORRECT),
        (12.5, None, "12.4", Outcome.WRONG),
        (4.134, 0.1, "4,1", Outcome.CORRECT),
        (4.15, 0.1, "4.2", Outcome.CORRECT),  # half-up, not banker's rounding
        (4.134, 0.1, "4.13", Outcome.WRONG),  # wrong rounding is a wrong answer in EGE
        (1234, 10, "1230", Outcome.CORRECT),
        (0.1, None, "0,1", Outcome.CORRECT),  # no float artefacts
        (3, None, "три", Outcome.INVALID),
    ],
)
def test_numeric(value: float, precision: float | None, raw: str, outcome: Outcome) -> None:
    spec = NumericAnswer.model_validate({"type": "numeric", "value": value, "precision": precision})
    v = check(spec, EXACT, raw)
    assert v.outcome is outcome
    assert v.points == (1 if outcome is Outcome.CORRECT else 0)


def test_precision_must_be_power_of_ten() -> None:
    with pytest.raises(ValueError, match="power of ten"):
        NumericAnswer.model_validate({"type": "numeric", "value": 1, "precision": 0.5})


@pytest.mark.parametrize(
    ("student", "reference", "ordered", "errors"),
    [
        ("13", "13", False, 0),
        ("31", "13", False, 0),
        ("14", "13", False, 1),  # one wrong digit = one error
        ("1", "13", False, 1),  # one missing
        ("134", "13", False, 1),  # one extra
        ("45", "13", False, 2),
        # «Выберите все верные утверждения» (2026 spec): two or three true, any order;
        # one wrong, one extra or one missing digit is one error.
        ("531", "135", False, 0),
        ("13", "135", False, 1),  # one missing of three
        ("134", "135", False, 1),  # one wrong of three
        ("1345", "135", False, 1),  # one extra beside all three
        ("1", "135", False, 2),  # two missing
        ("1245", "135", False, 2),
        ("135", "35", False, 1),  # an extra third digit on a two-digit answer
        ("13", "13", True, 0),
        ("31", "13", True, 2),
        ("12", "13", True, 1),
        ("1", "13", True, 1),
        ("2143", "2133", True, 1),
    ],
)
def test_sequence_errors(student: str, reference: str, ordered: bool, errors: int) -> None:
    assert sequence_errors(student, reference, ordered=ordered) == errors


@pytest.mark.parametrize(
    ("raw", "scoring", "outcome", "points"),
    [
        ("31", SEQ2, Outcome.CORRECT, 2),
        ("3 1", SEQ2, Outcome.CORRECT, 2),
        ("1,3", SEQ2, Outcome.CORRECT, 2),
        ("14", SEQ2, Outcome.PARTIAL, 1),
        ("45", SEQ2, Outcome.WRONG, 0),
        ("14", SEQ1, Outcome.WRONG, 0),
        ("1a", SEQ2, Outcome.INVALID, 0),
        ("１３", SEQ2, Outcome.INVALID, 0),  # full-width digits
    ],
)
def test_sequence_scoring(raw: str, scoring: TaskNumberSpec, outcome: Outcome, points: int) -> None:
    spec = SequenceAnswer(type="sequence", value="13", ordered=False)
    v = check(spec, scoring, raw)
    assert (v.outcome, v.points) == (outcome, points)


@pytest.mark.parametrize(
    ("raw", "outcome"),
    [
        ("2,4 0,2", Outcome.CORRECT),
        ("2.4±0.2", Outcome.CORRECT),
        ("2,4; 0,2", Outcome.CORRECT),
        ("2.4 +- 0.2", Outcome.CORRECT),
        ("2.4 +/- 0.2", Outcome.CORRECT),
        ("2,4 0,2 0,1", Outcome.INVALID),
        ("2,4 0,1", Outcome.WRONG),
        ("2,4", Outcome.INVALID),
    ],
)
def test_measurement(raw: str, outcome: Outcome) -> None:
    spec = MeasurementAnswer.model_validate({"type": "measurement", "value": 2.4, "error": 0.2})
    assert check(spec, EXACT, raw).outcome is outcome


def test_extended_is_not_auto_checkable() -> None:
    with pytest.raises(NotAutoCheckableError):
        check(ExtendedAnswer(type="extended"), EXACT, "anything")


@pytest.mark.parametrize(
    ("spec", "expected"),
    [
        ({"type": "numeric", "value": 12.5, "unit": "м/с"}, "12,5 м/с"),
        ({"type": "numeric", "value": 4.134, "precision": 0.1}, "4,1"),
        ({"type": "numeric", "value": 1234, "precision": 10}, "1230"),
        ({"type": "sequence", "value": "13", "ordered": False}, "13"),
        ({"type": "measurement", "value": 2.4, "error": 0.2, "unit": "Н"}, "(2,4 ± 0,2) Н"),
        ({"type": "extended", "final": "≈ 4,1 м/с"}, "≈ 4,1 м/с"),
        ({"type": "extended"}, None),
    ],
)
def test_format_answer(spec: dict[str, object], expected: str | None) -> None:
    from pydantic import TypeAdapter

    from content_schema.checking import format_answer
    from content_schema.models import AnswerSpec

    assert format_answer(TypeAdapter(AnswerSpec).validate_python(spec)) == expected
