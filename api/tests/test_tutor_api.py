import asyncio
import json
from collections.abc import AsyncIterator, Sequence

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from content_schema.checking import format_answer
from platform_api.content import ContentStore
from platform_api.db import LlmCall, User, make_engine
from platform_api.hints import LadderState
from platform_api.llm import CallInfo, FailingModel, LLMUnavailableError, Message, ScriptedModel
from platform_api.turn import plan_theory_turn
from platform_api.tutor import LEAK_NOTE, THEORY_LEAK_NOTE, TRUNCATED_NOTE, _PendingTurn, _save_turn


def events(body: str) -> list[tuple[str, dict[str, object]]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def ask(
    client: TestClient, text: str = "С чего начать?", intent: str = "message", **kw: str
) -> list[tuple[str, dict[str, object]]]:
    body = {"kind": kw.get("kind", "task"), "id": kw.get("id", "kin-0001"), "text": text}
    r = client.post("/api/tutor/messages", json={**body, "intent": intent})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    return events(r.text)


def reply_text(evs: list[tuple[str, dict[str, object]]]) -> str:
    return "".join(str(d["text"]) for e, d in evs if e == "delta")


def use_model(client: TestClient, *models: object) -> None:
    client.app.state.llm = list(models)  # type: ignore[attr-defined]


def llm_calls(db_url: str) -> list[tuple[str, str | None, int | None]]:
    async def run() -> list[tuple[str, str | None, int | None]]:
        engine = make_engine(db_url)
        async with engine.connect() as conn:
            rows = await conn.execute(
                select(LlmCall.provider, LlmCall.error, LlmCall.message_id).order_by(LlmCall.id)
            )
            result = [(p, e, m) for p, e, m in rows]
        await engine.dispose()
        return result

    return asyncio.run(run())


def test_tutor_requires_sign_in(client: TestClient) -> None:
    r = client.post("/api/tutor/messages", json={"kind": "task", "id": "kin-0001", "text": "?"})
    assert r.status_code == 401
    assert client.get("/api/tutor/thread?kind=task&id=kin-0001").status_code == 401


def test_conversation_is_streamed_and_saved(signed_in: TestClient, migrated_db: str) -> None:
    use_model(signed_in, ScriptedModel(replies=("Что известно? Что нужно найти?",)))
    evs = ask(signed_in)
    assert evs[0] == ("meta", {"hint_level": 0, "messages_left": 49})
    assert reply_text(evs) == "Что известно? Что нужно найти?"
    assert evs[-1][0] == "done"

    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    assert [(m["role"], m["content"]) for m in thread["messages"]] == [
        ("user", "С чего начать?"),
        ("assistant", "Что известно? Что нужно найти?"),
    ]
    assert thread["messages_left"] == 49
    assert llm_calls(migrated_db) == [("scripted", None, thread["messages"][1]["id"])]


def test_answer_leak_is_cut(signed_in: TestClient) -> None:
    use_model(signed_in, ScriptedModel(replies=("Хорошо. Тогда $v = 12{,}5$ м/с. Понятно?",)))
    evs = ask(signed_in, "Скажи ответ")
    text = reply_text(evs)
    assert "12" not in text
    assert text == "Хорошо." + LEAK_NOTE
    assert evs[-1] == ("done", {"message_id": evs[-1][1]["message_id"], "leak": True})
    saved = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()["messages"][-1]
    assert saved["leak"] is True
    assert "12" not in saved["content"]


def test_hint_ladder_is_server_side(signed_in: TestClient) -> None:
    use_model(signed_in, ScriptedModel(replies=("v = 12,5 м/с.",)))
    levels = [ask(signed_in, intent="hint")[0][1]["hint_level"] for _ in range(3)]
    assert levels == [1, 2, 2]  # level 3 is closed until the student tries
    signed_in.post("/api/tasks/kin-0001/attempts", json={"answer": "10"})
    evs = ask(signed_in, intent="hint")
    assert evs[0][1]["hint_level"] == 3
    assert reply_text(evs) == "v = 12,5 м/с."  # full solution allowed now


def test_hint_request_needs_no_text(signed_in: TestClient) -> None:
    use_model(signed_in, ScriptedModel())
    ask(signed_in, "", intent="hint")
    r = signed_in.post("/api/tutor/messages", json={"kind": "task", "id": "kin-0001", "text": " "})
    assert r.status_code == 422


def test_theory_thread(signed_in: TestClient) -> None:
    model = ScriptedModel(replies=("Сила — мера взаимодействия.",))
    use_model(signed_in, model)
    evs = ask(signed_in, "Что такое сила?", kind="theory", id="mech.dynamics.newton/force")
    assert evs[0][1]["hint_level"] is None
    assert reply_text(evs) == "Сила — мера взаимодействия."
    r = signed_in.post("/api/tutor/messages", json={"kind": "theory", "id": "nope", "text": "?"})
    assert r.status_code == 404


class RecordingModel(ScriptedModel):
    """Scripted replies; keeps the system prompt of every call."""

    def __init__(self, reply: str) -> None:
        super().__init__(replies=(reply,))
        self.systems: list[str] = []

    def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        self.systems.append(messages[0]["content"])
        return super().stream(messages, info)


def test_lesson_has_its_own_thread_and_context(signed_in: TestClient) -> None:
    model = RecordingModel("Путь — длина траектории.")
    use_model(signed_in, model)
    lesson = "mech.kinematics.basics/motion-si"
    evs = ask(signed_in, "Что такое путь?", kind="theory", id=lesson)
    assert reply_text(evs) == "Путь — длина траектории."
    system = model.systems[-1]
    assert "## Урок 1.1. Механическое движение и система СИ" in system
    assert "1.2 Скорость и равномерное движение" in system
    thread = signed_in.get(f"/api/tutor/thread?kind=theory&id={lesson}").json()
    assert len(thread["messages"]) == 2
    # The topic page lists the lessons and has no chat of its own.
    r = signed_in.post(
        "/api/tutor/messages",
        json={"kind": "theory", "id": "mech.kinematics.basics", "text": "?"},
    )
    assert r.status_code == 404


def test_theory_step_answer_is_cut(signed_in: TestClient) -> None:
    store: ContentStore = signed_in.app.state.content  # type: ignore[attr-defined]
    page = store.theory("method.experiment/task20")  # a lesson with step tasks
    assert page is not None
    steps = store.theory_steps(page)
    assert steps, "the page should embed step tasks"
    detector = plan_theory_turn(page, steps).detector
    assert detector is not None
    # A step answer that the page text does not already print.
    answer = next(
        a for t in steps if (a := format_answer(t.answer)) and detector.leaks(f"Ответ {a}.")
    )
    use_model(signed_in, ScriptedModel(replies=(f"Давай проверим. Получится {answer}. Ясно?",)))
    evs = ask(signed_in, "Реши задачу", kind="theory", id=page.id)
    assert reply_text(evs) == "Давай проверим." + THEORY_LEAK_NOTE
    thread = signed_in.get(f"/api/tutor/thread?kind=theory&id={page.id}").json()
    assert thread["messages"][-1]["leak"] is True


def test_fallback_is_traced(signed_in: TestClient, migrated_db: str) -> None:
    use_model(signed_in, FailingModel(), ScriptedModel(replies=("Подумай.",)))
    assert reply_text(ask(signed_in)) == "Подумай."
    calls = llm_calls(migrated_db)
    assert [(p, e is not None) for p, e, _ in calls] == [("failing", True), ("scripted", False)]
    assert calls[0][2] == calls[1][2] is not None  # both attempts linked to the message


def test_all_models_down(signed_in: TestClient, migrated_db: str) -> None:
    use_model(signed_in, FailingModel())
    evs = ask(signed_in, intent="hint")
    assert evs[0] == ("meta", {"hint_level": 1, "messages_left": 49})
    # Nothing counted: the client restores the level and the counter.
    assert evs[-1] == (
        "error",
        {"detail": "tutor_unavailable", "hint_level": 0, "messages_left": 50},
    )
    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    assert (thread["messages"], thread["hint_level"], thread["messages_left"]) == ([], 0, 50)
    assert llm_calls(migrated_db) == [("failing", "LLMUnavailableError: down", None)]
    use_model(signed_in)
    r = signed_in.post("/api/tutor/messages", json={"kind": "task", "id": "kin-0001", "text": "?"})
    assert r.status_code == 503


def test_daily_limit(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    use_model(signed_in, ScriptedModel())
    monkeypatch.setattr(signed_in.app.state.settings, "tutor_daily_messages", 2)  # type: ignore[attr-defined]
    ask(signed_in)
    ask(signed_in)
    r = signed_in.post("/api/tutor/messages", json={"kind": "task", "id": "kin-0001", "text": "?"})
    assert r.status_code == 429
    assert r.json()["detail"] == "daily_limit"


class DyingModel(ScriptedModel):
    """Streams part of a reply, then fails (e.g. the GPU host drops the connection)."""

    async def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        yield "Сначала подумай. Что дано"
        raise LLMUnavailableError("connection reset")


def test_reply_cut_mid_stream_says_so(signed_in: TestClient) -> None:
    use_model(signed_in, DyingModel())
    evs = ask(signed_in, intent="hint")
    assert reply_text(evs) == "Сначала подумай." + TRUNCATED_NOTE
    assert evs[-1][0] == "done"
    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    # The student got (part of) a reply: the turn counts.
    assert thread["messages"][-1]["content"] == "Сначала подумай." + TRUNCATED_NOTE
    assert (thread["hint_level"], thread["messages_left"]) == (1, 49)


class HistoryModel(ScriptedModel):
    """Keeps the dialogue (everything after the system prompt) of every call."""

    def __init__(self) -> None:
        super().__init__(replies=("Подумай.",))
        self.dialogues: list[list[str]] = []

    def stream(self, messages: Sequence[Message], info: CallInfo) -> AsyncIterator[str]:
        self.dialogues.append([m["content"] for m in messages[1:]])
        return super().stream(messages, info)


def test_student_who_left_mid_stream(signed_in: TestClient) -> None:
    """A disconnect saves the turn from the stream's cleanup (`client_gone`)."""
    maker = signed_in.app.state.sessionmaker  # type: ignore[attr-defined]

    async def left(reply: str) -> None:
        async with maker() as s:
            user_id = await s.scalar(select(User.id))  # the only user
        turn = _PendingTurn(user_id, "task", "kin-0001", "Ну?", "hint", 1, LadderState(1, 1))
        await _save_turn(
            maker, turn, reply=reply, reply_flags={"interrupted": True}, calls=(), client_gone=True
        )

    assert signed_in.portal is not None
    signed_in.portal.call(left, "")  # gone before the first sentence
    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    # The model call happened, so the message counts, but no ladder step.
    assert [m["role"] for m in thread["messages"]] == ["user"]
    assert (thread["hint_level"], thread["messages_left"]) == (0, 49)

    model = HistoryModel()
    use_model(signed_in, model)
    ask(signed_in, "Второй вопрос")
    # The unanswered message stays out of the prompt: no two student turns in a row.
    assert len(model.dialogues[0]) == 1

    signed_in.portal.call(left, "Подумай, что дано.")  # gone after a sentence
    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    assert thread["messages"][-1]["content"] == "Подумай, что дано."
    assert thread["hint_level"] == 1


def test_disconnect_mid_stream_saves_the_shown_part(signed_in: TestClient) -> None:
    """Real wiring: the ASGI server reports `http.disconnect` while the reply streams;
    Starlette cancels the response and the shielded cleanup still saves the turn."""
    use_model(signed_in, ScriptedModel(replies=("Подумай, что дано. " * 40,), delay=0.01))
    cookie = "; ".join(f"{k}={v}" for k, v in signed_in.cookies.items())
    body = json.dumps({"kind": "task", "id": "kin-0001", "text": "Ну?"}).encode()
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},  # Starlette listens for disconnect
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/tutor/messages",
        "raw_path": b"/api/tutor/messages",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"cookie", cookie.encode()),
        ],
        "client": ("127.0.0.1", 1),
        "server": ("testserver", 80),
    }
    deltas: list[str] = []

    async def run() -> None:
        import anyio

        delta_seen = anyio.Event()
        sent_body = False

        async def receive() -> dict[str, object]:
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": body, "more_body": False}
            await delta_seen.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict[str, object]) -> None:
            chunk = message.get("body", b"")
            assert isinstance(chunk, bytes)
            if b"event: delta" in chunk:
                deltas.append(chunk.decode())
                delta_seen.set()

        await signed_in.app(scope, receive, send)  # type: ignore[arg-type]

    assert signed_in.portal is not None
    signed_in.portal.call(run)
    assert 0 < len(deltas) < 40  # stopped early
    thread = signed_in.get("/api/tutor/thread?kind=task&id=kin-0001").json()
    assert [m["role"] for m in thread["messages"]] == ["user", "assistant"]
    assert thread["messages"][1]["content"].startswith("Подумай, что дано.")
    assert thread["messages_left"] == 49
