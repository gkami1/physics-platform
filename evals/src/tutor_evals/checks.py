"""Deterministic checks on one tutor reply. Pure; table-tested.

The answer-leak check is not here: it reuses the API's own `LeakDetector`, applied to the
raw model output (before the output guard), so it measures the model, not the guard.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Formulas and code are not prose: Latin letters there are expected.
_MATH = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]|`[^`]*`", re.DOTALL)
_CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
_LATIN = re.compile(r"[a-z]", re.IGNORECASE)
# CJK ideographs, kana, hangul, CJK punctuation: Qwen models sometimes drift into Chinese.
_CJK = re.compile(
    r"[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff"
    r"\uac00-\ud7af\uff00-\uffef]"
)
_THINK_TAG = re.compile(r"</?\s*think\s*>", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[.!?…]+(?=\s|$)")

# A short English gloss is fine; a reply that is mostly English is not.
MIN_CYRILLIC_SHARE = 0.5


def prose(text: str) -> str:
    return _MATH.sub(" ", text)


def cyrillic_share(text: str) -> float | None:
    """Share of Cyrillic among letters outside formulas; None if there are no letters."""
    p = prose(text)
    cyr = len(_CYRILLIC.findall(p))
    total = cyr + len(_LATIN.findall(p))
    return cyr / total if total else None


def sentence_count(text: str) -> int:
    p = prose(text).strip()
    if not p:
        return 0
    # A trailing fragment without a full stop is a sentence too.
    return len(_SENTENCE_END.findall(p)) + (p[-1] not in ".!?…")


@dataclass(frozen=True)
class Limits:
    max_chars: int
    max_sentences: int


@dataclass(frozen=True)
class ReplyChecks:
    empty: bool
    not_russian: bool
    cjk: bool
    think_tag: bool
    too_long: bool
    ends_with_question: bool
    chars: int
    sentences: int

    def failures(self) -> list[str]:
        return [
            name
            for name in ("empty", "not_russian", "cjk", "think_tag", "too_long")
            if getattr(self, name)
        ]


def check_reply(text: str, limits: Limits | None) -> ReplyChecks:
    """`text`: the model's visible output (thinking blocks already removed).
    `limits=None`: no length check (full solutions)."""
    stripped = text.strip()
    share = cyrillic_share(stripped)
    sentences = sentence_count(stripped)
    return ReplyChecks(
        empty=not stripped,
        not_russian=share is not None and share < MIN_CYRILLIC_SHARE,
        cjk=bool(_CJK.search(stripped)),
        think_tag=bool(_THINK_TAG.search(stripped)),
        too_long=limits is not None
        and (len(stripped) > limits.max_chars or sentences > limits.max_sentences),
        ends_with_question=prose(stripped).rstrip().endswith("?"),
        chars=len(stripped),
        sentences=sentences,
    )
