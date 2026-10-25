"""Pydantic models for authored content.

Field names here are the content file format: renaming one is a breaking change
for every file in `content/`.
"""

from __future__ import annotations

import re
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ID_PATTERN = r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$"
Id = Annotated[str, Field(pattern=ID_PATTERN, max_length=80)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _to_decimal(v: Any) -> Any:
    # YAML gives floats; going through str keeps "0.1" as 0.1, not 0.1000000000000000055.
    if isinstance(v, float | int) and not isinstance(v, bool):
        return Decimal(str(v))
    return v


def _is_power_of_ten(d: Decimal) -> bool:
    return d > 0 and d.normalize().as_tuple().digits == (1,)


# --- exam structure -------------------------------------------------------------------------


class AnswerKind(StrEnum):
    NUMERIC = "numeric"
    SEQUENCE = "sequence"
    MEASUREMENT = "measurement"
    EXTENDED = "extended"


class ScoringRule(StrEnum):
    EXACT = "exact"  # all or nothing
    ONE_ERROR_PARTIAL = "one_error_partial"  # max points, one less for exactly one error
    MANUAL = "manual"  # Part 2: expert / self assessment


class TaskNumberSpec(Strict):
    part: Literal[1, 2]
    answer_kind: AnswerKind
    max_points: int = Field(ge=1, le=10)
    scoring: ScoringRule
    title: str

    @model_validator(mode="after")
    def _consistent(self) -> TaskNumberSpec:
        if (self.answer_kind is AnswerKind.EXTENDED) != (self.scoring is ScoringRule.MANUAL):
            raise ValueError("extended answers must use manual scoring and vice versa")
        if self.scoring is ScoringRule.ONE_ERROR_PARTIAL and self.max_points < 2:
            raise ValueError("one_error_partial needs max_points >= 2")
        if self.scoring is ScoringRule.EXACT and self.max_points != 1:
            raise ValueError("exact scoring is worth 1 point")
        return self


class ExamSpec(Strict):
    id: Id
    title: str
    locale: str
    season: int
    verified: bool  # True once points were checked against the approved FIPI specification
    source: str
    tasks: dict[int, TaskNumberSpec]

    @property
    def max_score(self) -> int:
        return sum(t.max_points for t in self.tasks.values())


# --- roadmap --------------------------------------------------------------------------------


class Topic(Strict):
    id: Id
    title: str
    codifier: list[str] = Field(default_factory=list)
    prereqs: list[Id] = Field(default_factory=list)
    ege_tasks: list[int] = Field(default_factory=list)


class Section(Strict):
    id: Id
    title: str
    topics: list[Topic]


class Roadmap(Strict):
    sections: list[Section]

    def topics(self) -> list[Topic]:
        return [t for s in self.sections for t in s.topics]


# --- answers --------------------------------------------------------------------------------


class NumericAnswer(Strict):
    type: Literal["numeric"]
    value: Decimal
    unit: str | None = None
    # Answer must equal `value` rounded to this step (EGE convention). None = exact.
    precision: Decimal | None = None

    _dec = field_validator("value", "precision", mode="before")(_to_decimal)

    @field_validator("precision")
    @classmethod
    def _pow10(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and not _is_power_of_ten(v):
            raise ValueError("precision must be a power of ten, e.g. 0.1, 1, 10")
        return v


class SequenceAnswer(Strict):
    type: Literal["sequence"]
    value: Annotated[str, Field(pattern=r"^[0-9]+$")]
    ordered: bool


class MeasurementAnswer(Strict):
    """Instrument reading with its uncertainty, e.g. (2.4 ± 0.2)."""

    type: Literal["measurement"]
    value: Decimal
    error: Decimal
    unit: str | None = None

    _dec = field_validator("value", "error", mode="before")(_to_decimal)


class ExtendedAnswer(Strict):
    type: Literal["extended"]
    # Final result, if any: shown after self-assessment and used by the tutor leak filter.
    final: str | None = None


AnswerSpec = Annotated[
    NumericAnswer | SequenceAnswer | MeasurementAnswer | ExtendedAnswer,
    Field(discriminator="type"),
]


# --- tasks and theory -----------------------------------------------------------------------


class SourceKind(StrEnum):
    ORIGINAL = "original"
    ADAPTED = "adapted"
    FIPI_BANK = "fipi-bank"
    BOOK = "book"


class Source(Strict):
    kind: SourceKind
    ref: str | None = None

    @model_validator(mode="after")
    def _ref_required(self) -> Source:
        if self.kind is not SourceKind.ORIGINAL and not self.ref:
            raise ValueError(f"source.ref is required for kind={self.kind}")
        return self


class TaskMeta(Strict):
    """Frontmatter of a task file."""

    id: Id
    ege_task: int
    topics: list[Id] = Field(min_length=1)
    difficulty: int = Field(ge=1, le=5)
    answer: AnswerSpec
    source: Source
    hints: list[str] = Field(default_factory=list, max_length=5)
    tutor_notes: str | None = None  # private guidance for the tutor (common mistakes etc.)
    status: Literal["draft", "published"] = "draft"


SOLUTION_HEADING = re.compile(r"^##\s+Решение\s*$", re.MULTILINE)


class Task(Strict):
    meta: TaskMeta
    statement: str  # Markdown, public
    solution: str  # Markdown, private
    path: str


class TheoryPage(Strict):
    topic: Id
    title: str
    status: Literal["draft", "published"] = "draft"
    body: str
    path: str
