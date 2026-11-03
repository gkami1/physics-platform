"""Split validated content into a public bundle (for the static site) and a private
bundle (for the API database). Anything not explicitly listed in `public_task` is private.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from content_schema.figures import inline_svg_images
from content_schema.loader import ContentBundle
from content_schema.models import (
    ExtendedAnswer,
    MeasurementAnswer,
    NumericAnswer,
    Task,
    embedded_task_ids,
)


def content_version(root: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        h.update(f.relative_to(root).as_posix().encode())
        h.update(b"\0")
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def public_task(t: Task) -> dict[str, Any]:
    a = t.meta.answer
    unit = a.unit if isinstance(a, NumericAnswer | MeasurementAnswer) else None
    return {
        "id": t.meta.id,
        "ege_task": t.meta.ege_task,
        "topics": t.meta.topics,
        "difficulty": t.meta.difficulty,
        "status": t.meta.status,
        "statement": t.statement,
        "answer_input": {"type": a.type, "unit": unit},
        "hint_count": len(t.meta.hints),
    }


def private_task(t: Task) -> dict[str, Any]:
    return {
        "id": t.meta.id,
        "ege_task": t.meta.ege_task,
        "topics": t.meta.topics,
        "statement": t.statement,
        "answer": t.meta.answer.model_dump(mode="json"),
        "solution": t.solution,
        "hints": t.meta.hints,
        "tutor_notes": t.meta.tutor_notes,
        "source": t.meta.source.model_dump(mode="json"),
    }


def leak_needles(t: Task) -> list[str]:
    """Strings that must never appear in public output for this task."""
    needles = [t.solution.strip(), *t.meta.hints]
    if t.meta.tutor_notes:
        needles.append(t.meta.tutor_notes)
    a = t.meta.answer
    if isinstance(a, ExtendedAnswer) and a.final:
        needles.append(a.final)
    return [n for n in needles if len(n) >= 8]  # short answers ("13") collide with statements


def with_inline_figures(t: Task, root: Path) -> Task:
    """Statement and solution with local SVG images inlined, so figures follow the theme."""
    base = (root / t.path).parent
    return t.model_copy(
        update={
            "statement": inline_svg_images(t.statement, base),
            "solution": inline_svg_images(t.solution, base),
        }
    )


def build(bundle: ContentBundle, out: Path) -> str:
    version = content_version(bundle.root)
    tasks = [with_inline_figures(t, bundle.root) for t in bundle.tasks]
    exam_public = bundle.exam.model_dump(mode="json")
    roadmap = bundle.roadmap.model_dump(mode="json")
    theory_index = [
        {
            "topic": p.topic,
            "title": p.title,
            "status": p.status,
            "path": p.path,
            "tasks": embedded_task_ids(p.body),
        }
        for p in bundle.theory
    ]

    public = {
        "content_version": version,
        "exam": exam_public,
        "roadmap": roadmap,
        "theory": theory_index,
        "tasks": [public_task(t) for t in tasks],
    }
    private = {
        "content_version": version,
        "exam": exam_public,
        "tasks": [private_task(t) for t in tasks],
        # Tutor context for theory pages (the text itself is public).
        "theory": [{"topic": p.topic, "title": p.title, "body": p.body} for p in bundle.theory],
    }

    public_text = json.dumps(public, ensure_ascii=False, indent=1)
    for t in tasks:
        for needle in leak_needles(t):
            if needle in public_text:
                raise AssertionError(
                    f"private content of task {t.meta.id} leaked into public build"
                )

    for sub, data in (("public", public), ("private", private)):
        d = out / sub
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{bundle.exam.id}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return version
