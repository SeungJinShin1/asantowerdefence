"""교사 모드 — POST /sessions/teacher: 교사 코드(서버 환경변수)로 모든 단계가 열리는 교사 세션을 만든다.

지키는 것: 코드가 없으면 꺼짐, 틀린 코드는 거부(코드 미노출), 시도 횟수 제한, 리더보드 등록 불가, 검수용 코인 상한 완화.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.security import limiter
from app.main import create_app
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore

API = "/api/v1"
CODE = "asan-2026"

FINISH = {
    "stagesCleared": 1,
    "wavesCleared": 3,
    "livesLeftAtEnd": 10,
    "coinsLeftAtEnd": 0,
    "clientScore": 0,
}


@pytest.fixture
def teacher_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"teacher_code": CODE})


@pytest.fixture
def teacher_client(
    teacher_settings: Settings, question_bank: QuestionBank, session_store: InMemorySessionStore
) -> Iterator[TestClient]:
    app = create_app(teacher_settings, question_bank=question_bank, session_store=session_store)
    with TestClient(app) as test_client:
        yield test_client


def start_teacher(client: TestClient, code: str = CODE) -> tuple[str, dict[str, str]]:
    created = client.post(f"{API}/sessions/teacher", json={"code": code})
    assert created.status_code == 201, created.text
    body = created.json()
    return body["sessionId"], {"X-Session-Token": body["token"]}


def test_teacher_mode_is_off_without_teacher_code(client: TestClient) -> None:
    """TEACHER_CODE 가 비어 있으면 어떤 값으로도 들어갈 수 없다(빈 문자열 포함)."""
    for code in ("anything", CODE):
        response = client.post(f"{API}/sessions/teacher", json={"code": code})
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
        assert "교사 모드" in response.json()["error"]["message"]


def test_wrong_code_is_rejected_without_leaking_codes(teacher_client: TestClient) -> None:
    response = teacher_client.post(f"{API}/sessions/teacher", json={"code": "wrong-guess"})
    assert response.status_code == 401
    body = response.text
    assert "교사 코드" in response.json()["error"]["message"]
    assert CODE not in body and "wrong-guess" not in body
    assert "token" not in response.json()


def test_code_ignores_case_and_surrounding_spaces(teacher_client: TestClient) -> None:
    """말로 전해 들은 코드를 'Asan-2026' 처럼 입력해도 통과한다. 다른 글자는 여전히 거부."""
    for code in (CODE.upper(), CODE.capitalize(), f"  {CODE} "):
        response = teacher_client.post(f"{API}/sessions/teacher", json={"code": code})
        assert response.status_code == 201, code
    assert (
        teacher_client.post(f"{API}/sessions/teacher", json={"code": CODE + "x"}).status_code == 401
    )
    assert teacher_client.post(f"{API}/sessions/teacher", json={"code": ""}).status_code == 422


def test_correct_code_creates_teacher_session_that_can_open_any_stage(
    teacher_client: TestClient, session_store: InMemorySessionStore
) -> None:
    created = teacher_client.post(f"{API}/sessions/teacher", json={"code": CODE})
    assert created.status_code == 201
    body = created.json()
    assert body["teacher"] is True
    assert body["sessionId"] and body["token"]
    session = session_store.get(body["sessionId"])
    assert session.is_teacher is True
    assert session.nickname == "선생님"

    headers = {"X-Session-Token": body["token"]}
    start = teacher_client.post(
        f"{API}/sessions/{body['sessionId']}/stages/5/start", json={"retry": False}, headers=headers
    )
    assert start.status_code == 200
    assert start.json()["stageOrder"] == 5


def test_normal_session_is_not_teacher(
    teacher_client: TestClient, session_store: InMemorySessionStore
) -> None:
    body = teacher_client.post(f"{API}/sessions", json={"nickname": "학생"}).json()
    assert body["teacher"] is False
    assert session_store.get(body["sessionId"]).is_teacher is False


def test_teacher_session_cannot_register_leaderboard(teacher_client: TestClient) -> None:
    """단계를 건너뛴 교사 기록이 학생 순위에 섞이지 않도록 서버가 막는다."""
    sid, headers = start_teacher(teacher_client)
    teacher_client.post(f"{API}/sessions/{sid}/stages/1/start", json={}, headers=headers)
    assert (
        teacher_client.post(
            f"{API}/sessions/{sid}/finish", json=FINISH, headers=headers
        ).status_code
        == 200
    )
    response = teacher_client.post(
        f"{API}/leaderboard", json={"nickname": "선생님"}, headers=headers
    )
    assert response.status_code == 409
    assert "교사 모드" in response.json()["error"]["message"]
    assert teacher_client.get(f"{API}/leaderboard").json() == []


def test_teacher_finish_clamps_review_coins_instead_of_rejecting(
    teacher_client: TestClient,
) -> None:
    """검수용 '코인 받기'로 코인이 상한을 넘어도 결과 화면은 열려야 한다(점수는 상한으로 계산)."""
    huge = {**FINISH, "coinsLeftAtEnd": 999_999}

    sid, headers = start_teacher(teacher_client)
    teacher_client.post(f"{API}/sessions/{sid}/stages/1/start", json={}, headers=headers)
    finished = teacher_client.post(f"{API}/sessions/{sid}/finish", json=huge, headers=headers)
    assert finished.status_code == 200
    assert finished.json()["breakdown"]["coins"] == 500  # 코인 환산 상한

    student = teacher_client.post(f"{API}/sessions", json={}).json()
    student_headers = {"X-Session-Token": student["token"]}
    teacher_client.post(
        f"{API}/sessions/{student['sessionId']}/stages/1/start", json={}, headers=student_headers
    )
    rejected = teacher_client.post(
        f"{API}/sessions/{student['sessionId']}/finish", json=huge, headers=student_headers
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "SCORE_REJECTED"


def test_teacher_code_attempts_are_rate_limited(
    teacher_settings: Settings, question_bank: QuestionBank
) -> None:
    """코드 맞히기(무차별 대입)를 막기 위해 IP당 5회/분."""
    original = limiter.enabled
    limiter.reset()
    try:
        limited = teacher_settings.model_copy(update={"rate_limit_enabled": True})
        with TestClient(create_app(limited, question_bank=question_bank)) as client:
            statuses = [
                client.post(f"{API}/sessions/teacher", json={"code": f"guess-{i}"}).status_code
                for i in range(6)
            ]
        assert statuses[:5] == [401] * 5
        assert statuses[5] == 429
    finally:
        limiter.enabled = original
        limiter.reset()


def test_teacher_code_is_not_in_healthz(teacher_client: TestClient) -> None:
    assert CODE not in teacher_client.get("/healthz").text


def test_default_teacher_code_is_asan_and_env_can_change_or_disable_it(
    question_bank: QuestionBank,
) -> None:
    """부스 기본 코드는 asan. TEACHER_CODE 로 바꾸면 기본 코드는 통하지 않고, 빈 값이면 꺼진다."""
    base = {"_env_file": None, "app_env": "test", "rate_limit_enabled": False}
    default = Settings(**base)
    assert default.teacher_code == "asan" and default.teacher_enabled

    with TestClient(create_app(default, question_bank=question_bank)) as client:
        assert client.post(f"{API}/sessions/teacher", json={"code": "Asan"}).status_code == 201
        assert client.post(f"{API}/sessions/teacher", json={"code": "onyang"}).status_code == 401

    changed = Settings(**base, teacher_code="other-code")
    with TestClient(create_app(changed, question_bank=question_bank)) as client:
        assert client.post(f"{API}/sessions/teacher", json={"code": "asan"}).status_code == 401
        assert (
            client.post(f"{API}/sessions/teacher", json={"code": "other-code"}).status_code == 201
        )

    off = Settings(**base, teacher_code="")
    assert off.teacher_enabled is False
    with TestClient(create_app(off, question_bank=question_bank)) as client:
        assert client.post(f"{API}/sessions/teacher", json={"code": "asan"}).status_code == 404
