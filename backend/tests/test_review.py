"""4.5 — POST /sessions/{id}/review: finished 세션만, 틀린 문제 해설 + AI 노트, 실패 시 빈 문자열."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.gemini_client import FakeGeminiClient, GeminiError
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore

API = "/api/v1"


@pytest.fixture
def fake() -> FakeGeminiClient:
    return FakeGeminiClient()


@pytest.fixture
def ai_client(
    settings: Settings,
    question_bank: QuestionBank,
    session_store: InMemorySessionStore,
    fake: FakeGeminiClient,
) -> Iterator[TestClient]:
    app = create_app(
        settings,
        question_bank=question_bank,
        session_store=session_store,
        gemini_client=fake,
        build_variants_on_startup=False,
    )
    with TestClient(app) as client:
        yield client


def play_with_two_wrong(
    client: TestClient, store: InMemorySessionStore
) -> tuple[str, dict[str, str], list[str]]:
    created = client.post(f"{API}/sessions", json={"nickname": "복습왕"}).json()
    sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
    batch = client.post(
        f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers
    ).json()["quizBatch"]
    q1, q2, q3 = (item["quizId"] for item in batch[:3])
    correct = {q: store.get(sid).quizzes[q].correct_index for q in (q1, q2, q3)}

    def answer(quiz_id: str, choice: int):
        return client.post(
            f"{API}/sessions/{sid}/quiz/answer",
            json={"quizId": quiz_id, "choiceIndex": choice, "answeredMs": 3000, "wave": 1},
            headers=headers,
        )

    answer(q1, (correct[q1] + 1) % 4)  # 오답
    answer(q2, -1)  # 시간 초과
    answer(q3, correct[q3])  # 정답
    return sid, headers, [q1, q2]


def test_review_requires_finished_session(
    ai_client: TestClient, session_store: InMemorySessionStore
) -> None:
    sid, headers, _ = play_with_two_wrong(ai_client, session_store)
    response = ai_client.post(f"{API}/sessions/{sid}/review", headers=headers)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_review_returns_items_with_ai_notes(
    ai_client: TestClient, session_store: InMemorySessionStore, fake: FakeGeminiClient
) -> None:
    sid, headers, wrong_ids = play_with_two_wrong(ai_client, session_store)
    finish = ai_client.post(
        f"{API}/sessions/{sid}/finish",
        json={
            "stagesCleared": 1,
            "wavesCleared": 3,
            "livesLeftAtEnd": 10,
            "coinsLeftAtEnd": 50,
            "clientScore": 0,
        },
        headers=headers,
    )
    assert finish.status_code == 200
    fake.push(
        {
            "items": [
                {
                    "quizId": wrong_ids[0],
                    "aiNote": "온양의 옛 이름은 탕정이에요. 참고 https://x.test",
                },
                {"quizId": wrong_ids[1], "aiNote": "시간이 모자랐네요. 010-1234-5678"},
            ],
            "summary": "온양의 이름 변화를 다시 보면 좋아요.",
        }
    )

    response = ai_client.post(f"{API}/sessions/{sid}/review", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items", "summary"}
    assert [item["quizId"] for item in body["items"]] == wrong_ids
    first, second = body["items"]
    assert set(first) == {
        "quizId",
        "stem",
        "yourAnswer",
        "correctAnswer",
        "explanation",
        "aiNote",
        "retryOptions",
        "retryCorrectIndex",
    }
    assert len(first["retryOptions"]) == 4
    assert first["retryOptions"][first["retryCorrectIndex"]] == first["correctAnswer"]
    assert first["yourAnswer"] != first["correctAnswer"]
    assert second["yourAnswer"] == "시간 초과"
    assert "https" not in first["aiNote"] and "탕정" in first["aiNote"]
    assert "010" not in second["aiNote"]
    assert body["summary"].startswith("온양의 이름")
    prompt = fake.calls[0]["prompt"]
    assert wrong_ids[0] in prompt and "정답:" in prompt and "근거:" in prompt


def test_review_degrades_gracefully_when_ai_fails(
    ai_client: TestClient, session_store: InMemorySessionStore, fake: FakeGeminiClient
) -> None:
    sid, headers, wrong_ids = play_with_two_wrong(ai_client, session_store)
    ai_client.post(
        f"{API}/sessions/{sid}/finish",
        json={
            "stagesCleared": 0,
            "wavesCleared": 0,
            "livesLeftAtEnd": 0,
            "coinsLeftAtEnd": 0,
            "clientScore": 0,
        },
        headers=headers,
    )
    fake.push(GeminiError("down"))
    body = ai_client.post(f"{API}/sessions/{sid}/review", headers=headers).json()
    assert [item["quizId"] for item in body["items"]] == wrong_ids
    assert all(item["aiNote"] == "" for item in body["items"])
    assert body["summary"] == ""
    assert all(item["explanation"] for item in body["items"])


def test_review_without_wrong_answers(client: TestClient) -> None:
    created = client.post(f"{API}/sessions", json={}).json()
    sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
    client.post(f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers)
    client.post(
        f"{API}/sessions/{sid}/finish",
        json={
            "stagesCleared": 0,
            "wavesCleared": 0,
            "livesLeftAtEnd": 10,
            "coinsLeftAtEnd": 0,
            "clientScore": 0,
        },
        headers=headers,
    )
    body = client.post(f"{API}/sessions/{sid}/review", headers=headers).json()
    assert body["items"] == []
    assert "완벽" in body["summary"]
