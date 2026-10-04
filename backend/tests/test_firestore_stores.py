"""5.1 — Firestore 구현(가짜 DB): 세션 CRUD·만료 정리, 변형 캐시, 리더보드, camelCase 직렬화."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from tests.fake_firestore import FakeFirestore

from app.domain.models import LeaderboardEntry, Session, StageState, Variant
from app.services.firestore_store import (
    FirestoreLeaderboardStore,
    FirestoreSessionStore,
    FirestoreVariantCache,
    ServiceAccountError,
    load_service_account,
)
from app.services.session_store import SessionAlreadyExistsError, SessionNotFoundError

NOW = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)


def make_session(sid: str, *, hours: float = 3) -> Session:
    return Session(
        session_id=sid,
        created_at=NOW,
        updated_at=NOW,
        expires_at=NOW + timedelta(hours=hours),
        waves_per_stage=3,
        stages_started=[1],
        stage_states={1: StageState(attempts=1, event_counts={"WAVE_CLEARED": 2})},
    )


@pytest.fixture
def db() -> FakeFirestore:
    return FakeFirestore()


def test_session_store_crud_and_serialization(db: FakeFirestore) -> None:
    store = FirestoreSessionStore(db, prefix="t_")
    store.create(make_session("s_1"))
    raw = db.collections["t_sessions"]["s_1"]
    assert raw["sessionId"] == "s_1"
    assert raw["stageStates"] == {"1": {"attempts": 1, "eventCounts": {"WAVE_CLEARED": 2}}}
    assert isinstance(raw["expiresAt"], datetime)

    loaded = store.get("s_1")
    assert loaded is not None
    assert loaded.stage_states[1].event_counts == {"WAVE_CLEARED": 2}
    assert store.get("missing") is None

    loaded.stats.correct_count = 3
    store.save(loaded)
    assert store.get("s_1").stats.correct_count == 3

    with pytest.raises(SessionAlreadyExistsError):
        store.create(make_session("s_1"))
    with pytest.raises(SessionNotFoundError):
        store.save(make_session("ghost"))
    assert store.count() == 1
    assert store.delete("s_1") is True
    assert store.delete("s_1") is False


def test_session_store_purges_expired(db: FakeFirestore) -> None:
    store = FirestoreSessionStore(db)
    store.create(make_session("live", hours=3))
    store.create(make_session("dead", hours=-1))
    store.create(make_session("edge", hours=0))
    assert store.purge_expired(NOW) == 2
    assert store.get("live") is not None
    assert store.get("dead") is None


def test_variant_cache(db: FakeFirestore) -> None:
    cache = FirestoreVariantCache(db)
    v1 = Variant(
        variant_id="ony-01-v1",
        question_id="ony-01",
        topic_id="onyang",
        stem="a",
        options=list("abcd"),
    )
    v2 = Variant(
        variant_id="ony-02-v1",
        question_id="ony-02",
        topic_id="onyang",
        stem="b",
        options=list("abcd"),
    )
    v3 = Variant(
        variant_id="yss-01-v1",
        question_id="yss-01",
        topic_id="yisunsin",
        stem="c",
        options=list("abcd"),
    )
    cache.put([v1, v2, v3, v1])
    assert [v.variant_id for v in cache.get("ony-01")] == ["ony-01-v1"]
    assert sorted(cache.by_topic("onyang")) == ["ony-01", "ony-02"]
    assert len(cache.all()) == 3
    assert cache.last_built_at() is None
    cache.mark_built(NOW)
    assert cache.last_built_at() == NOW
    cache.clear()
    assert cache.all() == [] and cache.last_built_at() is None


def test_leaderboard_store_rank_and_top(db: FakeFirestore) -> None:
    store = FirestoreLeaderboardStore(db)

    def entry(name: str, score: int, minutes: int) -> LeaderboardEntry:
        return LeaderboardEntry(
            nickname=name,
            score=score,
            stage_reached=1,
            correct_count=1,
            combo_max=1,
            booth_mode=True,
            session_id=f"s_{name}",
            created_at=NOW + timedelta(minutes=minutes),
        )

    ids = [
        store.add(entry("a", 100, 0)),
        store.add(entry("b", 300, 1)),
        store.add(entry("c", 100, 2)),
    ]
    assert len(set(ids)) == 3
    assert [e.nickname for e in store.top(10)] == ["b", "a", "c"]  # 동점은 먼저 올린 사람이 위
    assert [e.nickname for e in store.top(2)] == ["b", "a"]
    assert store.rank_of(300) == 1
    assert store.rank_of(100) == 2
    assert store.rank_of(50) == 4
    assert store.clear() == 3
    assert store.top(10) == []


SA = {"type": "service_account", "project_id": "p", "private_key": "k", "client_email": "e@p.iam"}


def test_load_service_account_from_b64_tolerates_wrapping_and_padding() -> None:
    import base64
    import json

    raw = base64.b64encode(json.dumps(SA).encode()).decode().rstrip("=")
    wrapped = '"' + raw[:20] + chr(10) + raw[20:] + ' "'  # 따옴표·줄바꿈·끝 공백 섞인 값
    assert load_service_account(wrapped)["project_id"] == "p"


def test_load_service_account_errors_do_not_leak_content(tmp_path) -> None:
    with pytest.raises(ServiceAccountError) as info:
        load_service_account("A!!garbage")  # base64 가 아닌 값
    assert "base64" in str(info.value) and "garbage" not in str(info.value)
    with pytest.raises(ServiceAccountError):
        load_service_account(service_account_file=str(tmp_path / "missing.json"))
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    with pytest.raises(ServiceAccountError) as info2:
        load_service_account(service_account_file=str(bad))
    assert "private_key" in str(info2.value)


def test_load_service_account_from_file(tmp_path) -> None:
    import json

    path = tmp_path / "firebase.json"
    path.write_text(json.dumps(SA), encoding="utf-8")
    assert load_service_account(service_account_file=str(path))["client_email"] == "e@p.iam"
