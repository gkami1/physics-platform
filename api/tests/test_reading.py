from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import select

from platform_api.db import TheoryVisit

from .test_auth import rows

LESSON = "mech.dynamics.newton/force"
OTHER = "mech.kinematics.basics/motion-si"


def ping(client: TestClient, page: str = LESSON, **fields: object) -> int:
    body: dict[str, object] = {"page_id": page, "active_s": 0} | fields
    return client.post("/api/theory/visits", json=body).status_code


def visits(db_url: str) -> list[tuple[object, ...]]:
    stmt = select(
        TheoryVisit.page_id,
        TheoryVisit.visits,
        TheoryVisit.active_s,
        TheoryVisit.finished_at.is_not(None),
        TheoryVisit.user_id.is_not(None),
    ).order_by(TheoryVisit.id)
    return [tuple(r) for r in rows(db_url, stmt)]  # type: ignore[arg-type]


def test_pings_accumulate_per_page(client: TestClient, migrated_db: str) -> None:
    assert ping(client, new_visit=True) == 204
    assert ping(client, active_s=60) == 204
    assert ping(client, active_s=45, finished=True) == 204
    assert ping(client, new_visit=True, active_s=10) == 204
    assert ping(client, OTHER, new_visit=True, active_s=5) == 204
    assert visits(migrated_db) == [
        (LESSON, 2, 115, True, False),
        (OTHER, 1, 5, False, False),
    ]


def test_finished_keeps_the_first_time(client: TestClient, migrated_db: str) -> None:
    ping(client, finished=True)
    first = rows(migrated_db, select(TheoryVisit.finished_at))
    ping(client, finished=True, active_s=30)
    ping(client, finished=False)
    assert rows(migrated_db, select(TheoryVisit.finished_at)) == first


def test_bad_pings_are_rejected(client: TestClient, migrated_db: str) -> None:
    assert ping(client, "no.such/page") == 404
    assert ping(client, active_s=301) == 422
    assert ping(client, active_s=-1) == 422
    assert visits(migrated_db) == []


def test_visits_move_into_the_account(
    client: TestClient, sign_up: Callable[[str], None], migrated_db: str
) -> None:
    ping(client, new_visit=True, active_s=30)
    sign_up("student@example.ru")
    ping(client, active_s=20)
    assert visits(migrated_db) == [(LESSON, 1, 50, False, True)]

    # Signed out, the device starts a fresh anonymous record.
    client.post("/api/auth/logout")
    ping(client, new_visit=True, active_s=5)
    assert visits(migrated_db)[1] == (LESSON, 1, 5, False, False)
