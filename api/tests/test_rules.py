import pytest

from platform_api.auth import normalize_email
from platform_api.mastery import Evidence, compute_mastery
from platform_api.policy import same_origin

T = ("topic",)


def ev(
    task: str, outcome: str, points: int, max_points: int = 1, topics: tuple[str, ...] = T
) -> Evidence:
    return Evidence(task, topics, outcome, points, max_points)


@pytest.mark.parametrize(
    ("attempts", "score", "n"),
    [
        ([ev("a", "correct", 1)], 1.0, 1),
        ([ev("a", "wrong", 0)], 0.0, 1),
        ([ev("a", "partial", 1, 2)], 0.5, 1),
        # Only the first graded attempt per task counts.
        ([ev("a", "wrong", 0), ev("a", "correct", 1)], 0.0, 1),
        # Reveals are not evidence.
        ([ev("a", "revealed", 0), ev("a", "correct", 1)], 1.0, 1),
        # First results are averaged equally...
        ([ev("a", "correct", 1), ev("b", "wrong", 0)], 0.5, 2),
        ([ev("a", "correct", 1), ev("b", "wrong", 0), ev("c", "correct", 1)], 2 / 3, 3),
        # ...then recent ones weigh more (alpha floors at 0.3).
        ([ev(str(i), "wrong", 0) for i in range(5)] + [ev("x", "correct", 1)], 0.3, 6),
    ],
)
def test_mastery(attempts: list[Evidence], score: float, n: int) -> None:
    m = compute_mastery(attempts)["topic"]
    assert m.score == pytest.approx(score)
    assert m.n == n


def test_mastery_splits_by_topic() -> None:
    m = compute_mastery(
        [ev("a", "correct", 1, topics=("x", "y")), ev("b", "wrong", 0, topics=("y",))]
    )
    assert (m["x"].score, m["x"].n) == (1.0, 1)
    assert (m["y"].score, m["y"].n) == (0.5, 2)
    assert compute_mastery([]) == {}


@pytest.mark.parametrize(
    ("origin", "host", "ok"),
    [
        (None, "example.ru", True),
        ("https://example.ru", "example.ru", True),
        ("https://EXAMPLE.ru", "example.ru", True),
        ("http://localhost:4321", "localhost:4321", True),
        ("https://evil.ru", "example.ru", False),
        ("https://example.ru.evil.ru", "example.ru", False),
        ("http://localhost:4321", "localhost:8000", False),
        ("null", "example.ru", False),
        ("https://example.ru", None, False),
    ],
)
def test_same_origin(origin: str | None, host: str | None, ok: bool) -> None:
    assert same_origin(origin, host) is ok


@pytest.mark.parametrize(
    ("raw", "email"),
    [
        (" Student@Mail.RU ", "student@mail.ru"),
        ("a.b+c@sub.example.ru", "a.b+c@sub.example.ru"),
        ("no-at-sign", None),
        ("a@b", None),
        ("two@@example.ru", None),
        ("sp ace@example.ru", None),
        ("x" * 250 + "@a.ru", None),
    ],
)
def test_normalize_email(raw: str, email: str | None) -> None:
    assert normalize_email(raw) == email
