"""Profile insights (insights.py): statuses, practice set, mistakes notebook, prediction."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from content_schema.models import (
    AnswerKind,
    ExamSpec,
    Roadmap,
    ScoringRule,
    TaskNumberSpec,
)
from platform_api.insights import (
    MISTAKE_RETRY_DAYS,
    PREDICTION_MIN_TASKS,
    REVIEW_AFTER_DAYS,
    AttemptRow,
    EvidenceBundle,
    RunResult,
    TaskInfo,
    ThreadStat,
    VariantRunRow,
    VisitRow,
    classify,
    mistakes,
    practice_set,
    predict,
    study_order,
    teaser_topic,
    topic_insights,
)

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
TODAY = NOW.date()

# Section «a» lists a dependant before its prerequisite: study order must swap them.
ROADMAP = Roadmap.model_validate(
    {
        "sections": [
            {
                "id": "a",
                "title": "A",
                "topics": [
                    {"id": "a.two", "title": "A2", "prereqs": ["a.one"], "ege_tasks": [1]},
                    {"id": "a.one", "title": "A1", "ege_tasks": [1, 5]},
                ],
            },
            {
                "id": "b",
                "title": "B",
                "topics": [{"id": "b.one", "title": "B1", "ege_tasks": [5, 21]}],
            },
        ]
    }
)


def _spec(part: int, kind: AnswerKind, points: int, rule: ScoringRule) -> TaskNumberSpec:
    return TaskNumberSpec(part=part, answer_kind=kind, max_points=points, scoring=rule, title="n")


EXAM = ExamSpec(
    id="ege-physics",
    title="test",
    locale="ru",
    season=2027,
    verified=False,
    source="test",
    duration_minutes=235,
    tasks={
        1: _spec(1, AnswerKind.NUMERIC, 1, ScoringRule.EXACT),
        5: _spec(1, AnswerKind.SEQUENCE, 2, ScoringRule.ONE_ERROR_PARTIAL),
        21: _spec(2, AnswerKind.EXTENDED, 3, ScoringRule.MANUAL),
    },
)


def task(
    tid: str,
    topic: str = "a.one",
    ege: int | None = 1,
    difficulty: int = 1,
    published: bool = True,
    in_season: bool = True,
    active: bool = True,
    checkable: bool = True,
) -> TaskInfo:
    return TaskInfo(tid, ege, (topic,), difficulty, published, in_season, active, checkable)


def att(
    tid: str, outcome: str, days_ago: int = 0, points: int | None = None, max_points: int = 1
) -> AttemptRow:
    if points is None:
        points = max_points if outcome == "correct" else 1 if outcome == "partial" else 0
    return AttemptRow(tid, outcome, points, max_points, NOW - timedelta(days=days_ago, hours=1))


def bundle(tasks: list[TaskInfo], attempts: list[AttemptRow], **kw: object) -> EvidenceBundle:
    return EvidenceBundle(
        tasks={t.id: t for t in tasks},
        attempts=sorted(attempts, key=lambda a: a.at),
        **kw,  # type: ignore[arg-type]
    )


def by_topic(ev: EvidenceBundle) -> dict[str, object]:
    return {t.topic_id: t for t in topic_insights(ROADMAP, ev, TODAY)}


# --- classify ---------------------------------------------------------------------------------

OLD = TODAY - timedelta(days=REVIEW_AFTER_DAYS)
RECENT = TODAY - timedelta(days=REVIEW_AFTER_DAYS - 1)


@pytest.mark.parametrize(
    ("mastery", "graded", "solved", "help", "per_solved", "last", "status"),
    [
        (None, 0, 0, None, None, None, "not_started"),
        (0.3, 3, 1, 0.0, 1.0, RECENT, "weak"),
        (0.3, 2, 0, None, None, RECENT, "in_progress"),  # too little evidence to judge
        (0.3, 5, 3, 1.0, 3.0, RECENT, "weak"),  # weak wins over shaky
        (0.9, 3, 2, 0.5, 1.0, RECENT, "shaky"),  # half solved with heavy help
        (0.9, 3, 2, 0.0, 2.5, RECENT, "shaky"),  # many attempts per solved task
        (0.9, 3, 1, 1.0, 4.0, RECENT, "strong"),  # one solved task cannot make it shaky
        (0.9, 3, 3, 0.0, 1.0, RECENT, "strong"),
        (0.8, 3, 3, 0.0, 1.0, RECENT, "strong"),  # the cut-off itself is strong
        (0.9, 3, 3, 0.0, 1.0, OLD, "review_due"),
        (0.9, 2, 2, 0.0, 1.0, OLD, "in_progress"),  # strong needs evidence; so does review
        (0.6, 6, 4, 0.0, 1.0, RECENT, "in_progress"),
        (0.5, 3, 2, 0.0, 1.0, RECENT, "in_progress"),  # 0.5 is not weak
    ],
)
def test_classify(
    mastery: float | None,
    graded: int,
    solved: int,
    help: float | None,
    per_solved: float | None,
    last: date | None,
    status: str,
) -> None:
    assert classify(mastery, graded, solved, help, per_solved, last, TODAY) == status


def test_study_order_puts_prerequisites_first() -> None:
    assert [t.id for t in study_order(ROADMAP)] == ["a.one", "a.two", "b.one"]


# --- topic insights ---------------------------------------------------------------------------


def test_no_evidence() -> None:
    ev = bundle([task("t1")], [], theory_pages={"a.one": ["a.one/01-x", "a.one/02-y"]})
    topics = topic_insights(ROADMAP, ev, TODAY)
    assert [t.topic_id for t in topics] == ["a.one", "a.two", "b.one"]
    assert {t.status for t in topics} == {"not_started"}
    r = topics[0].reasons
    assert r.mastery is None
    assert r.first_try_accuracy is None
    assert r.attempts_per_solved is None
    assert (r.graded_tasks, r.solved_tasks, r.reveals) == (0, 0, 0)
    assert (r.lessons.total, r.lessons.opened, r.lessons.finished) == (2, 0, 0)
    assert r.last_practised is None
    assert teaser_topic(topics) is None


def test_reasons_and_numbers() -> None:
    tasks = [task("t1"), task("t2"), task("t3", ege=5), task("s1", ege=None)]
    attempts = [
        att("t1", "wrong", 3),
        att("t1", "wrong", 3),
        att("t1", "correct", 2),  # 3 attempts to solve
        att("t2", "correct", 1),
        att("t3", "partial", 1, max_points=2),  # partial points: half a first try
        att("s1", "correct", 0),  # step task: counts for the topic
    ]
    ev = bundle(tasks, attempts)
    r = by_topic(ev)["a.one"].reasons  # type: ignore[attr-defined]
    assert r.graded_tasks == 4
    assert r.first_try_accuracy == pytest.approx((0 + 1 + 0.5 + 1) / 4, abs=1e-3)
    assert r.solved_tasks == 3
    assert r.attempts_per_solved == pytest.approx((3 + 1 + 1) / 3, abs=1e-3)
    assert r.heavy_help_share == 0
    assert r.last_practised == TODAY


def test_merged_duplicate_visit_rows_are_summed() -> None:
    visits = [
        VisitRow("a.one/01-x", visits=2, active_s=600, finished=False),
        VisitRow("a.one/01-x", visits=1, active_s=300, finished=True),  # merged on sign-in
        VisitRow("a.one/02-y", visits=1, active_s=60, finished=False),
        VisitRow("b.one", visits=1, active_s=120, finished=True),  # another topic
    ]
    ev = bundle(
        [],
        [],
        visits=visits,
        theory_pages={"a.one": ["a.one/01-x", "a.one/02-y", "a.one/03-z"], "b.one": ["b.one"]},
    )
    topics = by_topic(ev)
    a = topics["a.one"].reasons  # type: ignore[attr-defined]
    assert (a.lessons.total, a.lessons.opened, a.lessons.finished) == (3, 2, 1)
    assert a.reading_minutes == 16
    b = topics["b.one"].reasons  # type: ignore[attr-defined]
    assert (b.lessons.total, b.lessons.opened, b.lessons.finished) == (1, 1, 1)


def test_heavy_help_from_reveals_and_hint_levels() -> None:
    tasks = [task(f"t{i}") for i in range(4)]
    attempts = [
        att("t0", "wrong", 2),
        att("t0", "revealed", 2),
        att("t0", "correct", 1),  # solved after a reveal: heavy
        att("t1", "correct", 1),  # hint level 2 in its thread: heavy
        att("t2", "correct", 1),  # hint level 1: light
        att("t3", "correct", 1),
        att("t3", "revealed", 1),  # reveal after solving: not heavy, still a reveal
    ]
    threads = [
        ThreadStat("task", "t1", hint_level=2, questions=3),
        ThreadStat("task", "t2", hint_level=1, questions=1),
        ThreadStat("theory", "a.one/01-x", hint_level=0, questions=4),
        ThreadStat("theory", "a.one", hint_level=0, questions=1),
        ThreadStat("task", "gone", hint_level=3, questions=9),  # task no longer in content
    ]
    r = by_topic(bundle(tasks, attempts, threads=threads))["a.one"].reasons  # type: ignore[attr-defined]
    assert r.heavy_help_share == 0.5
    assert r.reveals == 2
    assert (r.task_questions, r.theory_questions) == (4, 5)


def test_statuses_end_to_end_and_teaser() -> None:
    tasks = [task(f"a{i}", "a.one") for i in range(3)] + [task(f"b{i}", "b.one") for i in range(3)]
    attempts = [att(f"a{i}", "wrong", 1) for i in range(3)] + [
        att(f"b{i}", "correct", 1) for i in range(3)
    ]
    topics = topic_insights(ROADMAP, bundle(tasks, attempts), TODAY)
    assert {t.topic_id: t.status for t in topics} == {
        "a.one": "weak",
        "a.two": "not_started",
        "b.one": "strong",
    }
    teaser = teaser_topic(topics)
    assert teaser is not None
    assert teaser.topic_id == "a.one"


def test_review_due_after_weeks_without_practice() -> None:
    tasks = [task(f"b{i}", "b.one") for i in range(3)]
    attempts = [att(f"b{i}", "correct", REVIEW_AFTER_DAYS) for i in range(3)]
    assert by_topic(bundle(tasks, attempts))["b.one"].status == "review_due"  # type: ignore[attr-defined]


# --- practice set -----------------------------------------------------------------------------


def _weak_a_one(extra: list[TaskInfo]) -> tuple[list[TaskInfo], list[AttemptRow]]:
    """a.one is weak (three wrong first tries on w0–w2), plus the given candidate tasks."""
    tasks = [task(f"w{i}", "a.one", difficulty=3) for i in range(3)] + extra
    return tasks, [att(f"w{i}", "wrong", 2) for i in range(3)]


def test_practice_prefers_weak_topics_prereqs_first_easiest_first() -> None:
    a_two_weak = [task(f"x{i}", "a.two") for i in range(3)]
    tasks, attempts = _weak_a_one(
        [task("hard", "a.one", difficulty=4), task("easy", "a.one", difficulty=1), *a_two_weak]
    )
    attempts += [att(f"x{i}", "wrong", 2) for i in range(3)]  # a.two weak too
    tasks += [task("y0", "a.two", difficulty=1), task("y1", "a.two", difficulty=1)]
    items = practice_set(ROADMAP, bundle(tasks, attempts), NOW)
    ids = [i.task_id for i in items]
    # a.one (prerequisite) before a.two; within a.one unsolved, easiest first, ≤ 3 per topic.
    assert ids[0] == "easy"
    assert [i.topic_id for i in items[:3]] == ["a.one"] * 3
    assert {i.topic_id for i in items[3:]} == {"a.two"}
    assert sum(1 for i in items if i.topic_id == "a.two") <= 3
    assert "hard" not in ids  # a.one's three slots went to easier tasks
    assert all(i.reason == "weak" for i in items)


def test_practice_skips_step_tasks_removed_and_solved_but_keeps_old_season() -> None:
    tasks, attempts = _weak_a_one(
        [
            task("step", ege=None),
            task("gone", active=False),
            task("part2", ege=24, checkable=False),
            task("solved"),
            task("old", in_season=False),
        ]
    )
    attempts += [att("solved", "wrong", 2), att("solved", "correct", 2)]
    ids = {i.task_id for i in practice_set(ROADMAP, bundle(tasks, attempts), NOW)}
    assert "step" not in ids
    assert "gone" not in ids
    assert "part2" not in ids
    assert "solved" not in ids
    assert "old" in ids


def test_practice_prefers_published_tasks_over_drafts() -> None:
    tasks, attempts = _weak_a_one(
        [task("draft", difficulty=1, published=False), task("pub", difficulty=2)]
    )
    ids = [i.task_id for i in practice_set(ROADMAP, bundle(tasks, attempts), NOW)]
    assert ids[0] == "pub"  # though the draft is easier
    assert "draft" not in ids  # published tasks filled the topic's slots


def test_practice_review_due_includes_solved_after_unsolved() -> None:
    tasks = [task(f"b{i}", "b.one", ege=5) for i in range(3)] + [task("bnew", "b.one", ege=5)]
    attempts = [att(f"b{i}", "correct", REVIEW_AFTER_DAYS + 1) for i in range(3)]
    items = practice_set(ROADMAP, bundle(tasks, attempts), NOW)
    assert items[0].task_id == "bnew"
    assert all(i.reason == "review_due" for i in items)
    assert len(items) == 3  # per-topic cap


def test_practice_tops_up_from_in_progress_only_when_short() -> None:
    tasks, attempts = _weak_a_one([task(f"u{i}", "a.one") for i in range(5)])
    tasks += [task("p0", "b.one", ege=5), task("p1", "b.one", ege=5)]
    attempts.append(att("p0", "correct", 2))  # b.one in progress (one task)
    items = practice_set(ROADMAP, bundle(tasks, attempts), NOW)
    # Weak a.one gives 3 (cap), fewer than PRACTICE_MIN: top up with b.one's unsolved p1.
    assert [i.task_id for i in items if i.topic_id == "b.one"] == ["p1"]
    assert items[-1].reason == "in_progress"


def test_practice_is_stable_for_the_day() -> None:
    tasks, attempts = _weak_a_one([task(f"u{i}", "a.one") for i in range(6)])
    first = practice_set(ROADMAP, bundle(tasks, attempts), NOW)
    again = practice_set(ROADMAP, bundle(tasks, attempts), NOW + timedelta(hours=5))
    assert first == again
    solved = first[0].task_id
    later = practice_set(
        ROADMAP, bundle(tasks, [*attempts, att(solved, "correct", 0)]), NOW + timedelta(hours=1)
    )
    assert [i.task_id for i in later] == [i.task_id for i in first]
    assert [i.done for i in later] == [True] + [False] * (len(later) - 1)


# --- mistakes notebook ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("attempts", "listed", "due"),
    [
        ([att("t", "wrong", 1)], True, False),
        ([att("t", "wrong", MISTAKE_RETRY_DAYS)], True, True),
        ([att("t", "partial", 5, max_points=2)], True, True),  # lost a point: a mistake
        ([att("t", "wrong", 5), att("t", "correct", 5)], True, True),  # same-day fix: stays
        ([att("t", "wrong", 5), att("t", "correct", 4)], False, False),  # fixed a later day
        ([att("t", "correct", 5), att("t", "wrong", 4)], False, False),  # first try was right
        ([att("t", "revealed", 5)], False, False),  # not graded
        ([], False, False),
    ],
)
def test_mistakes(attempts: list[AttemptRow], listed: bool, due: bool) -> None:
    got = mistakes(bundle([task("t")], attempts), TODAY)
    assert bool(got) == listed
    if listed:
        assert got[0].due == due
        assert got[0].due_on == got[0].mistake_on + timedelta(days=MISTAKE_RETRY_DAYS)


def test_mistakes_due_first_and_step_tasks_included() -> None:
    tasks = [task("late"), task("early"), task("step", ege=None), task("gone", active=False)]
    attempts = [
        att("late", "wrong", 0),
        att("early", "wrong", 6),
        att("step", "wrong", 4),
        att("gone", "wrong", 6),
    ]
    got = mistakes(bundle(tasks, attempts), TODAY)
    assert [m.task_id for m in got] == ["early", "step", "late"]


# --- prediction -------------------------------------------------------------------------------

# Synthetic linear scale for the test exam (6 primary points); not a real table.
SCALE = {p: round(p * 100 / 6) for p in range(7)}


def _solved_bank(n: int = PREDICTION_MIN_TASKS) -> tuple[list[TaskInfo], list[AttemptRow]]:
    tasks = [task(f"t{i}") for i in range(n)]
    return tasks, [att(f"t{i}", "correct", 3) for i in range(n)]


def _run(*results: tuple[str, int, int | None, int], days_ago: int = 1) -> VariantRunRow:
    return VariantRunRow(
        NOW - timedelta(days=days_ago),
        tuple(RunResult(tid, n, 1 if n < 21 else 2, pts, mx) for tid, n, pts, mx in results),
    )


def test_prediction_without_evidence() -> None:
    p = predict(EXAM, ROADMAP, bundle([], []))
    assert not p.enough_data
    assert p.primary is None
    assert p.test is None
    assert p.missing_numbers == (1, 5, 21)
    assert p.graded_tasks_needed == PREDICTION_MIN_TASKS
    assert {n.basis for n in p.per_number} == {"none"}


def test_prediction_needs_coverage() -> None:
    tasks, attempts = _solved_bank()
    p = predict(EXAM, ROADMAP, bundle(tasks, attempts))
    # Numbers 1 and 5 have mastery (3 of 6 points < 60 %); Part 2 has no self-assessment.
    assert not p.enough_data
    assert p.primary is None
    assert p.missing_numbers == (21,)
    assert p.graded_tasks_needed == 0


def test_prediction_with_part2_self_assessment() -> None:
    tasks, attempts = _solved_bank()
    tasks.append(task("p2", "b.one", ege=21))
    run = _run(("p2", 21, 2, 3))  # self-assessed 2 of 3
    p = predict(EXAM, ROADMAP, bundle(tasks, attempts, runs=[run]))
    assert p.enough_data
    by_n = {n.number: n for n in p.per_number}
    assert (by_n[1].basis, by_n[1].expected) == ("mastery", 1.0)
    assert (by_n[21].basis, by_n[21].expected) == ("variants", 2.0)
    # mean 5; variance 9·(2/3)(1/3) = 2 → ±1.28·1.41 = ±1.81
    assert p.primary is not None
    assert (p.primary.low, p.primary.expected, p.primary.high) == (3, 5, 6)
    assert p.test is None
    assert p.scale_season is None


def test_prediction_converts_with_the_scale() -> None:
    exam = EXAM.model_copy(
        update={"score_scale": SCALE, "score_scale_source": "test", "score_scale_season": 2026}
    )
    tasks, attempts = _solved_bank()
    tasks.append(task("p2", "b.one", ege=21))
    p = predict(exam, ROADMAP, bundle(tasks, attempts, runs=[_run(("p2", 21, 2, 3))]))
    assert p.test is not None
    assert (p.test.low, p.test.expected, p.test.high) == (SCALE[3], SCALE[5], SCALE[6])
    assert p.scale_season == 2026


def test_prediction_blends_variants_and_skips_unassessed_and_old_season() -> None:
    tasks, attempts = _solved_bank()
    tasks += [task("v1"), task("old", in_season=False), task("p2", "b.one", ege=21)]
    runs = [
        _run(("v1", 1, 0, 1), ("p2", 21, None, 3), days_ago=1),  # Part 2 not assessed yet
        _run(("old", 1, 0, 1), days_ago=2),  # task out of this season's plan
    ]
    p = predict(EXAM, ROADMAP, bundle(tasks, attempts, runs=runs))
    by_n = {n.number: n for n in p.per_number}
    # Mastery 1.0 blended with one run's 0/1 at weight 0.25.
    assert (by_n[1].basis, by_n[1].expected, by_n[1].variant_runs) == ("blend", 0.75, 1)
    assert by_n[21].basis == "none"


def test_prediction_uses_only_recent_runs() -> None:
    tasks, attempts = _solved_bank()
    tasks.append(task("v1"))
    runs = [_run(("v1", 1, 0, 1), days_ago=d) for d in range(1, 6)]
    p = predict(EXAM, ROADMAP, bundle(tasks, attempts, runs=runs))
    assert {n.number: n for n in p.per_number}[1].variant_runs == 3
