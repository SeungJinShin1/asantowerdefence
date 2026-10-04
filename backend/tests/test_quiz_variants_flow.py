"""4.4 — 변형 캐시가 있으면 stages/start 가 변형 문장을 우선 출제하고, 세션에 variantId 를 기록한다."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.models import Variant
from app.main import create_app
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore
from app.services.variation import InMemoryVariantCache

API = "/api/v1"
VARIANT_QUESTIONS = ("ony-01", "ony-02", "ony-03")


@pytest.fixture
def cache(question_bank: QuestionBank) -> InMemoryVariantCache:
    cache = InMemoryVariantCache()
    for qid in VARIANT_QUESTIONS:
        question = question_bank.get_question(qid)
        assert question is not None
        answer = question.options[question.answer_index]
        cache.put(
            [
                Variant(
                    variant_id=f"{qid}-v{n}",
                    question_id=qid,
                    topic_id="onyang",
                    stem=f"[변형{n}] {question.stem}",
                    options=[answer, f"오답A{n}", f"오답B{n}", f"오답C{n}"],
                )
                for n in (1, 2)
            ]
        )
    return cache


@pytest.fixture
def vclient(
    settings: Settings,
    question_bank: QuestionBank,
    session_store: InMemorySessionStore,
    cache: InMemoryVariantCache,
) -> Iterator[TestClient]:
    app = create_app(
        settings,
        question_bank=question_bank,
        session_store=session_store,
        variant_cache=cache,
        build_variants_on_startup=False,
    )
    with TestClient(app) as client:
        yield client


def test_start_serves_variants_first_and_records_variant_id(
    vclient: TestClient, session_store: InMemorySessionStore
) -> None:
    created = vclient.post(f"{API}/sessions", json={}).json()
    sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
    batch = vclient.post(
        f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers
    ).json()["quizBatch"]

    variant_items = [item for item in batch if item["stem"].startswith("[변형")]
    assert len(variant_items) == 3  # 변형이 있는 문항 3개는 모두 변형 문장으로
    assert len(batch) == 15
    for item in variant_items:
        assert "correctIndex" not in item
        assert len(item["options"]) == 4

    session = session_store.get(sid)
    recorded = [q for q in session.quizzes.values() if q.variant_id]
    assert sorted(q.question_id for q in recorded) == sorted(VARIANT_QUESTIONS)
    assert len({q.variant_id for q in recorded}) == 3
    assert sorted(session.served_question_ids) == sorted(
        q.question_id for q in session.quizzes.values()
    )

    # 변형 문항도 서버가 섞은 위치로 채점된다
    quiz = recorded[0]
    answer = vclient.post(
        f"{API}/sessions/{sid}/quiz/answer",
        json={
            "quizId": quiz.quiz_id,
            "choiceIndex": quiz.correct_index,
            "answeredMs": 2000,
            "wave": 1,
        },
        headers=headers,
    ).json()
    assert answer["correct"] is True
    assert answer["explanation"]


def test_retry_uses_remaining_unseen_variants(
    vclient: TestClient, session_store: InMemorySessionStore
) -> None:
    created = vclient.post(f"{API}/sessions", json={}).json()
    sid, headers = created["sessionId"], {"X-Session-Token": created["token"]}
    vclient.post(f"{API}/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers)
    second = vclient.post(
        f"{API}/sessions/{sid}/stages/1/start", json={"retry": True}, headers=headers
    ).json()["quizBatch"]

    session = session_store.get(sid)
    variant_ids = [q.variant_id for q in session.quizzes.values() if q.variant_id]
    assert len(variant_ids) == 6  # 문항 3개 × 변형 2개, 모두 한 번씩
    assert len(set(variant_ids)) == 6
    assert len(second) == 15
