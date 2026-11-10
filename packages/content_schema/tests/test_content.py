"""Loader validation, the real content tree, and the no-leak invariant."""

import json
import shutil
from collections.abc import Callable
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


def test_control_character_in_body(scratch: Path) -> None:
    # "\text{:}" written through a Python string: a tab, then "ext{:}"
    _edit(
        scratch / "theory/mech.kinematics.basics/02-speed-uniform.md",
        "## Частые ловушки",
        "Пример ${4\\ \\text{м/с}\text{:}}$\n\n## Частые ловушки",
    )
    assert "control character 0x09" in _errors(scratch)


def test_missing_image(scratch: Path) -> None:
    _edit(
        scratch / "theory/mech.kinematics.basics/02-speed-uniform.md",
        "## Частые ловушки",
        "![](../../assets/x.png)\n\n## Частые ловушки",
    )
    assert "missing image" in _errors(scratch)


def test_source_ref_required(scratch: Path) -> None:
    _edit(scratch / "tasks/1/kin-0001.md", "source: {kind: original}", "source: {kind: book}")
    assert "source.ref is required" in _errors(scratch)


# --- step tasks embedded in theory -------------------------------------------------------

# A whole-topic page with «Шаг N». The repo's topics move to lessons one by one, so these
# tests write their own ladder: in the scratch copy the uniform-accel lessons become one page.
LADDER = "theory/mech.kinematics.uniform-accel.md"
STEP = "tasks/steps/ks-accel-01.md"
_LADDER_STEPS = [
    ("Ускорение: на сколько м/с за секунду", 9, [1, 9]),
    ("Скорость в любой момент", 9, [2]),
    ("Ускорение — вектор", 9, [3, 10]),
    ("Перемещение — площадь под графиком скорости", 9, [4, 11]),
    ("Средняя скорость при равноускоренном движении", 9, [5]),
    ("Формула без времени", 10, [6, 12, 13]),
    ("Уравнение координаты", 10, [7, 14]),
    ("Графики и разгон из покоя", 10, [8]),
]


@pytest.fixture
def ladder(scratch: Path) -> Path:
    shutil.rmtree(scratch / "theory/mech.kinematics.uniform-accel")
    parts = ["---\ntopic: mech.kinematics.uniform-accel\ntitle: Равноускоренное движение\n---\n"]
    parts.append("Вступление.\n")
    for n, (title, grade, tasks) in enumerate(_LADDER_STEPS, 1):
        parts.append(f"## Шаг {n}. {title} ({grade} класс)\n\nТекст.\n")
        parts += [f'<pp-task id="ks-accel-{t:02d}"></pp-task>\n' for t in tasks]
    (scratch / LADDER).write_text("\n".join(parts), "utf-8")
    assert _errors(scratch) == ""
    return scratch


def test_step_task_outside_steps_folder(scratch: Path) -> None:
    (scratch / STEP).rename(scratch / "tasks/1/ks-accel-01.md")
    assert "must live in tasks/steps/" in _errors(scratch)


def test_step_task_needs_practice_spec(scratch: Path) -> None:
    exam = scratch / "exam.yaml"
    text = exam.read_text("utf-8")
    exam.write_text(text[: text.index("\npractice:")] + "\n", "utf-8")
    assert "step tasks (exam.yaml: practice) not in exam.yaml" in _errors(scratch)


def test_embed_of_unknown_task(ladder: Path) -> None:
    _edit(ladder / LADDER, 'id="ks-accel-01"', 'id="ks-nope"')
    errors = _errors(ladder)
    assert "embeds unknown task 'ks-nope'" in errors
    assert "ks-accel-01.md: step task is not embedded" in errors


def test_embed_twice(ladder: Path) -> None:
    _edit(ladder / LADDER, 'id="ks-accel-02"', 'id="ks-accel-01"')
    assert "'ks-accel-01' is already embedded" in _errors(ladder)


