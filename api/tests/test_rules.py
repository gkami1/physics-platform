import pytest

from platform_api.mastery import Evidence, compute_mastery
from platform_api.policy import same_origin
from platform_api.profile import normalize_email, normalize_name, normalize_phone, password_ok

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


@pytest.mark.parametrize(
    ("raw", "name"),
    [
        ("Анна", "Анна"),
        ("  анна  ", "анна"),  # case is the user's choice
        ("Анна-Мария", "Анна-Мария"),
        ("Мария   Луиза", "Мария Луиза"),
        ("д'Артаньян", "д'Артаньян"),
        ("Ёж", "Ёж"),
        ("John", "John"),
        ("", None),
        ("   ", None),
        ("R2D2", None),
        ("Анна_", None),
        ("-Анна", None),
        ("Анна--Мария", None),
        ("<script>", None),
        ("Я" * 51, None),
    ],
)
def test_normalize_name(raw: str, name: str | None) -> None:
    assert normalize_name(raw) == name


@pytest.mark.parametrize(
    ("raw", "phone"),
    [
        ("+7 916 123-45-67", "+79161234567"),
        ("8 (916) 123-45-67", "+79161234567"),
        ("79161234567", "+79161234567"),
        ("9161234567", "+79161234567"),
        ("+375 29 123-45-67", "+375291234567"),
        ("+44 20 7946 0958", "+442079460958"),
        ("+7 916 123-45-6", None),  # Russian numbers are 11 digits
        ("12345", None),
        ("4161234567", None),  # bare 10 digits only for Russian mobiles
        ("+0123456789", None),
        ("+1234567890123456", None),
        ("+7916123456a", None),
        ("+7 916 123 45 6²", None),
        ("", None),
    ],
)
def test_normalize_phone(raw: str, phone: str | None) -> None:
    assert normalize_phone(raw) == phone


@pytest.mark.parametrize(
    ("password", "ok"),
    [
        ("12345678", True),
        ("пароль из слов", True),
        ("1234567", False),
        ("        ", False),
        ("x" * 128, True),
        ("x" * 129, False),
    ],
)
def test_password_ok(password: str, ok: bool) -> None:
    assert password_ok(password) is ok
