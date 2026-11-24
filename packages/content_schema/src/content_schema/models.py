"""Pydantic models for authored content.

Field names here are the content file format: renaming one is a breaking change
for every file in `content/`.
"""

from __future__ import annotations

import itertools
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
    # Exam length, for timed variants (to verify with `verified`).
    duration_minutes: int = Field(gt=0)
    tasks: dict[int, TaskNumberSpec]
    # Step tasks embedded in theory pages: not an exam task number, never in variants.
    practice: TaskNumberSpec | None = None
    # Official primary -> test (100-point) score conversion, for the predicted score. Only
    # values copied from a published Rosobrnadzor table; absent until one is verified.
    score_scale: dict[int, int] | None = None
    score_scale_source: str | None = None  # document, year and where it was published
    score_scale_season: int | None = None  # the exam year the table was published for

    @property
    def max_score(self) -> int:
        return sum(t.max_points for t in self.tasks.values())

    @model_validator(mode="after")
    def _scale_is_complete(self) -> ExamSpec:
        scale = self.score_scale
        if scale is None:
            if self.score_scale_source is not None or self.score_scale_season is not None:
                raise ValueError("score_scale_source/season given without score_scale")
            return self
        if not self.score_scale_source or self.score_scale_season is None:
            raise ValueError("score_scale needs score_scale_source and score_scale_season")
        if sorted(scale) != list(range(self.max_score + 1)):
            raise ValueError(f"score_scale must list every primary score 0..{self.max_score}")
        values = [scale[p] for p in range(self.max_score + 1)]
        if any(not 0 <= v <= 100 for v in values):
            raise ValueError("score_scale test scores must be within 0..100")
        if any(b < a for a, b in itertools.pairwise(values)):
            raise ValueError("score_scale must not decrease")
        return self

    def spec_for(self, ege_task: int | None) -> TaskNumberSpec | None:
        """Scoring for a task: its EGE number's spec, or `practice` for step tasks."""
        return self.practice if ege_task is None else self.tasks.get(ege_task)


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

    def topic_numbers(self) -> dict[str, int]:
        """A topic's position within its section, from 1: lesson 1.2 is topic 1, lesson 2."""
        return {t.id: i for s in self.sections for i, t in enumerate(s.topics, start=1)}


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
    # None = a step task for a theory page (lives in tasks/steps/, scored by exam.practice).
    ege_task: int | None = None
    topics: list[Id] = Field(min_length=1)
    difficulty: int = Field(ge=1, le=5)
    answer: AnswerSpec
    source: Source
    hints: list[str] = Field(default_factory=list, max_length=5)
    tutor_notes: str | None = None  # private guidance for the tutor (common mistakes etc.)
    status: Literal["draft", "published"] = "draft"
    # The last exam season whose plan this task's number still fits (e.g. 2026 for a
    # thermodynamics №23 once the 2027 plan made №23 molecular physics only). In later
    # seasons the task stays for topic practice but leaves variants and its number's list.
    last_season: int | None = Field(default=None, ge=2000, le=2100)

    @model_validator(mode="after")
    def _season_needs_number(self) -> TaskMeta:
        if self.last_season is not None and self.ege_task is None:
            raise ValueError("last_season applies only to tasks with an ege_task")
        return self

    def in_season(self, season: int) -> bool:
        """Whether this task counts as its EGE number in the given exam season."""
        if self.ege_task is None:
            return False
        return self.last_season is None or season <= self.last_season


SOLUTION_HEADING = re.compile(r"^##\s+Решение\s*$", re.MULTILINE)

# A task embedded in a theory page, on its own line: `<pp-task id="kin-s-0001"></pp-task>`.
# The site renders the statement and an answer form in its place (web/markdown.config.mjs).
TASK_EMBED = re.compile(r'^<pp-task id="([^"]+)"></pp-task>$', re.MULTILINE)
TASK_EMBED_LOOSE = re.compile(r"<pp-task\b")

