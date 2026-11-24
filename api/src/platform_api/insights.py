"""Student profile insights (ARCHITECTURE §10): topic statuses with their reasons, a weak-spot
practice set, a mistakes notebook and a predicted EGE score. Pure; computed on read.

Everything here is numbers and ids. The Russian summary text is built from these numbers in
the web layer (`web/src/lib/insights-text.ts`); no LLM is involved.
"""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal

from content_schema.models import ExamSpec, Roadmap, Topic
from platform_api.mastery import GRADED, Evidence, TopicMastery, compute_mastery

# --- thresholds -------------------------------------------------------------------------------

MIN_EVIDENCE = 3  # graded tasks a topic needs before it can be called weak or strong
STRONG_AT = 0.80  # mastery from which a topic is strong (Траектория's «Продолжить» uses 80 %)
WEAK_BELOW = 0.50  # mastery below which a topic with enough evidence is weak
REVIEW_AFTER_DAYS = 21  # a strong topic with no graded attempt for this long is due for review
HEAVY_HINT_LEVEL = 2  # tutor ladder level that counts as heavy help (a partial step or more)
SHAKY_HELP_SHARE = 0.5  # share of solved tasks solved with heavy help that makes a topic shaky
SHAKY_ATTEMPTS = 2.5  # average graded attempts per solved task that makes a topic shaky
SHAKY_MIN_SOLVED = 2  # solved tasks a topic needs before it can be called shaky
PRACTICE_MIN = 5  # the practice set tops up from in-progress topics below this size
PRACTICE_MAX = 10  # largest practice set
PRACTICE_PER_TOPIC = 3  # at most this many tasks of one topic, so the set spans topics
MISTAKE_RETRY_DAYS = 3  # a mistake comes back this many days after it was made
RECENT_RUNS = 3  # latest variant runs that count for the prediction
VARIANT_WEIGHT_PER_RUN = 0.25  # weight of variant results per run with that number…
VARIANT_WEIGHT_MAX = 0.75  # …capped, so topic mastery always keeps a say (Part 1)
PREDICTION_MIN_COVERAGE = 0.6  # share of the max primary score that needs evidence to predict
PREDICTION_MIN_TASKS = 15  # graded tasks needed to predict
PREDICTION_Z = 1.28  # the range is an 80 % band (±1.28 standard deviations)

Status = Literal["strong", "review_due", "weak", "shaky", "in_progress", "not_started"]
STATUSES: tuple[Status, ...] = (
    "weak",
    "shaky",
    "review_due",
    "in_progress",
    "strong",
    "not_started",
)

# --- input ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TaskInfo:
    id: str
    ege_task: int | None  # None: a step task of a theory page
    topics: tuple[str, ...]
    difficulty: int = 1
    published: bool = True  # False for drafts and tasks removed from content
    in_season: bool = True  # counts as its EGE number this season (see TaskMeta.last_season)


@dataclass(frozen=True)
class AttemptRow:
    task_id: str
    outcome: str  # correct | partial | wrong | revealed
    points: int
    max_points: int
    at: datetime


@dataclass(frozen=True)
class VisitRow:
    """A `theory_visits` row. A sign-in merge can leave two rows for one page: readers sum."""

    page_id: str  # topic id or `<topic>/<lesson>`
    visits: int
    active_s: int
    finished: bool


@dataclass(frozen=True)
class ThreadStat:
    kind: str  # task | theory
    context_id: str  # task id, or theory page id
    hint_level: int  # highest ladder level reached (task threads)
    questions: int  # the student's messages in the thread


@dataclass(frozen=True)
class RunResult:
    task_id: str
    ege_task: int
    part: int
    points: int | None  # None: a Part 2 task not self-assessed yet
    max_points: int


@dataclass(frozen=True)
class VariantRunRow:
    at: datetime
    results: tuple[RunResult, ...]


@dataclass(frozen=True)
class EvidenceBundle:
    tasks: Mapping[str, TaskInfo]
    attempts: Sequence[AttemptRow]  # chronological
    visits: Sequence[VisitRow] = ()
    threads: Sequence[ThreadStat] = ()
    runs: Sequence[VariantRunRow] = ()  # any order
    theory_pages: Mapping[str, Sequence[str]] = field(default_factory=dict)  # topic -> pages


# --- output -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Lessons:
    total: int
    opened: int
    finished: int