def test_embed_of_task_from_another_topic(ladder: Path) -> None:
    _edit(ladder / LADDER, "## Шаг 2.", '<pp-task id="dyn-0001"></pp-task>\n\n## Шаг 2.')
    errors = _errors(ladder)
    assert "'dyn-0001' is not tagged with topic 'mech.kinematics.uniform-accel'" in errors


def test_malformed_embed(ladder: Path) -> None:
    _edit(ladder / LADDER, "## Шаг 2.", "Текст <pp-task id='x'></pp-task>\n\n## Шаг 2.")
    assert "write task embeds alone on a line" in _errors(ladder)


ACCEL_1 = "## Шаг 1. Ускорение: на сколько м/с за секунду (9 класс)"
ACCEL_2 = "## Шаг 2. Скорость в любой момент (9 класс)"


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        (ACCEL_2, "## Шаг 2. Скорость в любой момент", "needs a grade"),
        (ACCEL_2, "## Шаг 5. Скорость в любой момент (9 класс)", "should be «Шаг 2»"),
        (ACCEL_1, ACCEL_1.replace("(9 класс)", "(8–9 класс)"), ""),
        (
            "## Шаг 7. Уравнение координаты (10 класс)",
            "## Шаг 7. Уравнение координаты (9 класс)",
            "grade goes down from 10 to 9",
        ),
        (ACCEL_1, ACCEL_1.replace("(9 класс)", "(5 класс)"), "within 7–11"),
    ],
)
def test_step_grades(ladder: Path, old: str, new: str, message: str) -> None:
    _edit(ladder / LADDER, old, new)
    errors = _errors(ladder)
    assert message in errors if message else errors == ""


def test_public_theory_lists_embedded_tasks(ladder: Path, tmp_path: Path) -> None:
    res = load_exam_dir(ladder)
    assert res.bundle is not None
    build(res.bundle, tmp_path)
    public = json.loads((tmp_path / "public/ege-physics.json").read_text("utf-8"))
    page = next(p for p in public["theory"] if p["topic"] == "mech.kinematics.uniform-accel")
    assert page["kind"] == "page"
    assert page["tasks"][:3] == ["ks-accel-01", "ks-accel-09", "ks-accel-02"]
    step = next(t for t in public["tasks"] if t["id"] == "ks-accel-01")
    assert step["ege_task"] is None


# --- topics split into lessons (the repo's mech.kinematics.basics) -----------------------

LESSONS = "theory/mech.kinematics.basics"
FIRST = "01-motion-si.md"
LAST_GRADE = "9"  # of the last lesson, 06


def _lesson(n: int, slug: str, grade: str, body: str) -> tuple[str, str]:
    meta = f"topic: mech.kinematics.basics\ntitle: {slug}\ngrade: {grade}\nsummary: Кратко.\n"
    return f"{n:02d}-{slug}.md", f"---\n{meta}---\n{body}\n"


def _write(d: Path, name: str, text: str) -> None:
    (d / name).write_text(text, "utf-8")


def _drop_line(path: Path, prefix: str) -> None:
    lines = path.read_text("utf-8").splitlines(keepends=True)
    path.write_text("".join(x for x in lines if not x.startswith(prefix)), "utf-8")


