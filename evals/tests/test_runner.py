import asyncio
from pathlib import Path

import pytest

from content_schema.build import build
from content_schema.loader import load_exam_dir
from platform_api.content import ContentStore
from platform_api.llm import ChatModel, FailingModel, ScriptedModel
from platform_api.tutor import LEAK_NOTE
from tutor_evals.checks import Limits
from tutor_evals.cli import EVALS
from tutor_evals.report import gate, markdown, summarize
from tutor_evals.runner import TurnResult, run_conversation, run_suite
from tutor_evals.suite import Persona, StudentTurn, Suite, Thresholds, load_suite

REPO = Path(__file__).resolve().parents[2]
LIMITS_TASK = {"max_chars": 900, "max_sentences": 6}


@pytest.fixture(scope="module")
def store(tmp_path_factory: pytest.TempPathFactory) -> ContentStore:
    out = tmp_path_factory.mktemp("build")
    res = load_exam_dir(REPO / "content" / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, out)
    return ContentStore.load(out / "private")


def persona(*turns: StudentTurn, kind: str = "task") -> Persona:
    return Persona.model_validate(
        {"id": "p", "kind": kind, "description": "", "turns": [t.model_dump() for t in turns]}
    )


def run(
    store: ContentStore, model: ChatModel, p: Persona, task_id: str = "kin-0001"
) -> list[TurnResult]:
    task = store.task(task_id)
    assert task is not None
    return asyncio.run(run_conversation([model], p, limits=Limits(900, 6), task=task))


def test_shipped_suite_is_valid() -> None:
    suite = load_suite(EVALS / "suite.yaml")
    assert {p.kind for p in suite.personas} == {"task", "theory"}


def test_leak_is_measured_on_raw_output(store: ContentStore) -> None:
    # kin-0001's answer is 12.5 m/s; the guard stops it, the eval still counts it.
    model = ScriptedModel(replies=("Хорошо. Тогда $v = 12{,}5$ м/с. Понятно?",))
    [r] = run(store, model, persona(StudentTurn(text="Какой ответ?")))
    assert r.leak is True
    assert "12" not in r.shown
    assert r.shown.endswith(LEAK_NOTE)
    assert r.failures() == ["leak"]


def test_ladder_reaches_full_solution_without_leak_check(store: ContentStore) -> None:
    model = ScriptedModel(replies=("Ответ: $v = 12{,}5$ м/с.",))
    turns = [
        StudentTurn(text="Где ошибка?", attempt="wrong"),
        StudentTurn(intent="hint"),
        StudentTurn(intent="hint"),
        StudentTurn(intent="hint"),
    ]
    results = run(store, model, persona(*turns))
    assert [r.hint_level for r in results] == [0, 1, 2, 3]
    assert [r.leak for r in results] == [True, True, True, None]
    assert results[1].student  # hint with no text gets the canned request


def test_answer_placeholder_and_history(store: ContentStore) -> None:
    model = ScriptedModel(replies=("Как ты получил это число?", "Покажи ход решения."))
    results = run(
        store, model, persona(StudentTurn(text="У меня {answer}."), StudentTurn(text="Ну?"))
    )
    assert "12" in results[0].student
    assert [r.leak for r in results] == [False, False]


def test_model_failure_is_an_error_not_a_crash(store: ContentStore) -> None:
    [r] = run(store, FailingModel(), persona(StudentTurn(text="Привет")))
    assert r.error is not None
    assert "error" in r.failures()


def test_suite_gate_and_report(store: ContentStore) -> None:
    suite = Suite.model_validate(
        {
            "tasks": ["kin-0001", "dyn-0001"],
            "theory": "all",
            "limits": {"task": LIMITS_TASK, "theory": {"max_chars": 1800, "max_sentences": 14}},
            "personas": [
                {"id": "a", "kind": "task", "description": "", "turns": [{"text": "Помоги"}]},
                {"id": "b", "kind": "theory", "description": "", "turns": [{"text": "Что это?"}]},
            ],
        }
    )
    model = ScriptedModel(replies=("Let me explain in English.",))
    results = asyncio.run(run_suite(suite, store, [model]))
    assert len(results) == 2 + len(store.theory_topics())
    summary = summarize(results)
    assert summary["not_russian_rate"] == 1.0
    assert summary["leak_rate"] == 0.0
    violations = gate(summary, Thresholds())
    assert violations == ["not_russian_rate = 100.00% > 0.00%"]
    md = markdown(summary, results, violations)
    assert "FAIL" in md
    assert "not_russian" in md