@dataclass(frozen=True)
class TopicReasons:
    mastery: float | None  # 0..1, EMA of first graded attempts (mastery.py)
    graded_tasks: int  # tasks with a graded attempt
    first_try_accuracy: float | None  # plain mean of points/max on first graded attempts
    solved_tasks: int  # tasks with a full-points attempt
    attempts_per_solved: float | None  # graded attempts up to the first full-points one
    heavy_help_share: float | None  # solved tasks solved after hint level ≥ 2 or a reveal
    reveals: int  # tasks whose solution was revealed
    theory_questions: int  # tutor messages on the topic's theory pages
    task_questions: int  # tutor messages on the topic's tasks
    lessons: Lessons
    reading_minutes: int
    last_practised: date | None  # last graded attempt (UTC)


@dataclass(frozen=True)
class TopicInsight:
    topic_id: str
    status: Status
    reasons: TopicReasons


@dataclass(frozen=True)
class PracticeItem:
    task_id: str
    topic_id: str
    ege_task: int | None
    reason: Status  # the topic status that put the task in the set
    done: bool  # solved today


@dataclass(frozen=True)
class Mistake:
    task_id: str
    ege_task: int | None
    topic_ids: tuple[str, ...]
    mistake_on: date
    due_on: date
    due: bool


@dataclass(frozen=True)
class ScoreRange:
    low: int
    expected: int
    high: int


@dataclass(frozen=True)
class NumberPrediction:
    number: int
    part: int
    max_points: int
    expected: float | None  # expected points; None without evidence
    basis: Literal["mastery", "variants", "blend", "none"]
    mastery_tasks: int  # graded tasks behind the number's topic mastery (Part 1)
    variant_runs: int  # recent runs with a result for this number


@dataclass(frozen=True)
class Prediction:
    enough_data: bool
    max_primary: int
    primary: ScoreRange | None  # None when there is not enough data
    test: ScoreRange | None  # None without enough data or a verified score scale
    scale_season: int | None
    per_number: tuple[NumberPrediction, ...]
    missing_numbers: tuple[int, ...]
    graded_tasks_needed: int


# --- per-task facts ---------------------------------------------------------------------------


def _full(a: AttemptRow) -> bool:
    return a.outcome in GRADED and a.max_points > 0 and a.points >= a.max_points


@dataclass
class TaskFacts:
    first: AttemptRow | None = None  # first graded attempt
    graded: int = 0
    solved_at: datetime | None = None  # first full-points attempt
    attempts_to_solve: int = 0  # graded attempts up to and including `solved_at`
    last_full_at: datetime | None = None
    revealed: bool = False
    revealed_before_solve: bool = False
    last_graded_at: datetime | None = None


def task_facts(attempts: Iterable[AttemptRow]) -> dict[str, TaskFacts]:
    """`attempts` in chronological order."""
    out: dict[str, TaskFacts] = defaultdict(TaskFacts)
    for a in attempts:
        f = out[a.task_id]
        if a.outcome == "revealed":
            f.revealed = True
            if f.solved_at is None:
                f.revealed_before_solve = True
            continue
        if a.outcome not in GRADED:
            continue
        f.graded += 1
        f.last_graded_at = a.at
        if f.first is None:
            f.first = a
        if _full(a):
            if f.solved_at is None:
                f.solved_at = a.at
                f.attempts_to_solve = f.graded
            f.last_full_at = a.at
    return dict(out)


# --- topic statuses ---------------------------------------------------------------------------


def classify(
    mastery: float | None,
    graded: int,
    solved: int,
    heavy_help_share: float | None,
    attempts_per_solved: float | None,
    last_practised: date | None,
    today: date,
) -> Status:
    """First match wins: not started, weak, shaky, review due, strong, otherwise in progress."""
    if graded == 0 or mastery is None:
        return "not_started"
    if graded >= MIN_EVIDENCE and mastery < WEAK_BELOW:
        return "weak"
    if solved >= SHAKY_MIN_SOLVED and (
        (heavy_help_share or 0) >= SHAKY_HELP_SHARE or (attempts_per_solved or 0) >= SHAKY_ATTEMPTS
    ):
        return "shaky"
    if graded >= MIN_EVIDENCE and mastery >= STRONG_AT:
        stale = last_practised is not None and (today - last_practised).days >= REVIEW_AFTER_DAYS
        return "review_due" if stale else "strong"
    return "in_progress"