WHOLE_PAGE = "---\ntopic: mech.kinematics.basics\ntitle: Т\n---\nТ.\n"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda d: (d / FIRST).rename(d / "1-motion.md"), "named like 01-slug.md"),
        (lambda d: (d / "_topic.md").unlink(), "needs _topic.md"),
        (
            lambda d: (d / "06-relative-motion.md").rename(d / "08-relative-motion.md"),
            "should be numbered 06",
        ),
        (lambda d: _write(d, *_lesson(7, "motion-si", "9", "Т.")), "second lesson with slug"),
        (lambda d: _write(d, *_lesson(7, "late", "8", "Т.")), "grade goes down from 9 to 8"),
        (lambda d: _write(d, *_lesson(7, "late", "12", "Т.")), "within 7–11"),
        (lambda d: _write(d, *_lesson(7, "late", "'9–10'", "Т.")), ""),
        (lambda d: _write(d, *_lesson(7, "late", "9", "## Шаг 1. Т (9 класс)")), "not «Шаг N»"),
        (lambda d: _drop_line(d / FIRST, "summary:"), "needs a one-line summary"),
        (lambda d: _drop_line(d / FIRST, "grade:"), "needs a grade"),
        (lambda d: _edit(d / FIRST, "grade: 7\n", "grade: 7\norder: 3\n"), "come from the file"),
        (lambda d: _edit(d / "_topic.md", "title:", "grade: 7\ntitle:"), "for lessons only"),
        (
            lambda d: _write(
                d, "_topic.md", WHOLE_PAGE + '\n<pp-task id="ks-basics-99"></pp-task>\n'
            ),
            "not the topic page",
        ),
        (
            lambda d: _write(d.parent, "mech.kinematics.basics.md", WHOLE_PAGE),
            "also has a folder theory/mech.kinematics.basics/",
        ),
        (
            lambda d: _edit(d / FIRST, "topic: mech.kinematics.basics", "topic: sr.basics"),
            "folder name must equal topic id 'sr.basics'",
        ),
    ],
)
def test_lesson_layout_errors(
    scratch: Path, change: Callable[[Path], object], message: str
) -> None:
    change(scratch / LESSONS)
    errors = _errors(scratch)
    assert message in errors if message else errors == ""


def test_lessons_embed_every_step_task(scratch: Path) -> None:
    _edit(scratch / LESSONS / "03-average-speed.md", '<pp-task id="ks-basics-05"></pp-task>', "")
    assert "ks-basics-05.md: step task is not embedded" in _errors(scratch)


def test_lesson_build_entries(tmp_path: Path) -> None:
    res = load_exam_dir(CONTENT / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, tmp_path)
    public = json.loads((tmp_path / "public/ege-physics.json").read_text("utf-8"))
    private = json.loads((tmp_path / "private/ege-physics.json").read_text("utf-8"))
    basics = [p for p in public["theory"] if p["topic"] == "mech.kinematics.basics"]
    assert [(p["kind"], p["number"]) for p in basics[:3]] == [
        ("intro", None),
        ("lesson", "1.1"),
        ("lesson", "1.2"),
    ]
    first = basics[1]
    assert first["id"] == "mech.kinematics.basics/motion-si"
    assert first["grade"] == "7"
    assert first["tasks"] == ["ks-basics-10", "ks-basics-11", "ks-basics-12", "ks-basics-13"]
    assert basics[-1]["grade"] == LAST_GRADE
    assert all("body" not in p for p in public["theory"])
    tutor = {p["id"]: p for p in private["theory"]}
    assert "mech.kinematics.basics" not in tutor  # the topic page has no chat
    lesson = tutor["mech.kinematics.basics/speed-uniform"]
    assert lesson["topic_title"] == "Основы кинематики"
    assert lesson["lessons"][0] == "1.1 Механическое движение и система СИ"
    assert len(lesson["lessons"]) == len(basics) - 1
    assert tutor["quantum.photoeffect"]["number"] is None  # a topic still on one page
    assert tutor["quantum.photoeffect"]["lessons"] == []


def test_split_frontmatter_requires_block() -> None:
    with pytest.raises(ValueError, match="frontmatter"):
        split_frontmatter("no frontmatter")


def test_cli_validate_exit_codes(scratch: Path, tmp_path: Path) -> None:
    assert main(["validate", "--content", str(scratch.parent)]) == 0
    (scratch / "tasks/1/kin-0001.md").write_text("broken", "utf-8")
    assert main(["validate", "--content", str(scratch.parent)]) == 1
    assert main(["validate", "--content", str(tmp_path / "empty")]) == 2
