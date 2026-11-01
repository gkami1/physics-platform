"""Loader validation, the real content tree, and the no-leak invariant."""

import json
import shutil
from pathlib import Path

import pytest

from content_schema.build import build, leak_needles
from content_schema.cli import main
from content_schema.loader import load_exam_dir, split_frontmatter

REPO = Path(__file__).resolve().parents[3]
CONTENT = REPO / "content"


def exam_dirs() -> list[Path]:
    return sorted(p.parent for p in CONTENT.glob("*/exam.yaml"))


@pytest.mark.parametrize("exam_dir", exam_dirs(), ids=lambda p: p.name)
def test_repo_content_is_valid(exam_dir: Path) -> None:
    res = load_exam_dir(exam_dir)
    assert res.errors == []


@pytest.mark.parametrize("exam_dir", exam_dirs(), ids=lambda p: p.name)
def test_exam_max_score(exam_dir: Path) -> None:
    res = load_exam_dir(exam_dir)
    assert res.bundle is not None
    if res.bundle.exam.id == "ege-physics":
        assert res.bundle.exam.max_score == 45


@pytest.mark.parametrize("exam_dir", exam_dirs(), ids=lambda p: p.name)
def test_public_build_has_no_private_fields(exam_dir: Path, tmp_path: Path) -> None:
    res = load_exam_dir(exam_dir)
    assert res.bundle is not None
    build(res.bundle, tmp_path)
    public = json.loads((tmp_path / "public" / f"{res.bundle.exam.id}.json").read_text("utf-8"))
    text = json.dumps(public, ensure_ascii=False)

    for task in public["tasks"]:
        assert set(task) == {
            "id",
            "ege_task",
            "topics",
            "difficulty",
            "status",
            "statement",
            "answer_input",
            "hint_count",
        }
        assert set(task["answer_input"]) == {"type", "unit"}
    for t in res.bundle.tasks:
        for needle in leak_needles(t):
            assert needle not in text


# --- validation errors on a scratch copy -------------------------------------------------


@pytest.fixture
def scratch(tmp_path: Path) -> Path:
    src = CONTENT / "ege-physics"
    dst = tmp_path / "ege-physics"
    shutil.copytree(src, dst)
    return dst


def _errors(root: Path) -> str:
    return "\n".join(load_exam_dir(root).errors)


def _edit(path: Path, old: str, new: str) -> None:
    text = path.read_text("utf-8")
    assert old in text
    path.write_text(text.replace(old, new, 1), "utf-8")


def test_wrong_answer_type_for_task_number(scratch: Path) -> None:
    _edit(scratch / "tasks/1/kin-0001.md", "ege_task: 1", "ege_task: 5")
    (scratch / "tasks/1/kin-0001.md").rename(scratch / "tasks/5/kin-0001.md")
    assert "expects answer type 'sequence'" in _errors(scratch)


def test_task_in_wrong_folder(scratch: Path) -> None:
    (scratch / "tasks/1/kin-0001.md").rename(scratch / "tasks/2/kin-0001.md")
    assert "must live in tasks/1/" in _errors(scratch)


def test_unknown_topic(scratch: Path) -> None:
    _edit(scratch / "tasks/1/kin-0001.md", "mech.kinematics.uniform-accel", "mech.nope")
    assert "unknown topic 'mech.nope'" in _errors(scratch)


def test_prereq_cycle(scratch: Path) -> None:
    _edit(
        scratch / "roadmap.yaml",
        "prereqs: []\n        ege_tasks: [1]\n",
        "prereqs: [mech.dynamics.newton]\n        ege_tasks: [1]\n",
    )
    assert "prerequisite cycle" in _errors(scratch)


def test_missing_solution_heading(scratch: Path) -> None:
    _edit(scratch / "tasks/1/kin-0001.md", "## Решение", "## Ответ")
    assert "exactly one '## Решение'" in _errors(scratch)


def test_latex_eaten_by_double_quotes(scratch: Path) -> None:
    _edit(
        scratch / "tasks/5/kin-0002.md",
        "  - 'Сравните закон движения с общей формулой $x = x_0 + v_0 t + \\frac{a t^2}{2}$.'",
        '  - "Сравните $\\frac{a}{2}$"',
    )
    assert "LaTeX backslash" in _errors(scratch)


def test_missing_image(scratch: Path) -> None:
    _edit(
        scratch / "theory/mech.dynamics.newton.md", "## Второй", "![](../assets/x.png)\n\n## Второй"
    )
    assert "missing image" in _errors(scratch)