def study_order(roadmap: Roadmap) -> list[Topic]:
    """Topics in study order: sections as authored, a topic's prerequisites from the same
    section first (as `orderedTopics` in web/src/lib/content.ts)."""
    section_of = {t.id: s.id for s in roadmap.sections for t in s.topics}
    by_id = {t.id: t for t in roadmap.topics()}
    out: list[Topic] = []
    seen: set[str] = set()

    def visit(t: Topic) -> None:
        if t.id in seen:
            return
        seen.add(t.id)
        for p in t.prereqs:
            if p in by_id and section_of[p] == section_of[t.id]:
                visit(by_id[p])
        out.append(t)

    for t in roadmap.topics():
        visit(t)
    return out


def _page_topic(page_id: str) -> str:
    return page_id.split("/", 1)[0]


def _ratio(num: float, den: float) -> float | None:
    return round(num / den, 3) if den else None


def mastery_of(ev: EvidenceBundle) -> dict[str, TopicMastery]:
    return compute_mastery(
        Evidence(a.task_id, t.topics, a.outcome, a.points, a.max_points)
        for a in ev.attempts
        if (t := ev.tasks.get(a.task_id)) is not None
    )


def topic_insights(roadmap: Roadmap, ev: EvidenceBundle, today: date) -> list[TopicInsight]:
    """Every roadmap topic in study order, with its status and the numbers behind it."""
    facts = task_facts(ev.attempts)
    mastery = mastery_of(ev)

    hint_level: dict[str, int] = defaultdict(int)
    task_q: dict[str, int] = defaultdict(int)
    theory_q: dict[str, int] = defaultdict(int)
    for th in ev.threads:
        if th.kind == "task":
            hint_level[th.context_id] = max(hint_level[th.context_id], th.hint_level)
            for tp in ev.tasks[th.context_id].topics if th.context_id in ev.tasks else ():
                task_q[tp] += th.questions
        elif th.kind == "theory":
            theory_q[_page_topic(th.context_id)] += th.questions

    # Merged duplicate rows: sum per page first.
    pages: dict[str, tuple[int, int, bool]] = {}
    for v in ev.visits:
        visits, active, finished = pages.get(v.page_id, (0, 0, False))
        pages[v.page_id] = (visits + v.visits, active + v.active_s, finished or v.finished)

    by_topic: dict[str, list[str]] = defaultdict(list)
    for tid, f in facts.items():
        info = ev.tasks.get(tid)
        if info is None or (f.graded == 0 and not f.revealed):
            continue
        for tp in info.topics:
            by_topic[tp].append(tid)

    out: list[TopicInsight] = []
    for topic in study_order(roadmap):
        tids = by_topic.get(topic.id, [])
        graded = [facts[t] for t in tids if facts[t].first is not None]
        solved = [facts[t] for t in tids if facts[t].solved_at is not None]
        heavy = [
            t
            for t in tids
            if facts[t].solved_at is not None
            and (facts[t].revealed_before_solve or hint_level[t] >= HEAVY_HINT_LEVEL)
        ]
        first_try = sum(
            f.first.points / f.first.max_points
            for f in graded
            if f.first is not None and f.first.max_points
        )
        last = max((f.last_graded_at for f in graded if f.last_graded_at), default=None)
        own_pages = list(ev.theory_pages.get(topic.id, ()))
        seen_pages = {p: v for p, v in pages.items() if _page_topic(p) == topic.id}
        m = mastery.get(topic.id)
        reasons = TopicReasons(
            mastery=round(m.score, 3) if m else None,
            graded_tasks=len(graded),
            first_try_accuracy=_ratio(first_try, len(graded)),
            solved_tasks=len(solved),
            attempts_per_solved=_ratio(sum(f.attempts_to_solve for f in solved), len(solved)),
            heavy_help_share=_ratio(len(heavy), len(solved)),
            reveals=sum(1 for t in tids if facts[t].revealed),
            theory_questions=theory_q[topic.id],
            task_questions=task_q[topic.id],
            lessons=Lessons(
                total=len(own_pages),
                opened=sum(1 for p in own_pages if p in seen_pages),
                finished=sum(1 for p in own_pages if seen_pages.get(p, (0, 0, False))[2]),
            ),
            reading_minutes=round(sum(v[1] for v in seen_pages.values()) / 60),
            last_practised=last.date() if last else None,
        )
        status = classify(
            reasons.mastery,
            reasons.graded_tasks,
            reasons.solved_tasks,
            reasons.heavy_help_share,
            reasons.attempts_per_solved,
            reasons.last_practised,
            today,
        )
        out.append(TopicInsight(topic.id, status, reasons))
    return out


