"""Load an exam content directory and validate it as a whole.

Errors are collected rather than raised one at a time so the author sees every
problem in a single `content-build validate` run.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from content_schema.figures import generate as generate_figures
from content_schema.models import (
    SOLUTION_HEADING,
    STEP_HEADING,
    STEPS_DIR,
    TASK_EMBED_LOOSE,
    AnswerKind,
    ExamSpec,
    Roadmap,
    Task,
    TaskMeta,
    TheoryPage,
    embedded_task_ids,
)

# "\frac" in double-quoted YAML becomes a form feed, "\theta" a tab, "\nu" a newline.
YAML_EATEN_BACKSLASH = re.compile(r"[\x00-\x1f]")
IMAGE_REF = r"!\[[^\]]*\]\(([^)\s]+)"


@dataclass
class ContentBundle:
    root: Path
    exam: ExamSpec
    roadmap: Roadmap
    theory: list[TheoryPage]
    tasks: list[Task]


@dataclass
class LoadResult:
    bundle: ContentBundle | None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.bundle is not None and not self.errors


class FrontmatterError(ValueError):
    pass


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    text = text.lstrip("﻿")
    if not text.startswith("---"):
        raise FrontmatterError("file must start with a '---' YAML frontmatter block")
    parts = text.split("\n---", 2)
    if len(parts) < 2:
        raise FrontmatterError("unterminated frontmatter block")
    meta = yaml.safe_load(parts[0][3:]) or {}
    if not isinstance(meta, dict):
        raise FrontmatterError("frontmatter must be a mapping")
    body = parts[1].split("\n", 1)[1] if "\n" in parts[1] else ""
    return meta, body.strip("\n") + "\n"


def _fmt(e: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(map(str, err['loc'])) or '<root>'}: {err['msg']}" for err in e.errors()
    )


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_exam_dir(root: Path) -> LoadResult:
    res = LoadResult(bundle=None)
    try:
        exam = ExamSpec.model_validate(_load_yaml(root / "exam.yaml"))
        roadmap = Roadmap.model_validate(_load_yaml(root / "roadmap.yaml"))
    except FileNotFoundError as e:
        res.errors.append(f"missing file: {e.filename}")
        return res
    except ValidationError as e:
        res.errors.append(f"exam.yaml/roadmap.yaml: {_fmt(e)}")
        return res

    theory = [p for p in (_load_theory(f, root, res) for f in _md_files(root / "theory")) if p]
    tasks = [t for t in (_load_task(f, root, res) for f in _md_files(root / "tasks")) if t]

    bundle = ContentBundle(root=root, exam=exam, roadmap=roadmap, theory=theory, tasks=tasks)
    _cross_validate(bundle, res)
    _check_figures(root, res)
    res.bundle = bundle
    return res


def _md_files(d: Path) -> list[Path]:
    return sorted(d.rglob("*.md")) if d.exists() else []


def _load_theory(path: Path, root: Path, res: LoadResult) -> TheoryPage | None:
    rel = _rel(path, root)
    try:
        meta, body = split_frontmatter(path.read_text(encoding="utf-8"))
        page = TheoryPage.model_validate({**meta, "body": body, "path": rel})
    except (FrontmatterError, yaml.YAMLError) as e:
        res.errors.append(f"{rel}: {e}")
        return None
    except ValidationError as e:
        res.errors.append(f"{rel}: {_fmt(e)}")
        return None
    if path.stem != page.topic:
        res.errors.append(f"{rel}: file name must equal topic id '{page.topic}'")
    return page


def _load_task(path: Path, root: Path, res: LoadResult) -> Task | None:
    rel = _rel(path, root)
    try:
        meta_raw, body = split_frontmatter(path.read_text(encoding="utf-8"))
        meta = TaskMeta.model_validate(meta_raw)
    except (FrontmatterError, yaml.YAMLError) as e:
        res.errors.append(f"{rel}: {e}")
        return None
    except ValidationError as e:
        res.errors.append(f"{rel}: {_fmt(e)}")
        return None

    for i, text in enumerate([*meta.hints, meta.tutor_notes or ""]):
        if YAML_EATEN_BACKSLASH.search(text):
            res.errors.append(
                f"{rel}: frontmatter text #{i} contains a control character — a LaTeX backslash "
                "was probably eaten by YAML double quotes; use single quotes for LaTeX"
            )

    if path.stem != meta.id:
        res.errors.append(f"{rel}: file name must equal task id '{meta.id}'")
    folder = STEPS_DIR if meta.ege_task is None else str(meta.ege_task)
    if path.parent.name != folder:
        res.errors.append(f"{rel}: task with ege_task={meta.ege_task} must live in tasks/{folder}/")

    found = list(SOLUTION_HEADING.finditer(body))
    if len(found) != 1:
        res.errors.append(f"{rel}: expected exactly one '## Решение' heading, found {len(found)}")
        return None
    statement = body[: found[0].start()].strip() + "\n"
    solution = body[found[0].end() :].strip() + "\n"
    if not statement.strip() or not solution.strip():
        res.errors.append(f"{rel}: statement and solution must both be non-empty")
        return None
    return Task(meta=meta, statement=statement, solution=solution, path=rel)


def _cross_validate(b: ContentBundle, res: LoadResult) -> None:
    if not b.exam.verified:
        res.warnings.append(
            "exam.yaml: verified=false — check per-task points against the approved FIPI spec"
        )

    topics = b.roadmap.topics()
    topic_ids = [t.id for t in topics]
    seen: set[str] = set()
    for tid in topic_ids:
        if tid in seen:
            res.errors.append(f"roadmap.yaml: duplicate topic id '{tid}'")
        seen.add(tid)

    for t in topics:
        for p in t.prereqs:
            if p not in seen:
                res.errors.append(f"roadmap.yaml: topic '{t.id}' has unknown prereq '{p}'")
        for n in t.ege_tasks:
            if n not in b.exam.tasks:
                res.errors.append(f"roadmap.yaml: topic '{t.id}' references unknown EGE task {n}")
    if cycle := _find_cycle({t.id: t.prereqs for t in topics}):
        res.errors.append(f"roadmap.yaml: prerequisite cycle {' -> '.join(cycle)}")

    theory_topics: set[str] = set()
    for page in b.theory:
        if page.topic not in seen:
            res.errors.append(f"{page.path}: unknown topic '{page.topic}'")
        if page.topic in theory_topics:
            res.errors.append(f"{page.path}: second theory page for topic '{page.topic}'")
        theory_topics.add(page.topic)

    task_ids: set[str] = set()
    for task in b.tasks:
        m = task.meta
        if m.id in task_ids:
            res.errors.append(f"{task.path}: duplicate task id '{m.id}'")
        task_ids.add(m.id)
        for tp in m.topics:
            if tp not in seen:
                res.errors.append(f"{task.path}: unknown topic '{tp}'")
        spec = b.exam.spec_for(m.ege_task)
        what = (
            "step tasks (exam.yaml: practice)" if m.ege_task is None else f"EGE task {m.ege_task}"
        )
        if spec is None:
            res.errors.append(f"{task.path}: {what} not in exam.yaml")
            continue
        if AnswerKind(m.answer.type) is not spec.answer_kind:
            res.errors.append(
                f"{task.path}: {what} expects answer type "
                f"'{spec.answer_kind}', got '{m.answer.type}'"
            )

    _check_embeds(b, res)
    _check_steps(b, res)

    for doc, path in [(p.body, p.path) for p in b.theory] + [
        (t.statement + t.solution, t.path) for t in b.tasks
    ]:
        for ref in re.findall(IMAGE_REF, doc):
            if ref.startswith(("http://", "https://")):
                res.errors.append(f"{path}: external image '{ref}' — put it in assets/")
            elif not ((b.root / path).parent / ref).resolve().exists():
                res.errors.append(f"{path}: missing image '{ref}'")


def _check_embeds(b: ContentBundle, res: LoadResult) -> None:
    """Tasks embedded in theory pages exist, belong to the page's topic, appear once;
    every step task is embedded somewhere (it has no other way in from the roadmap)."""
    tasks = {t.meta.id: t for t in b.tasks}
    where: dict[str, str] = {}
    for page in b.theory:
        ids = embedded_task_ids(page.body)
        if len(TASK_EMBED_LOOSE.findall(page.body)) != len(ids):
            res.errors.append(
                f'{page.path}: write task embeds alone on a line as <pp-task id="..."></pp-task>'
            )
        for tid in ids:
            task = tasks.get(tid)
            if task is None:
                res.errors.append(f"{page.path}: embeds unknown task '{tid}'")
                continue
            if tid in where:
                res.errors.append(f"{page.path}: task '{tid}' is already embedded in {where[tid]}")
            where[tid] = page.path
            if page.topic not in task.meta.topics:
                res.errors.append(
                    f"{page.path}: embedded task '{tid}' is not tagged with topic '{page.topic}'"
                )
    for t in b.tasks:
        if t.meta.ege_task is None and t.meta.id not in where:
            res.errors.append(f"{t.path}: step task is not embedded in any theory page")


def _check_steps(b: ContentBundle, res: LoadResult) -> None:
    """Ladder pages: steps numbered 1..N, each with a grade 7–11 that never goes down."""
    for page in b.theory:
        steps = STEP_HEADING.findall(page.body)
        last = 0
        for i, (n, lo, hi) in enumerate(steps, start=1):
            where = f"{page.path}: «Шаг {n}»"
            if int(n) != i:
                res.errors.append(f"{where} should be «Шаг {i}» (steps are numbered in order)")
            if not lo:
                res.errors.append(f"{where} needs a grade, e.g. «(9 класс)», at the end")
                continue
            low, high = int(lo), int(hi or lo)
            if not 7 <= low <= high <= 11:
                res.errors.append(f"{where}: grade must be within 7–11")
            if low < last:
                res.errors.append(f"{where}: grade goes down from {last} to {low}")
            last = low


def _check_figures(root: Path, res: LoadResult) -> None:
    try:
        stale = generate_figures(root, check=True)
    except (ValidationError, yaml.YAMLError) as e:
        msg = _fmt(e) if isinstance(e, ValidationError) else str(e)
        res.errors.append(f"figures/: {msg}")
        return
    for name in stale:
        res.errors.append(
            f"assets/{name} is out of date with its spec in figures/ — run `content-build figures`"
        )


def _find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    white, grey, black = 0, 1, 2
    color = dict.fromkeys(graph, white)
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        color[n] = grey
        stack.append(n)
        for m in graph.get(n, []):
            if color.get(m) == grey:
                return [*stack[stack.index(m) :], m]
            if color.get(m) == white and (c := visit(m)):
                return c
        stack.pop()
        color[n] = black
        return None

    for n in graph:
        if color[n] == white and (c := visit(n)):
            return c
    return None
