"""1.5 — SessionStore 프로토콜 + InMemorySessionStore.

메모리 구현이 DB처럼 동작하는지(깊은 복사 격리), 오류 계층, 만료 정리 경계, 스레드 안전성을 검증한다.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.domain.models import GameEventRecord, QuizRecord, Session
from app.services.session_store import (
    InMemorySessionStore,
    SessionAlreadyExistsError,
    SessionNotFoundError,
    SessionStore,
    SessionStoreError,
)

# 테스트 결정성을 위해 고정한 기준 시각 (tz-aware UTC)
BASE_NOW = datetime(2026, 10, 1, 9, 0, 0, tzinfo=UTC)


def make_session(session_id: str, *, expires_in_hours: int = 3) -> Session:
    """최소 필드만 채운 세션. expires_in_hours가 0 이하면 BASE_NOW 기준으로 이미 만료된 세션."""
    return Session(
        session_id=session_id,
        created_at=BASE_NOW,
        updated_at=BASE_NOW,
        expires_at=BASE_NOW + timedelta(hours=expires_in_hours),
        waves_per_stage=5,
    )


def make_quiz(quiz_id: str) -> QuizRecord:
    return QuizRecord(
        quiz_id=quiz_id,
        question_id="ony-01",
        topic_id="onyang",
        stage_order=1,
        kind="normal",
        difficulty=1,
        stem="온양온천은?",
        options=["a", "b", "c", "d"],
        correct_index=2,
        explanation="해설",
        served_at=BASE_NOW,
    )


def run_threads(worker: Callable[[int], None], count: int) -> None:
    """worker(index)를 count개 스레드로 동시에 실행하고 모두 끝날 때까지 기다린다."""
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)


@pytest.fixture
def store() -> InMemorySessionStore:
    return InMemorySessionStore()


def test_error_hierarchy() -> None:
    assert issubclass(SessionAlreadyExistsError, SessionStoreError)
    assert issubclass(SessionNotFoundError, SessionStoreError)
    assert issubclass(SessionStoreError, Exception)


def test_create_then_get_returns_equal_but_distinct_object(store: InMemorySessionStore) -> None:
    original = make_session("s1")
    store.create(original)

    first = store.get("s1")
    second = store.get("s1")

    assert first is not None and second is not None
    assert first == original
    assert first is not original
    assert first.stats is not original.stats
    assert first is not second  # get 할 때마다 새 사본
    assert first == second
    assert store.get("nope") is None  # 미존재 → None


def test_mutating_get_result_does_not_change_store(store: InMemorySessionStore) -> None:
    session = make_session("s1")
    session.quizzes["q1"] = make_quiz("q1")
    store.create(session)

    fetched = store.get("s1")
    assert fetched is not None
    fetched.nickname = "변경됨"
    fetched.stats.combo = 9
    fetched.quizzes["q1"].correct = True
    fetched.quizzes["q2"] = make_quiz("q2")
    fetched.stages_started.append(3)
    fetched.events.append(GameEventRecord(type="WAVE_CLEARED", stage_order=1, wave=1, at=BASE_NOW))

    again = store.get("s1")
    assert again is not None
    assert again.nickname is None
    assert again.stats.combo == 0
    assert again.quizzes["q1"].correct is None
    assert "q2" not in again.quizzes
    assert again.stages_started == []
    assert again.events == []


def test_mutating_original_after_create_is_isolated(store: InMemorySessionStore) -> None:
    original = make_session("s1")
    store.create(original)

    original.nickname = "나중에 바꿈"
    original.stats.correct_count = 7

    fetched = store.get("s1")
    assert fetched is not None
    assert fetched.nickname is None
    assert fetched.stats.correct_count == 0


def test_create_duplicate_raises(store: InMemorySessionStore) -> None:
    store.create(make_session("s1"))

    with pytest.raises(SessionAlreadyExistsError):
        store.create(make_session("s1"))

    assert store.count() == 1


def test_save_updates_stored_session(store: InMemorySessionStore) -> None:
    store.create(make_session("s1"))

    working = store.get("s1")
    assert working is not None
    working.nickname = "역사탐험가"
    working.status = "finished"
    working.stats.correct_count = 3
    working.quizzes["q1"] = make_quiz("q1")
    store.save(working)

    fetched = store.get("s1")
    assert fetched is not None
    assert fetched.nickname == "역사탐험가"
    assert fetched.status == "finished"
    assert fetched.stats.correct_count == 3
    assert fetched.quizzes["q1"].correct_index == 2


def test_save_stores_deep_copy(store: InMemorySessionStore) -> None:
    store.create(make_session("s1"))
    working = store.get("s1")
    assert working is not None
    store.save(working)

    working.stats.combo = 5  # save 뒤에 바꿔도 저장소에는 반영되지 않아야 한다

    fetched = store.get("s1")
    assert fetched is not None
    assert fetched.stats.combo == 0
    assert fetched is not working


def test_save_missing_raises(store: InMemorySessionStore) -> None:
    with pytest.raises(SessionNotFoundError):
        store.save(make_session("ghost"))

    assert store.count() == 0


def test_delete_and_count(store: InMemorySessionStore) -> None:
    assert store.count() == 0
    assert store.delete("nope") is False
    store.create(make_session("s1"))
    store.create(make_session("s2"))
    assert store.count() == 2

    assert store.delete("s1") is True
    assert store.get("s1") is None
    assert store.count() == 1
    assert store.delete("s1") is False


def test_purge_expired_removes_only_expired(store: InMemorySessionStore) -> None:
    assert store.purge_expired(BASE_NOW) == 0  # 빈 저장소
    store.create(make_session("expired-1", expires_in_hours=-2))
    store.create(make_session("expired-2", expires_in_hours=-1))
    store.create(make_session("alive-1", expires_in_hours=1))
    store.create(make_session("alive-2", expires_in_hours=3))

    removed = store.purge_expired(BASE_NOW)

    assert removed == 2
    assert store.get("expired-1") is None
    assert store.get("expired-2") is None
    assert store.get("alive-1") is not None
    assert store.get("alive-2") is not None
    assert store.count() == 2


def test_purge_expired_boundary_equal_is_deleted(store: InMemorySessionStore) -> None:
    store.create(make_session("edge", expires_in_hours=0))  # expires_at == BASE_NOW

    assert store.purge_expired(BASE_NOW - timedelta(microseconds=1)) == 0  # 1µs 전: 유지
    assert store.get("edge") is not None
    assert store.purge_expired(BASE_NOW) == 1  # 같은 시각: 삭제
    assert store.get("edge") is None


def test_purge_expired_compares_across_timezones(store: InMemorySessionStore) -> None:
    """tz-aware 비교: UTC+9 로 표현된 같은 순간을 넘기면 동일하게 만료 처리된다."""
    store.create(make_session("edge", expires_in_hours=0))
    kst = BASE_NOW.astimezone(timezone(timedelta(hours=9)))  # 같은 순간, 다른 표현
    assert kst == BASE_NOW and kst.hour == 18

    assert store.purge_expired(kst) == 1


def test_purge_expired_rejects_naive_datetime(store: InMemorySessionStore) -> None:
    store.create(make_session("s1"))

    with pytest.raises(ValueError, match="tz-aware"):
        store.purge_expired(BASE_NOW.replace(tzinfo=None))

    assert store.count() == 1


def test_concurrent_create_distinct_ids(store: InMemorySessionStore) -> None:
    thread_count = 20
    barrier = threading.Barrier(thread_count)
    errors: list[BaseException] = []

    def worker(index: int) -> None:
        try:
            barrier.wait(timeout=5)
            store.create(make_session(f"s{index}"))
        except BaseException as exc:  # 스레드 안 예외를 본 스레드로 모은다
            errors.append(exc)

    run_threads(worker, thread_count)

    assert errors == []
    assert store.count() == thread_count


def test_concurrent_create_same_id_only_one_wins(store: InMemorySessionStore) -> None:
    thread_count = 20
    barrier = threading.Barrier(thread_count)
    successes: list[int] = []
    duplicates: list[int] = []
    lock = threading.Lock()

    def worker(index: int) -> None:
        barrier.wait(timeout=5)
        try:
            store.create(make_session("shared"))
        except SessionAlreadyExistsError:
            with lock:
                duplicates.append(index)
        else:
            with lock:
                successes.append(index)

    run_threads(worker, thread_count)

    assert len(successes) == 1
    assert len(duplicates) == thread_count - 1
    assert store.count() == 1


def test_in_memory_store_satisfies_protocol(store: InMemorySessionStore) -> None:
    assert isinstance(store, SessionStore)  # runtime_checkable 프로토콜
    for name in ("create", "get", "save", "delete", "purge_expired", "count"):
        assert callable(getattr(store, name))


def test_protocol_rejects_incomplete_object() -> None:
    class Partial:
        def create(self, session: Session) -> None: ...

        def get(self, session_id: str) -> Session | None:
            return None

    assert not isinstance(Partial(), SessionStore)
