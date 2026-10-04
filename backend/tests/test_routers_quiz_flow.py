"""1.7 — 세션 생성 → 스테이지 시작 → 답변 → 이벤트 → 종료 전체 흐름.

응답 JSON 키·상태 코드·오류 코드는 docs/03_api_contract.md 와 문자 그대로 일치해야 한다.
정답 위치는 응답에 없으므로 세션 저장소를 직접 들여다본다(화이트박스).
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.security import issue_session_token
from app.main import create_app
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore

API = "/api/v1"
QUIZ_ITEM_KEYS = {"quizId", "difficulty", "kind", "stem", "options", "timeLimitSec"}
ANSWER_KEYS = {
    "correct",
    "correctIndex",
    "explanation",
    "coins",
    "breakdown",
    "combo",
    "comboMax",
    "coinsFromQuiz",
}
LEAK_KEYS = ("correctIndex", "answerIndex", "fact", "chatbotContext")
EVENT_AT = "2026-10-01T02:11:05Z"


@pytest.fixture
def game(client: TestClient) -> dict:
    response = client.post(f"{API}/sessions", json={"nickname": "테스터"})
    assert response.status_code == 201
    data = response.json()
    return {
        "sid": data["sessionId"],
        "token": data["token"],
        "headers": {"X-Session-Token": data["token"]},
    }


def _start(client: TestClient, game: dict, stage: int = 1, *, retry: bool = False):
    return client.post(
        f"{API}/sessions/{game['sid']}/stages/{stage}/start",
        json={"retry": retry},
        headers=game["headers"],
    )


def _answer(client: TestClient, game: dict, quiz_id: str, choice: int, *, ms: int = 4200):
    return client.post(
        f"{API}/sessions/{game['sid']}/quiz/answer",
        json={"quizId": quiz_id, "choiceIndex": choice, "answeredMs": ms, "wave": 1},
        headers=game["headers"],
    )


def _event(client: TestClient, game: dict, type_: str, *, stage: int = 1, wave: int = 2):
    return client.post(
        f"{API}/sessions/{game['sid']}/events",
        json={"type": type_, "stageOrder": stage, "wave": wave, "at": EVENT_AT},
        headers=game["headers"],
    )


def _finish(client: TestClient, game: dict, **overrides):
    body = {
        "stagesCleared": 1,
        "wavesCleared": 3,
        "livesLeftAtEnd": 10,
        "coinsLeftAtEnd": 100,
        "clientScore": 0,
    }
    body.update(overrides)
    return client.post(f"{API}/sessions/{game['sid']}/finish", json=body, headers=game["headers"])


def _correct_index(session_store: InMemorySessionStore, game: dict, quiz_id: str) -> int:
    return session_store.get(game["sid"]).quizzes[quiz_id].correct_index


# ---------- 1. topics ----------


def test_topics_match_contract(client: TestClient) -> None:
    response = client.get(f"{API}/topics")
    assert response.status_code == 200
    topics = response.json()
    assert len(topics) == 5
    assert [t["order"] for t in topics] == [1, 2, 3, 4, 5]
    assert set(topics[0]) == {"id", "order", "title", "subtitle", "era", "keywords", "cards"}
    assert set(topics[0]["cards"][0]) == {"id", "title", "body"}
    assert "chatbotContext" not in response.text


# ---------- 2. sessions ----------


def test_create_session_matches_contract(client: TestClient) -> None:
    response = client.post(f"{API}/sessions", json={"nickname": "역사탐험가"})
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"sessionId", "token", "expiresAt", "boothMode"}
    assert body["boothMode"] is True
    assert body["token"].startswith(body["sessionId"] + ".")

    no_body = client.post(f"{API}/sessions")
    assert no_body.status_code == 201


# ---------- 3. 인증 ----------


def test_session_endpoints_require_matching_token(client: TestClient, game: dict) -> None:
    url = f"{API}/sessions/{game['sid']}/stages/1/start"
    missing = client.post(url, json={"retry": False})
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "UNAUTHORIZED"

    bogus = client.post(url, json={"retry": False}, headers={"X-Session-Token": "a.b.c"})
    assert bogus.status_code == 401

    other = client.post(
        f"{API}/sessions/s_other/stages/1/start", json={"retry": False}, headers=game["headers"]
    )
    assert other.status_code == 401
    assert other.json()["error"]["code"] == "UNAUTHORIZED"


def test_expired_token_is_session_expired(
    client: TestClient, game: dict, settings: Settings
) -> None:
    expired = issue_session_token(
        game["sid"], datetime.now(UTC) - timedelta(hours=1), settings.session_secret
    )
    response = client.post(
        f"{API}/sessions/{game['sid']}/stages/1/start",
        json={"retry": False},
        headers={"X-Session-Token": expired},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


# ---------- 4. stages/start ----------


def test_start_stage_matches_contract(client: TestClient, game: dict) -> None:
    response = _start(client, game)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"stageOrder", "topicId", "wavesPerStage", "quizBatch"}
    assert (body["stageOrder"], body["topicId"], body["wavesPerStage"]) == (1, "onyang", 3)

    batch = body["quizBatch"]
    assert len(batch) == 15  # 주제당 원본 15문항 → 첫 배치는 15 (docs/03 출제 우선순위)
    for item in batch:
        assert set(item) == QUIZ_ITEM_KEYS
        assert len(item["options"]) == 4
        assert item["timeLimitSec"] == 15
        assert item["difficulty"] in (1, 2, 3)
    assert len({item["quizId"] for item in batch}) == 15
    assert Counter(item["kind"] for item in batch) == {"normal": 10, "emergency": 2, "rush": 3}
    for key in LEAK_KEYS:
        assert key not in response.text


def test_start_stage_out_of_range(client: TestClient, game: dict) -> None:
    response = _start(client, game, stage=6)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ---------- 5. quiz/answer ----------


def test_answer_flow_matches_contract(
    client: TestClient, game: dict, session_store: InMemorySessionStore
) -> None:
    batch = _start(client, game).json()["quizBatch"]
    q1, q2, q3, q4 = (item["quizId"] for item in batch[:4])  # 웨이브 1 normal 문항들

    first = _answer(client, game, q1, _correct_index(session_store, game, q1))
    assert first.status_code == 200
    body = first.json()
    assert set(body) == ANSWER_KEYS
    assert body["correct"] is True
    assert body["coins"] == 40  # 30 × 1 + 빠른 정답 10
    assert body["combo"] == 1
    assert body["breakdown"] == {"base": 30, "comboMult": 1, "fastBonus": 10, "eventMult": 1}

    second = _answer(client, game, q2, _correct_index(session_store, game, q2)).json()
    assert second["coins"] == 70  # 03 예시: 30 × 2 + 10
    assert second["combo"] == 2
    assert second["coinsFromQuiz"] == 110
    assert second["breakdown"] == {"base": 30, "comboMult": 2, "fastBonus": 10, "eventMult": 1}

    correct3 = _correct_index(session_store, game, q3)
    wrong = _answer(client, game, q3, (correct3 + 1) % 4).json()
    assert wrong["correct"] is False
    assert wrong["coins"] == 0
    assert wrong["combo"] == 0
    assert wrong["comboMax"] == 2
    assert wrong["correctIndex"] == correct3
    assert wrong["explanation"]

    timeout = _answer(client, game, q4, -1).json()
    assert timeout["correct"] is False
    assert timeout["coins"] == 0

    again = _answer(client, game, q1, 0)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "VALIDATION_ERROR"

    missing = _answer(client, game, "q_missing", 0)
    assert missing.status_code == 404

    too_slow = _answer(client, game, q2, 0, ms=70_000)
    assert too_slow.status_code == 422
    assert too_slow.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------- 6. events ----------


def test_events_caps_and_double_coin(
    client: TestClient, game: dict, session_store: InMemorySessionStore
) -> None:
    batch = _start(client, game).json()["quizBatch"]

    midboss = _event(client, game, "MIDBOSS_DEFEATED")
    assert midboss.status_code == 200
    body = midboss.json()
    assert set(body) == {"accepted", "activeEvents"}
    assert body["accepted"] is True
    assert body["activeEvents"][0]["type"] == "DOUBLE_COIN_TIME"
    assert body["activeEvents"][0]["until"]

    quiz_id = batch[0]["quizId"]
    boosted = _answer(client, game, quiz_id, _correct_index(session_store, game, quiz_id)).json()
    assert boosted["coins"] == 80  # (30 × 1 + 10) × 2
    assert boosted["breakdown"]["eventMult"] == 2

    assert _event(client, game, "MIDBOSS_DEFEATED").json()["accepted"] is False

    for wave in (1, 2, 3):
        assert _event(client, game, "WAVE_CLEARED", wave=wave).json()["accepted"] is True
    assert _event(client, game, "WAVE_CLEARED", wave=3).json()["accepted"] is False

    not_started = _event(client, game, "WAVE_CLEARED", stage=2, wave=1)
    assert not_started.status_code == 422

    assert _event(client, game, "LEARN_COMPLETED", stage=2, wave=0).json()["accepted"] is True
    assert _event(client, game, "LEARN_COMPLETED", stage=2, wave=0).json()["accepted"] is False

    hack = _event(client, game, "HACK")
    assert hack.status_code == 422
    assert hack.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------- 7. 재도전 ----------


def test_retry_resets_event_caps_and_serves_new_quiz_ids(client: TestClient, game: dict) -> None:
    first_batch = _start(client, game).json()["quizBatch"]
    assert _event(client, game, "MIDBOSS_DEFEATED").json()["accepted"] is True
    assert _event(client, game, "MIDBOSS_DEFEATED").json()["accepted"] is False

    retry = _start(client, game, retry=True)
    assert retry.status_code == 200
    second_batch = retry.json()["quizBatch"]
    assert len(second_batch) >= 1
    first_ids = {item["quizId"] for item in first_batch}
    assert all(item["quizId"] not in first_ids for item in second_batch)

    assert _event(client, game, "MIDBOSS_DEFEATED").json()["accepted"] is True


# ---------- 8. quiz/more ----------


def test_quiz_more_matches_contract(client: TestClient, game: dict) -> None:
    _start(client, game)
    url = f"{API}/sessions/{game['sid']}/quiz/more"

    response = client.get(
        url, params={"stage": 1, "count": 3, "kind": "emergency"}, headers=game["headers"]
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"quizBatch"}
    assert len(body["quizBatch"]) == 3
    assert all(item["kind"] == "emergency" for item in body["quizBatch"])
    assert all(set(item) == QUIZ_ITEM_KEYS for item in body["quizBatch"])

    too_many = client.get(url, params={"stage": 1, "count": 11}, headers=game["headers"])
    assert too_many.status_code == 422

    not_started = client.get(url, params={"stage": 3, "count": 2}, headers=game["headers"])
    assert not_started.status_code == 409


# ---------- 9. finish ----------


def test_finish_matches_contract(
    client: TestClient, game: dict, session_store: InMemorySessionStore
) -> None:
    batch = _start(client, game).json()["quizBatch"]
    q1, q2, q3, q4 = (item["quizId"] for item in batch[:4])
    _answer(client, game, q1, _correct_index(session_store, game, q1))
    _answer(client, game, q2, _correct_index(session_store, game, q2))
    _answer(client, game, q3, (_correct_index(session_store, game, q3) + 1) % 4)
    _answer(client, game, q4, -1)

    response = _finish(client, game)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "score",
        "breakdown",
        "correctCount",
        "answeredCount",
        "comboMax",
        "stageReached",
        "wrongQuizIds",
    }
    # 2×100 + 콤보 2×50 + 3웨이브×150 + 1스테이지×500 + 체력 10×30 + 코인 100
    assert body["breakdown"] == {
        "correct": 200,
        "combo": 100,
        "waves": 450,
        "stages": 500,
        "lives": 300,
        "coins": 100,
    }
    assert body["score"] == 1650
    assert (body["correctCount"], body["answeredCount"], body["comboMax"]) == (2, 4, 2)
    assert body["stageReached"] == 1
    assert set(body["wrongQuizIds"]) == {q3, q4}

    assert _finish(client, game).status_code == 409
    assert _answer(client, game, batch[4]["quizId"], 0).status_code == 409
    assert _event(client, game, "WAVE_CLEARED", wave=1).status_code == 409


def test_finish_rejects_impossible_report(client: TestClient, game: dict) -> None:
    _start(client, game)
    response = _finish(client, game, stagesCleared=2)
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "SCORE_REJECTED"
    assert set(body["error"]) == {"code", "message"}
    assert "stagesCleared" not in response.text  # 사유는 로그 전용


# ---------- 10. 전체 모드 ----------


def test_full_mode_uses_five_waves(settings: Settings, question_bank: QuestionBank) -> None:
    full = settings.model_copy(update={"booth_mode": False})
    app = create_app(full, question_bank=question_bank, session_store=InMemorySessionStore())
    with TestClient(app) as client:
        created = client.post(f"{API}/sessions", json={"nickname": "풀모드"}).json()
        assert created["boothMode"] is False
        started = client.post(
            f"{API}/sessions/{created['sessionId']}/stages/1/start",
            json={"retry": False},
            headers={"X-Session-Token": created["token"]},
        ).json()
        assert started["wavesPerStage"] == 5
        assert len(started["quizBatch"]) == 15
