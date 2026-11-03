import pytest

from tutor_evals.checks import Limits, check_reply, cyrillic_share, sentence_count

LIMITS = Limits(max_chars=200, max_sentences=3)


@pytest.mark.parametrize(
    ("text", "share"),
    [
        ("Скорость растёт.", 1.0),
        ("Speed grows.", 0.0),
        ("Вспомни формулу $v = v_0 + at$ и $$s = \\frac{at^2}{2}$$.", 1.0),
        ("Используй `F = ma`, то есть второй закон.", 1.0),
        ("$v = at$", None),
    ],
)
def test_cyrillic_share_ignores_formulas(text: str, share: float | None) -> None:
    assert cyrillic_share(text) == share


@pytest.mark.parametrize(
    ("text", "n"),
    [
        ("", 0),
        ("Одно.", 1),
        ("Одно. Два? Три!", 3),
        ("Одно. Без точки в конце", 2),
        ("Число $12.5$ не делит предложение.", 1),
        ("Подумай… Что дано?", 2),
    ],
)
def test_sentence_count(text: str, n: int) -> None:
    assert sentence_count(text) == n


@pytest.mark.parametrize(
    ("text", "failures"),
    [
        ("Что известно в условии? Что нужно найти?", []),
        ("", ["empty"]),
        ("   \n", ["empty"]),
        ("Let's find the acceleration first. What is given?", ["not_russian"]),
        ("Найдём ускорение. 首先 что дано?", ["cjk"]),
        ("</think> Что известно в условии?", ["think_tag"]),  # stray tag after removal
        ("Раз. Два. Три. Четыре.", ["too_long"]),
        ("Очень " * 40 + "длинно.", ["too_long"]),
        ("Это второй закон Ньютона (Newton's second law): сила и ускорение связаны.", []),
    ],
)
def test_check_reply(text: str, failures: list[str]) -> None:
    assert check_reply(text, LIMITS).failures() == failures


def test_ends_with_question_ignores_trailing_formula() -> None:
    assert check_reply("Чему равно $a$?", LIMITS).ends_with_question
    assert not check_reply("Ускорение равно $a$.", LIMITS).ends_with_question
