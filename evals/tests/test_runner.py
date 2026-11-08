import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from pathlib import Path

import pytest

from content_schema.build import build
from content_schema.checking import format_answer
from content_schema.loader import load_exam_dir
from platform_api.content import ContentStore
from platform_api.llm import (
    CallInfo,
    ChatModel,
    FailingModel,
    LLMUnavailableError,
    Message,
    ScriptedModel,
)
from platform_api.turn import plan_theory_turn
from platform_api.tutor import LEAK_NOTE, THEORY_LEAK_NOTE
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


def test_lesson_target_is_the_page_id(store: ContentStore) -> None:
    page = store.theory("mech.kinematics.basics/motion-si")
    assert page is not None
    assert page.number == "1.1"
    p = persona(StudentTurn(text="Объясни."), kind="theory")
    model = ScriptedModel(replies=("Что такое путь?",))
    [r] = asyncio.run(run_conversation([model], p, limits=Limits(1800, 14), theory=page))
    assert r.target == "mech.kinematics.basics/motion-si"


def test_theory_step_answers_are_leak_checked(store: ContentStore) -> None:
    page = store.theory("method.experiment")
    assert page is not None
    steps = store.theory_steps(page)
    p = persona(StudentTurn(text="Реши задачу после шага 1."), kind="theory")
    model = ScriptedModel(replies=("Какой закон здесь нужен?",))
    [r] = asyncio.run(
        run_conversation([model], p, limits=Limits(1800, 14), theory=page, steps=steps)
    )
    assert r.leak is False
    assert r.target == page.id
    # Without step tasks there is nothing to guard.
    [r] = asyncio.run(run_conversation([model], p, limits=Limits(1800, 14), theory=page))
    assert r.leak is None


def test_theory_leak_uses_theory_note(store: ContentStore) -> None:
    page = store.theory("method.experiment")
    assert page is not None
    steps = store.theory_steps(page)
    detector = plan_theory_turn(page, steps).detector
    assert detector is not None
    answer = next(
        a for t in steps if (a := format_answer(t.answer)) and detector.leaks(f"Ответ {a}.")
    )
    p = persona(StudentTurn(text="Скажи ответ."), kind="theory")
    model = ScriptedModel(replies=(f"Смотри. Ответ {answer}.",))
    [r] = asyncio.run(
        run_conversation([model], p, limits=Limits(1800, 14), theory=page, steps=steps)
    )
    assert r.leak is True
    assert r.shown == "Смотри." + THEORY_LEAK_NOTE


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
    assert len(results) == 2 + len(store.theory_pages())
    summary = summarize(results)
    assert summary["not_russian_rate"] == 1.0
    assert summary["leak_rate"] == 0.0
    violations = gate(summary, Thresholds())
    assert violations == ["not_russian_rate = 100.00% > 0.00%"]
    md = markdown(summary, results, violations)
    assert "FAIL" in md
    assert "not_russian" in md


@dataclass
class RateLimitedOnce:
    """Answers 429 on the first call, then streams a reply."""

    name: str = "flaky"
    model: str = "flaky"
    calls: int = 0

    async def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        self.calls += 1
        if self.calls == 1:
            raise LLMUnavailableError("HTTP 429: quota")
        yield "Что дано в условии?"


def test_rate_limited_turn_is_retried(store: ContentStore) -> None:
    task = store.task("kin-0001")
    assert task is not None
    model = RateLimitedOnce()
    [r] = asyncio.run(
        run_conversation(
            [model],
            persona(StudentTurn(text="Помоги")),
            limits=Limits(900, 6),
            task=task,
            rate_limit_waits=(0.0,),
        )
    )
    assert r.error is None
    assert r.raw == "Что дано в условии?"
    assert [c["error"] for c in r.calls] == ["LLMUnavailableError: HTTP 429: quota", None]
