"""Answer-leak guard for streamed tutor output. Pure; table-tested.

The model sees the reference solution, so the server, not the prompt, guarantees the
final answer never reaches the student before hint level 3:

- `<think>…</think>` blocks (Qwen3 / reasoning models) are dropped, unclosed ones too.
- Text is released one sentence at a time; each sentence is checked before release.
- On a leak the stream stops; the sentence is never sent.
"""

from __future__ import annotations

import itertools
import re
from collections.abc import Sequence
from decimal import Decimal
from typing import Protocol

from content_schema.checking import parse_number
from content_schema.models import (
    AnswerSpec,
    ExtendedAnswer,
    MeasurementAnswer,
    NumericAnswer,
    SequenceAnswer,
)

_THINK = re.compile(r"<think>.*?(?:</think>|\Z)", re.DOTALL)
# End of a sentence: terminal punctuation followed by whitespace, or a newline.
# "12.5" and "12,5" do not end sentences.
_BOUNDARY = re.compile(r"[.!?…:;](?=\s)|\n")
# LaTeX noise inside numbers: 12{,}5, 2\,500, \text{…} spacing.
_LATEX_NOISE = re.compile(r"\\[,;:! ]|[{}~]")
_POW10 = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:\\cdot|\\times|·|×|\*)\s*10\s*\^\s*\(?([-−]?\d+)\)?")
_NUMBER = re.compile(r"(?<![\d.,])[-−]?\d+(?:[.,]\d+)?(?![\d])")


def visible_text(raw: str) -> str:
    return _THINK.sub("", raw)


def _numbers(text: str) -> set[Decimal]:
    t = _LATEX_NOISE.sub("", text)
    found: set[Decimal] = set()
    for m in _POW10.finditer(t):
        base = parse_number(m.group(1))
        if base is not None:
            found.add(base.scaleb(int(m.group(2).replace("−", "-"))))
    for m in _NUMBER.finditer(t):
        n = parse_number(m.group())
        if n is not None:
            found.add(abs(n))
    return found


def _numeric_targets(spec: AnswerSpec) -> set[Decimal]:
    if isinstance(spec, NumericAnswer):
        targets = {abs(spec.value)}
        if spec.precision is not None:
            targets.add(abs(spec.value.quantize(spec.precision.normalize())))
        return targets
    if isinstance(spec, MeasurementAnswer):
        return {abs(spec.value)}
    if isinstance(spec, ExtendedAnswer) and spec.final:
        return _numbers(spec.final)
    return set()


class LeakDetector:
    """Says whether a piece of text reveals the task's final answer.

    Numbers already present in the statement or in hints the student may see are not
    leaks (the tutor has to be able to quote the given data).
    """

    def __init__(self, spec: AnswerSpec, allowed_text: str = "") -> None:
        allowed = _numbers(allowed_text)
        self._targets = {n for n in _numeric_targets(spec) if n not in allowed and n != 0}
        self._sequences: list[re.Pattern[str]] = []
        if isinstance(spec, SequenceAnswer):
            variants = (
                {spec.value}
                if spec.ordered or len(spec.value) > 4
                else {"".join(p) for p in itertools.permutations(spec.value)}
            )
            # As one token ("13") or spaced/comma-separated digits ("1, 3", "1 и 3").
            for v in variants:
                spaced = r"\s*(?:,|и|;)?\s*".join(v)
                self._sequences.append(re.compile(rf"(?<!\d)(?:{v}|{spaced})(?!\d)"))

    def leaks(self, text: str) -> bool:
        if self._targets and self._targets & _numbers(text):
            return True
        return any(p.search(text) for p in self._sequences)


class Detector(Protocol):
    def leaks(self, text: str) -> bool: ...


class AnyLeak:
    """Leaks if any of its detectors does: a theory page guards every embedded step task."""

    def __init__(self, detectors: Sequence[Detector]) -> None:
        self._detectors = tuple(detectors)

    def leaks(self, text: str) -> bool:
        return any(d.leaks(text) for d in self._detectors)


class OutputGuard:
    """Feed raw model chunks; get back text that is safe to send.

    With `detector=None` (hint level 3, theory pages without step tasks) text is still
    released by sentence, and thinking blocks are still removed.
    """

    def __init__(self, detector: Detector | None) -> None:
        self._detector = detector
        self._raw = ""
        self._released = 0
        self.leaked = False

    def _release(self, upto: int, visible: str) -> str:
        segment = visible[self._released : upto]
        if self._detector is not None and self._detector.leaks(segment):
            self.leaked = True
            return ""
        self._released = upto
        return segment

    def feed(self, chunk: str) -> str:
        if self.leaked:
            return ""
        self._raw += chunk
        visible = visible_text(self._raw)
        # A trailing "<thi" may be the start of a think tag: hold it back.
        if (lt := visible.rfind("<")) != -1 and "<think>".startswith(visible[lt:]):
            visible = visible[:lt]
        out = ""
        for m in _BOUNDARY.finditer(visible, self._released):
            out += self._release(m.end(), visible)
            if self.leaked:
                break
        return out

    def finish(self) -> str:
        if self.leaked:
            return ""
        visible = visible_text(self._raw)
        return self._release(len(visible), visible)

    @property
    def text(self) -> str:
        """Everything released so far."""
        return visible_text(self._raw)[: self._released]
