"""5.1 — create_app 저장소 선택: Firestore 클라이언트가 있으면 Firestore 구현, 없으면 메모리 구현."""

from __future__ import annotations

from fastapi.testclient import TestClient
from tests.fake_firestore import FakeFirestore

from app.core.config import Settings
from app.main import create_app
from app.services.firestore_store import (
    FirestoreLeaderboardStore,
    FirestoreSessionStore,
    FirestoreVariantCache,
)
from app.services.leaderboard import InMemoryLeaderboardStore
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore
from app.services.variation import InMemoryVariantCache

API = "/api/v1"


def test_memory_stores_by_default(settings: Settings, question_bank: QuestionBank) -> None:
    app = create_app(settings, question_bank=question_bank, build_variants_on_startup=False)
    assert isinstance(app.state.session_store, InMemorySessionStore)
    assert isinstance(app.state.variant_cache, InMemoryVariantCache)
    assert isinstance(app.state.leaderboard.store, InMemoryLeaderboardStore)


def test_firestore_stores_when_client_given_and_flow_works(
    settings: Settings, question_bank: QuestionBank
) -> None:
    db = FakeFirestore()
    firestore_settings = settings.model_copy(
        update={"firestore_collection_prefix": "dev_", "firebase_service_account_b64": "ignored"}
    )
    app = create_app(
        firestore_settings,
        question_bank=question_bank,
        firestore_client=db,
        build_variants_on_startup=False,
    )
    assert isinstance(app.state.session_store, FirestoreSessionStore)
    assert isinstance(app.state.variant_cache, FirestoreVariantCache)
    assert isinstance(app.state.leaderboard.store, FirestoreLeaderboardStore)

    with TestClient(app) as client:
        created = client.post(f"{API}/sessions", json={"nickname": "파이어"}).json()
        sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
        assert sid in db.collections["dev_sessions"]

        started = client.post(
            f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers
        )
        assert started.status_code == 200
        assert len(db.collections["dev_sessions"][sid]["quizzes"]) == 15

        finished = client.post(
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
        assert finished.status_code == 200
        registered = client.post(f"{API}/leaderboard", json={"nickname": "파이어"}, headers=headers)
        assert registered.status_code == 201
        assert len(db.collections["dev_leaderboard"]) == 1
        assert client.get(f"{API}/leaderboard").json()[0]["nickname"] == "파이어"


def test_explicit_memory_store_wins_over_firestore_client(
    settings: Settings, question_bank: QuestionBank
) -> None:
    app = create_app(
        settings,
        question_bank=question_bank,
        session_store=InMemorySessionStore(),
        firestore_client=FakeFirestore(),
        build_variants_on_startup=False,
    )
    assert isinstance(app.state.session_store, InMemorySessionStore)