def test_source_ref_required(scratch: Path) -> None:
    _edit(scratch / "tasks/1/kin-0001.md", "source: {kind: original}", "source: {kind: book}")
    assert "source.ref is required" in _errors(scratch)


# --- step tasks embedded in theory -------------------------------------------------------

BASICS = "theory/mech.kinematics.basics.md"
STEP = "tasks/steps/ks-basics-01.md"


def test_step_task_outside_steps_folder(scratch: Path) -> None:
    (scratch / STEP).rename(scratch / "tasks/1/ks-basics-01.md")
    assert "must live in tasks/steps/" in _errors(scratch)


def test_step_task_needs_practice_spec(scratch: Path) -> None:
    exam = scratch / "exam.yaml"
    text = exam.read_text("utf-8")
    exam.write_text(text[: text.index("\npractice:")] + "\n", "utf-8")
    assert "step tasks (exam.yaml: practice) not in exam.yaml" in _errors(scratch)


def test_embed_of_unknown_task(scratch: Path) -> None:
    _edit(scratch / BASICS, 'id="ks-basics-01"', 'id="ks-nope"')
    errors = _errors(scratch)
    assert "embeds unknown task 'ks-nope'" in errors
    assert "ks-basics-01.md: step task is not embedded" in errors


def test_embed_twice(scratch: Path) -> None:
    _edit(scratch / BASICS, 'id="ks-basics-02"', 'id="ks-basics-01"')
    assert "'ks-basics-01' is already embedded" in _errors(scratch)


def test_embed_of_task_from_another_topic(scratch: Path) -> None:
    _edit(scratch / BASICS, "## Шаг 2.", '<pp-task id="kin-0001"></pp-task>\n\n## Шаг 2.')
    assert "'kin-0001' is not tagged with topic 'mech.kinematics.basics'" in _errors(scratch)


def test_malformed_embed(scratch: Path) -> None:
    _edit(scratch / BASICS, "## Шаг 2.", "Текст <pp-task id='x'></pp-task>\n\n## Шаг 2.")
    assert "write task embeds alone on a line" in _errors(scratch)


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        (
            "## Шаг 2. Равномерное движение: $s = vt$ (7 класс)",
            "## Шаг 2. Равномерное движение: $s = vt$",
            "needs a grade",
        ),
        (
            "## Шаг 2. Равномерное движение: $s = vt$ (7 класс)",
            "## Шаг 5. Равномерное движение: $s = vt$ (7 класс)",
            "should be «Шаг 2»",
        ),
        ("## Шаг 5. Система отсчёта (9 класс)", "## Шаг 5. Система отсчёта (8–9 класс)", ""),
        (
            "## Шаг 6. Перемещение — это вектор (9 класс)",
            "## Шаг 6. Перемещение — это вектор (7 класс)",
            "grade goes down from 9 to 7",
        ),
        (
            "## Шаг 1. Путь, время и единицы (7 класс)",
            "## Шаг 1. Путь, время и единицы (5 класс)",
            "within 7–11",
        ),
    ],
)
def test_step_grades(scratch: Path, old: str, new: str, message: str) -> None:
    _edit(scratch / BASICS, old, new)
    errors = _errors(scratch)
    assert message in errors if message else errors == ""


def test_public_theory_lists_embedded_tasks(tmp_path: Path) -> None:
    res = load_exam_dir(CONTENT / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, tmp_path)
    public = json.loads((tmp_path / "public/ege-physics.json").read_text("utf-8"))
    page = next(p for p in public["theory"] if p["topic"] == "mech.kinematics.basics")
    assert page["tasks"][:2] == ["ks-basics-01", "ks-basics-02"]
    step = next(t for t in public["tasks"] if t["id"] == "ks-basics-01")
    assert step["ege_task"] is None


def test_split_frontmatter_requires_block() -> None:
    with pytest.raises(ValueError, match="frontmatter"):
        split_frontmatter("no frontmatter")


def test_cli_validate_exit_codes(scratch: Path, tmp_path: Path) -> None:
    assert main(["validate", "--content", str(scratch.parent)]) == 0
    (scratch / "tasks/1/kin-0001.md").write_text("broken", "utf-8")
    assert main(["validate", "--content", str(scratch.parent)]) == 1
    assert main(["validate", "--content", str(tmp_path / "empty")]) == 2