def teaser_topic(topics: Sequence[TopicInsight]) -> TopicInsight | None:
    """What a free profile shows in full: the first weak topic, else the first shaky one."""
    for status in ("weak", "shaky"):
        for t in topics:
            if t.status == status:
                return t
    return None


# --- weak-spot practice set -------------------------------------------------------------------

_GROUP: dict[str, int] = {"weak": 0, "shaky": 0, "review_due": 1, "in_progress": 2}


def _day_hash(day: date, task_id: str) -> str:
    return hashlib.sha256(f"{day.isoformat()}:{task_id}".encode()).hexdigest()


def practice_set(roadmap: Roadmap, ev: EvidenceBundle, now: datetime) -> list[PracticeItem]:
    """5–10 bank tasks for today, picked from the evidence as of the start of the day (UTC),
    so the set stays put while the student works through it; tasks solved today are `done`.

    Unsolved tasks of weak and shaky topics first, then tasks of review-due topics (unsolved
    first), topping up from in-progress topics when that gives fewer than PRACTICE_MIN.
    Within a group: study order (prerequisites first), easiest first, then a per-day shuffle.
    """
    today = now.date()
    start = datetime.combine(today, datetime.min.time(), tzinfo=now.tzinfo)
    morning = EvidenceBundle(
        tasks=ev.tasks,
        attempts=[a for a in ev.attempts if a.at < start],
        threads=ev.threads,
        theory_pages=ev.theory_pages,
    )
    statuses = {t.topic_id: t.status for t in topic_insights(roadmap, morning, today)}
    order = {t.id: i for i, t in enumerate(study_order(roadmap))}
    facts_before = task_facts(morning.attempts)
    solved_before = {t for t, f in facts_before.items() if f.solved_at is not None}
    solved_today = {a.task_id for a in ev.attempts if a.at >= start and _full(a)}

    ranked: list[tuple[tuple[int, int, int, int, str], PracticeItem]] = []
    for info in ev.tasks.values():
        if info.ege_task is None or not info.published:
            continue
        options = [
            (_GROUP[statuses[t]], order[t], t)
            for t in info.topics
            if t in order and statuses.get(t) in _GROUP
        ]
        if not options:
            continue
        group, idx, topic = min(options)
        solved = info.id in solved_before
        if solved and group != 1:
            continue
        item = PracticeItem(info.id, topic, info.ege_task, statuses[topic], info.id in solved_today)
        ranked.append(((group, idx, int(solved), info.difficulty, _day_hash(today, info.id)), item))
    ranked.sort(key=lambda r: r[0])

    picked: list[PracticeItem] = []
    per_topic: dict[str, int] = defaultdict(int)
    for key, item in ranked:
        if len(picked) >= PRACTICE_MAX or (key[0] == 2 and len(picked) >= PRACTICE_MIN):
            break
        if per_topic[item.topic_id] >= PRACTICE_PER_TOPIC:
            continue
        per_topic[item.topic_id] += 1
        picked.append(item)
    return picked


# --- mistakes notebook ------------------------------------------------------------------------


def mistakes(ev: EvidenceBundle, today: date) -> list[Mistake]:
    """Tasks whose first graded attempt lost points (wrong, or partial on a 2-point task).
    Each comes back MISTAKE_RETRY_DAYS later and leaves once solved with full points on a
    later calendar day (UTC) than the mistake; a same-day retry does not count."""
    out: list[Mistake] = []
    for tid, f in task_facts(ev.attempts).items():
        info = ev.tasks.get(tid)
        if info is None or not info.published or f.first is None or _full(f.first):
            continue
        made = f.first.at.date()
        if f.last_full_at is not None and f.last_full_at.date() > made:
            continue
        due_on = made + timedelta(days=MISTAKE_RETRY_DAYS)
        out.append(Mistake(tid, info.ege_task, info.topics, made, due_on, today >= due_on))
    out.sort(key=lambda m: (not m.due, m.due_on, m.task_id))
    return out


