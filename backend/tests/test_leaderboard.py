"""5.2 — POST/GET /leaderboard: finished 세션만, 세션당 1회, 닉네임 검증, 순위·정렬."""

from __future__ import annotations

from fastapi.testclient import TestClient
from tests.conftest import TEST_ADMIN_TOKEN

from app.services.session_store import InMemorySessionStore

API = "/api/v1"


def finished_session(
    client: TestClient, store: InMemorySessionStore, *, correct: int = 0
) -> tuple[str, dict[str, str]]:
    created = client.post(f"{API}/sessions", json={}).json()
    sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
    batch = client.post(
        f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers
    ).json()["quizBatch"]
    for item in batch[:correct]:
        quiz = store.get(sid).quizzes[item["quizId"]]
        client.post(
            f"{API}/sessions/{sid}/quiz/answer",
            json={
                "quizId": item["quizId"],
                "choiceIndex": quiz.correct_index,
                "answeredMs": 9000,
                "wave": 1,
            },
            headers=headers,
        )
    client.post(
        f"{API}/sessions/{sid}/finish",
        json={
            "stagesCleared": 1,
            "wavesCleared": 3,
            "livesLeftAtEnd": 10,
            "coinsLeftAtEnd": 0,
            "clientScore": 0,
        },
        headers=headers,
    )
    return sid, headers


def test_register_requires_finished_session(client: TestClient) -> None:
    created = client.post(f"{API}/sessions", json={}).json()
    response = client.post(
        f"{API}/leaderboard",
        json={"nickname": "탐험가"},
        headers={"X-Session-Token": created["token"]},
    )
    assert response.status_code == 409


def test_register_once_and_list_sorted(
    client: TestClient, session_store: InMemorySessionStore
) -> None:
    _, low = finished_session(client, session_store, correct=0)  # 3×150 + 500 + 300 = 1250
    _, high = finished_session(client, session_store, correct=3)  # + 300 + 콤보 3×50 = 1700

    first = client.post(f"{API}/leaderboard", json={"nickname": "  느긋한 거북 "}, headers=low)
    assert first.status_code == 201
    assert first.json() == {"rank": 1, "score": 1250, "nickname": "느긋한 거북"}

    second = client.post(f"{API}/leaderboard", json={"nickname": "번개 토끼"}, headers=high)
    assert second.status_code == 201
    assert second.json()["rank"] == 1
    assert second.json()["score"] > 1250

    again = client.post(f"{API}/leaderboard", json={"nickname": "다른이름"}, headers=low)
    assert again.status_code == 409

    board = client.get(f"{API}/leaderboard?limit=20").json()
    assert [row["nickname"] for row in board] == ["번개 토끼", "느긋한 거북"]
    assert board[0] == {
        "rank": 1,
        "nickname": "번개 토끼",
        "score": second.json()["score"],
        "stageReached": 1,
        "createdAt": board[0]["createdAt"],
    }
    assert set(board[0]) == {"rank", "nickname", "score", "stageReached", "createdAt"}
    assert "sessionId" not in client.get(f"{API}/leaderboard").text
    assert len(client.get(f"{API}/leaderboard?limit=1").json()) == 1
    assert client.get(f"{API}/leaderboard?limit=0").status_code == 422
    assert client.get(f"{API}/leaderboard?limit=51").status_code == 422


def test_register_rejects_bad_nickname_without_echo(
    client: TestClient, session_store: InMemorySessionStore
) -> None:
    _, headers = finished_session(client, session_store)
    for bad in ("가", "nick!", "바보왕", "0101234567"):
        response = client.post(f"{API}/leaderboard", json={"nickname": bad}, headers=headers)
        assert response.status_code == 400, bad
        assert response.json()["error"]["code"] == "NICKNAME_REJECTED"
        assert bad not in response.json()["error"]["message"]
    assert client.get(f"{API}/leaderboard").json() == []


def test_register_requires_token(client: TestClient) -> None:
    assert client.post(f"{API}/leaderboard", json={"nickname": "탐험가"}).status_code == 401


def test_admin_can_reset_leaderboard(
    client: TestClient, session_store: InMemorySessionStore
) -> None:
    _, headers = finished_session(client, session_store)
    assert (
        client.post(
            f"{API}/leaderboard", json={"nickname": "지울기록"}, headers=headers
        ).status_code
        == 201
    )
    assert len(client.get(f"{API}/leaderboard").json()) == 1

    assert client.post(f"{API}/admin/leaderboard/reset").status_code == 401
    reset = client.post(
        f"{API}/admin/leaderboard/reset", headers={"X-Admin-Token": TEST_ADMIN_TOKEN}
    )
    assert reset.status_code == 200
    assert reset.json() == {"removed": 1}
    assert client.get(f"{API}/leaderboard").json() == []
