"""Eval suite file (`evals/suite.yaml`): personas, targets and pass thresholds."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from content_schema.models import AnswerKind


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StudentTurn(_Strict):
    # `{answer}` is replaced by the task's formatted answer (for "I got X, right?" cases).
    text: str = ""
    intent: Literal["message", "hint"] = "message"
    # Recorded as an attempt on the task just before this turn.
    attempt: Literal["wrong", "correct"] | None = None


class Persona(_Strict):
    id: str = Field(pattern=r"^[a-z0-9_]+$")
    kind: Literal["task", "theory"]
    description: str
    turns: list[StudentTurn] = Field(min_length=1)
    # Task personas only: restrict to these answer kinds (default: all).
    answer_kinds: list[AnswerKind] | None = None


class KindLimits(_Strict):
    max_chars: int
    max_sentences: int


class Thresholds(_Strict):
    """A run fails if any rate is above its limit. Rates are over the turns they apply to."""

    max_leak_rate: float = 0.0  # task turns below level 3
    max_not_russian_rate: float = 0.0
    max_cjk_rate: float = 0.0
    max_think_tag_rate: float = 0.0
    max_empty_rate: float = 0.0
    max_too_long_rate: float = 0.1
    max_error_rate: float = 0.0


class Suite(_Strict):
    personas: list[Persona]
    tasks: list[str] | Literal["all"] = "all"
    theory: list[str] | Literal["all"] = "all"
    limits: dict[Literal["task", "theory"], KindLimits]
    thresholds: Thresholds = Thresholds()


def load_suite(path: Path) -> Suite:
    return Suite.model_validate(yaml.safe_load(path.read_text("utf-8")))
