"""4.4 — 출제 우선순위에 변형(Variant) 단계 추가: ① 원본(변형 캐시 우선) → ② 미출제 변형 → ③ 오답 → ④ 재출제."""

from __future__ import annotations

import random

from app.domain.models import Question, Variant
from app.domain.quiz_rules import QuizSlot, select_for_slots


def question(qid: str, difficulty: int) -> Question:
    return Question(
        id=qid,
        topic_id="onyang",
        difficulty=difficulty,  # type: ignore[arg-type]
        stem=f"{qid} 문제",
        options=["정답", "오답1", "오답2", "오답3"],
        answer_index=0,
        fact="사실",
        explanation="해설",
    )


def variant(vid: str, qid: str, valid: bool = True) -> Variant:
    return Variant(
        variant_id=vid,
        question_id=qid,
        topic_id="onyang",
        stem=f"{vid} 변형 문제",
        options=["정답", "다른 오답1", "다른 오답2", "다른 오답3"],
        valid=valid,
    )


POOL = [question("q1", 1), question("q2", 2), question("q3", 3)]
VARIANTS = {"q1": [variant("v1a", "q1"), variant("v1b", "q1")], "q2": [variant("v2", "q2")]}
SLOT1 = QuizSlot("normal", 1, (1,))
SLOT2 = QuizSlot("normal", 2, (2,))


def test_fresh_question_uses_an_unseen_variant_when_available() -> None:
    picks = select_for_slots(
        [SLOT1], POOL, served_ids=set(), wrong_ids=set(), rng=random.Random(1), variants=VARIANTS
    )
    assert len(picks) == 1
    pick = picks[0]
    assert pick.question.id == "q1"
    assert pick.source == "fresh"
    assert pick.variant is not None
    assert pick.variant.variant_id in {"v1a", "v1b"}


def test_without_variants_behaves_as_before() -> None:
    picks = select_for_slots([SLOT1], POOL, served_ids=set(), wrong_ids=set(), rng=random.Random(1))
    assert picks[0].variant is None
    assert picks[0].source == "fresh"


def test_variant_tier_comes_after_fresh_and_before_wrong_retry() -> None:
    served = {"q1", "q2", "q3"}
    picks = select_for_slots(
        [SLOT2, SLOT1],
        POOL,
        served_ids=served,
        wrong_ids={"q3"},
        rng=random.Random(3),
        variants=VARIANTS,
    )
    first, second = picks
    assert (first.question.id, first.source, first.variant and first.variant.variant_id) == (
        "q2",
        "variant",
        "v2",
    )
    assert second.question.id == "q1"
    assert second.source == "variant"


def test_seen_and_invalid_variants_are_skipped_then_wrong_retry() -> None:
    served = {"q1", "q2", "q3"}
    variants = {"q1": [variant("v1a", "q1"), variant("bad", "q1", valid=False)]}
    picks = select_for_slots(
        [SLOT1, SLOT1],
        POOL,
        served_ids=served,
        wrong_ids={"q2"},
        rng=random.Random(5),
        variants=variants,
        seen_variant_ids={"v1a"},
    )
    assert picks[0].source == "wrong_retry"
    assert picks[0].question.id == "q2"
    assert picks[0].variant is None
    assert picks[1].source == "reuse"


def test_same_variant_not_reused_within_batch_and_rng_deterministic() -> None:
    args = dict(served_ids=set(), wrong_ids=set(), variants=VARIANTS)
    a = select_for_slots([SLOT1, SLOT2], POOL, rng=random.Random(7), **args)
    b = select_for_slots([SLOT1, SLOT2], POOL, rng=random.Random(7), **args)
    assert [(p.question.id, p.variant and p.variant.variant_id) for p in a] == [
        (p.question.id, p.variant and p.variant.variant_id) for p in b
    ]
    ids = [p.variant.variant_id for p in a if p.variant]
    assert len(ids) == len(set(ids))