# A ladder step heading: `## Шаг 3. Ускорение — вектор (9 класс)` or `(9–10 класс)`.
# The site turns the grade into a badge (web/markdown.config.mjs).
STEP_HEADING = re.compile(
    r"^## Шаг (\d+)\.\s.*?(?:\s\((\d{1,2})(?:–(\d{1,2}))? класс\))?\s*$", re.M
)

STEPS_DIR = "steps"  # tasks/steps/: step tasks without an EGE number


def embedded_task_ids(markdown: str) -> list[str]:
    return TASK_EMBED.findall(markdown)


class Task(Strict):
    meta: TaskMeta
    statement: str  # Markdown, public
    solution: str  # Markdown, private
    path: str


# A lesson file inside a topic folder: `theory/<topic>/01-motion-si.md` (order 1, slug
# motion-si). The folder's `_topic.md` is the topic page: an intro above the lesson list.
LESSON_FILE = re.compile(r"^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$")
TOPIC_INTRO = "_topic"

Grade = Annotated[str, Field(pattern=r"^\d{1,2}(?:–\d{1,2})?$")]


class TheoryPage(Strict):
    """A theory page. `kind`: `page` — a whole topic in one file, written as a ladder of
    «Шаг N» sections; `intro` — a topic split into lessons, shown above their list;
    `lesson` — one lesson of such a topic. The loader fills kind, lesson and order."""

    topic: Id
    title: str
    status: Literal["draft", "published"] = "draft"
    # Lessons only: school grade(s) the lesson's material belongs to, e.g. 7 or '7–8',
    # and a one-line «what you'll learn» for the topic page's lesson list.
    grade: Grade | None = None
    summary: str | None = None
    body: str
    path: str
    kind: Literal["page", "intro", "lesson"] = "page"
    lesson: str | None = None  # slug
    order: int = 0

    @field_validator("grade", mode="before")
    @classmethod
    def _grade_str(cls, v: Any) -> Any:
        return str(v) if isinstance(v, int) and not isinstance(v, bool) else v

    @property
    def id(self) -> str:
        """`mech.kinematics.basics/motion-si` for a lesson; the topic id otherwise."""
        return f"{self.topic}/{self.lesson}" if self.lesson else self.topic

    def grades(self) -> tuple[int, int] | None:
        if self.grade is None:
            return None
        lo, _, hi = self.grade.partition("–")
        return int(lo), int(hi or lo)


# --- formulas («Блиц») ----------------------------------------------------------------------

# Characters an `ask` line may hold (syntax in content/<exam>/formulas.yaml and
# web/src/lib/blitz/expr.ts, which parses and checks it; the web tests parse every line).
FORMULA_CHARS = re.compile(r"^[\w\s+\-*/^()=.{}·π]+$")


def _formula_side(v: str) -> str:
    if not FORMULA_CHARS.match(v):
        raise ValueError(f"unexpected character in «{v}»")
    depth = 0
    for c in v:
        depth += {"(": 1, ")": -1}.get(c, 0)
        if depth < 0:
            break
    if depth != 0:
        raise ValueError(f"unbalanced parentheses in «{v}»")
    return v


class Formula(Strict):
    """A formula for the blitz game: the player sees `title` and the left side of `ask`
    and types the right side; `also` holds other right sides that count as correct."""

    grade: int = Field(ge=7, le=11)
    title: str = Field(min_length=1)
    ask: str
    also: list[str] = Field(default_factory=list)

    @field_validator("ask")
    @classmethod
    def _ask(cls, v: str) -> str:
        if v.count("=") != 1:
            raise ValueError(f"«{v}»: exactly one «=» expected")
        lhs, rhs = v.split("=")
        if not lhs.strip() or not rhs.strip():
            raise ValueError(f"«{v}»: both sides must be non-empty")
        return _formula_side(v)

    @field_validator("also")
    @classmethod
    def _also(cls, v: list[str]) -> list[str]:
        for s in v:
            if "=" in s:
                raise ValueError(f"«{s}»: `also` holds right sides only")
            _formula_side(s)
        return v


class FormulaBank(Strict):
    """`formulas.yaml`: roadmap topic id → its formulas, in the order they are taught."""

    topics: dict[Id, list[Formula]]