# --- predicted score --------------------------------------------------------------------------


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def predict(
    exam: ExamSpec,
    roadmap: Roadmap,
    ev: EvidenceBundle,
    mastery: Mapping[str, TopicMastery] | None = None,
) -> Prediction:
    """Expected primary points per EGE number, summed into a range and converted with the
    exam's score scale.

    Part 1: the evidence-weighted mastery of the number's topics, blended with the number's
    results in the latest RECENT_RUNS variant runs (weight VARIANT_WEIGHT_PER_RUN per run, at
    most VARIANT_WEIGHT_MAX). Part 2 is not auto-checked outside variants, so it comes from the
    self-assessment in variant runs only. A number without evidence takes its part's average
    and the widest variance. Results of tasks out of this season's plan are skipped.
    """
    mastery = mastery_of(ev) if mastery is None else mastery
    runs = sorted(ev.runs, key=lambda r: r.at, reverse=True)[:RECENT_RUNS]
    variant: dict[int, list[float]] = defaultdict(list)
    for run in runs:
        per_run: dict[int, list[float]] = defaultdict(list)
        for r in run.results:
            info = ev.tasks.get(r.task_id)
            if r.points is None or r.max_points <= 0 or info is None or not info.in_season:
                continue
            per_run[r.ege_task].append(r.points / r.max_points)
        for n, xs in per_run.items():
            variant[n].append(sum(xs) / len(xs))

    numbers: list[NumberPrediction] = []
    p: dict[int, float] = {}
    for n, spec in sorted(exam.tasks.items()):
        m_tasks, m_score = 0, 0.0
        if spec.part == 1:
            for t in roadmap.topics():
                if n in t.ege_tasks and t.id in mastery:
                    m_tasks += mastery[t.id].n
                    m_score += mastery[t.id].score * mastery[t.id].n
        vs = variant.get(n, [])
        basis: Literal["mastery", "variants", "blend", "none"]
        if m_tasks and vs:
            w = min(VARIANT_WEIGHT_PER_RUN * len(vs), VARIANT_WEIGHT_MAX)
            p[n] = w * sum(vs) / len(vs) + (1 - w) * m_score / m_tasks
            basis = "blend"
        elif m_tasks:
            p[n], basis = m_score / m_tasks, "mastery"
        elif vs:
            p[n], basis = sum(vs) / len(vs), "variants"
        else:
            basis = "none"
        numbers.append(
            NumberPrediction(
                number=n,
                part=spec.part,
                max_points=spec.max_points,
                expected=round(p[n] * spec.max_points, 2) if n in p else None,
                basis=basis,
                mastery_tasks=m_tasks,
                variant_runs=len(vs),
            )
        )

    part_mean: dict[int, float] = {}
    for part in (1, 2):
        got = [(p[x.number], x.max_points) for x in numbers if x.part == part and x.number in p]
        weight = sum(w for _, w in got)
        part_mean[part] = sum(q * w for q, w in got) / weight if weight else 0.0
    mean = var = 0.0
    for x in numbers:
        if x.number in p:
            q = p[x.number]
            var += x.max_points**2 * q * (1 - q)
        else:
            q = part_mean[x.part]
            var += x.max_points**2 / 4
        mean += q * x.max_points

    max_primary = exam.max_score
    covered = sum(x.max_points for x in numbers if x.number in p)
    graded = sum(1 for f in task_facts(ev.attempts).values() if f.first is not None)
    enough = covered >= PREDICTION_MIN_COVERAGE * max_primary and graded >= PREDICTION_MIN_TASKS
    primary = test = None
    if enough:
        sd = math.sqrt(var)

        def clamp(x: float) -> int:
            return min(max(_round(x), 0), max_primary)

        primary = ScoreRange(
            clamp(mean - PREDICTION_Z * sd), clamp(mean), clamp(mean + PREDICTION_Z * sd)
        )
        if exam.score_scale is not None:
            s = exam.score_scale
            test = ScoreRange(s[primary.low], s[primary.expected], s[primary.high])
    return Prediction(
        enough_data=enough,
        max_primary=max_primary,
        primary=primary,
        test=test,
        scale_season=exam.score_scale_season if exam.score_scale is not None else None,
        per_number=tuple(numbers),
        missing_numbers=tuple(x.number for x in numbers if x.number not in p),
        graded_tasks_needed=max(0, PREDICTION_MIN_TASKS - graded),
    )
