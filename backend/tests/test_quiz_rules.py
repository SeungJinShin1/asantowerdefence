"""1.3 — 퀴즈 규칙 순수 로직 테스트 (docs/02 §6 난이도 배정, docs/03 stages/start 출제 우선순위 ①~④). 시드 고정으로 결정적."""

from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from app.domain.models import Question
from app.domain.quiz_rules import (
    DIFFICULTY_BY_KIND,
    DIFFICULTY_BY_WAVE,
    FINALBOSS_WAVE,
    MIDBOSS_WAVE,
    RUSH_WAVE,
    SUPPORTED_WAVES_PER_STAGE,
    Pick,
    QuizSlot,
    difficulties_for,
    plan_stage_slots,
    select_for_slots,
    shuffle_options,
    slot_sort_key,
)

CONTENT_DIR = Path(__file__).resolve().parents[1] / "app" / "content"
ORIGINAL_OPTIONS = ["온수(溫水)", "탕정(湯井)", "온창(溫昌)", "온양(溫陽)"]


def _make_question(qid: str, difficulty: int, topic_id: str = "onyang") -> Question:
    return Question(
        id=qid,
        topic_id=topic_id,
        difficulty=difficulty,
        stem=f"문제 {qid}",
        options=[f"{qid}-a", f"{qid}-b", f"{qid}-c", f"{qid}-d"],
        answer_index=0,
        fact=f"사실 {qid}",
        explanation=f"해설 {qid}",
    )


def _make_pool(counts: dict[int, int]) -> list[Question]:
    """난이도별 개수대로 합성 풀을 만든다 (id = d{난이도}-{번호})."""
    return [_make_question(f"d{d}-{i:02d}", d) for d, n in sorted(counts.items()) for i in range(n)]


def _select(slots, pool, *, served=(), wrong=(), seed=0):
    return select_for_slots(
        slots, pool, served_ids=served, wrong_ids=wrong, rng=random.Random(seed)
    )


@pytest.fixture(scope="module")
def onyang_pool() -> list[Question]:
    data = json.loads((CONTENT_DIR / "questions.json").read_text(encoding="utf-8"))
    pool = [Question.model_validate(q) for q in data["questions"] if q["topicId"] == "onyang"]
    assert len(pool) == 15, "onyang 원본은 15문항이어야 한다"
    return pool


# ---------- 난이도 표 (docs/02 §6) ----------


@pytest.mark.parametrize(
    ("waves_per_stage", "wave", "expected"),
    [
        (5, 1, (1,)),
        (5, 2, (1,)),
        (5, 3, (1, 2)),
        (5, 4, (1, 2)),
        (5, 5, (2, 3)),
        (3, 1, (1,)),
        (3, 2, (1, 2)),
        (3, 3, (2, 3)),
    ],
)
def test_difficulties_for_normal_follows_wave_table(waves_per_stage, wave, expected):
    assert difficulties_for("normal", wave, waves_per_stage) == expected
    assert DIFFICULTY_BY_WAVE[waves_per_stage][wave] == expected


@pytest.mark.parametrize("waves_per_stage", SUPPORTED_WAVES_PER_STAGE)
def test_difficulties_for_kind_table_and_wave_clamp(waves_per_stage):
    assert difficulties_for("emergency", 1, waves_per_stage) == (2, 3)
    assert difficulties_for("rush", 1, waves_per_stage) == (1, 2)
    assert difficulties_for("emergency", 99, waves_per_stage) == (2, 3)  # 종류 표는 웨이브와 무관
    assert DIFFICULTY_BY_KIND == {"emergency": (2, 3), "rush": (1, 2)}
    # normal 은 웨이브를 1..waves_per_stage 로 클램프
    assert difficulties_for("normal", 0, waves_per_stage) == (1,)
    assert difficulties_for("normal", -5, waves_per_stage) == (1,)
    assert difficulties_for("normal", 99, waves_per_stage) == (2, 3)


@pytest.mark.parametrize("kind", ["normal", "emergency", "rush"])
def test_difficulties_for_rejects_unsupported_waves_per_stage(kind):
    with pytest.raises(ValueError, match="waves_per_stage"):
        difficulties_for(kind, 1, 4)


def test_rule_tables_are_consistent():
    assert SUPPORTED_WAVES_PER_STAGE == (3, 5)
    assert MIDBOSS_WAVE == {5: 3, 3: 2}
    assert FINALBOSS_WAVE == {5: 5, 3: 3}
    assert RUSH_WAVE == {5: 4, 3: 3}
    for n in SUPPORTED_WAVES_PER_STAGE:
        assert set(DIFFICULTY_BY_WAVE[n]) == set(range(1, n + 1))
        assert MIDBOSS_WAVE[n] < FINALBOSS_WAVE[n] == n


# ---------- 보기 섞기 ----------


def test_shuffle_options_is_permutation_with_tracked_answer():
    positions: set[int] = set()
    for seed in range(20):
        options = list(ORIGINAL_OPTIONS)
        shuffled, new_index = shuffle_options(options, 0, random.Random(seed))
        assert len(shuffled) == 4
        assert sorted(shuffled) == sorted(ORIGINAL_OPTIONS)
        assert shuffled[new_index] == ORIGINAL_OPTIONS[0]
        assert options == ORIGINAL_OPTIONS  # 입력 불변
        assert shuffled is not options
        positions.add(new_index)
    assert positions - {0}, "20개 시드 중 정답이 0번 자리를 떠나는 경우가 있어야 한다"
    assert positions <= {0, 1, 2, 3}


def test_shuffle_options_tracks_any_answer_index_and_is_seed_stable():
    shuffled, new_index = shuffle_options(ORIGINAL_OPTIONS, 2, random.Random(7))
    assert shuffled[new_index] == ORIGINAL_OPTIONS[2]
    first = shuffle_options(ORIGINAL_OPTIONS, 0, random.Random(3))
    assert first == shuffle_options(ORIGINAL_OPTIONS, 0, random.Random(3))


@pytest.mark.parametrize("answer_index", [-1, 4])
def test_shuffle_options_rejects_bad_answer_index(answer_index):
    with pytest.raises(ValueError, match="answer_index"):
        shuffle_options(ORIGINAL_OPTIONS, answer_index, random.Random(0))


# ---------- 슬롯 계획 ----------


def _wave_counts(slots: list[QuizSlot], kind: str) -> Counter[int]:
    return Counter(s.wave for s in slots if s.kind == kind)


def test_plan_stage_slots_booth():
    slots = plan_stage_slots(3)
    assert len(slots) == 17
    assert _wave_counts(slots, "normal") == {1: 4, 2: 4, 3: 4}
    assert _wave_counts(slots, "emergency") == {2: 1, 3: 1}
    assert _wave_counts(slots, "rush") == {3: 3}
    assert [s.kind for s in slots[:5]] == ["emergency", "emergency", "rush", "rush", "rush"]
    assert all(s.kind == "normal" for s in slots[5:])


def test_plan_stage_slots_full():
    slots = plan_stage_slots(5)
    assert len(slots) == 17
    assert _wave_counts(slots, "normal") == {1: 3, 2: 3, 3: 2, 4: 2, 5: 2}
    assert _wave_counts(slots, "emergency") == {3: 1, 5: 1}
    assert _wave_counts(slots, "rush") == {4: 3}
    assert [s.kind for s in slots[:5]] == ["emergency", "emergency", "rush", "rush", "rush"]


@pytest.mark.parametrize("waves_per_stage", SUPPORTED_WAVES_PER_STAGE)
def test_plan_stage_slots_difficulties_match_table(waves_per_stage):
    slots = plan_stage_slots(waves_per_stage)
    for slot in slots:
        assert slot.difficulties == difficulties_for(slot.kind, slot.wave, waves_per_stage)
    # normal 슬롯은 웨이브 오름차순 → 문항이 모자라면 후반 웨이브부터 잘린다
    normal_waves = [s.wave for s in slots if s.kind == "normal"]
    assert normal_waves == sorted(normal_waves)


def test_plan_stage_slots_custom_counts():
    slots = plan_stage_slots(5, normal_count=5, emergency_count=3, rush_count=1)
    assert len(slots) == 9
    assert [s.wave for s in slots if s.kind == "emergency"] == [3, 5, 3]  # 중간·최종 번갈아
    assert [s.wave for s in slots if s.kind == "rush"] == [4]
    assert [s.wave for s in slots if s.kind == "normal"] == [1, 2, 3, 4, 5]
    assert plan_stage_slots(3, normal_count=0, emergency_count=0, rush_count=0) == []
    with pytest.raises(ValueError, match="count"):
        plan_stage_slots(3, normal_count=-1)


@pytest.mark.parametrize("bad", [4, 0, 6])
def test_plan_stage_slots_rejects_unsupported(bad):
    with pytest.raises(ValueError, match="waves_per_stage"):
        plan_stage_slots(bad)


def test_slot_sort_key_orders_by_wave_then_kind():
    ordered = sorted(plan_stage_slots(5), key=slot_sort_key)
    waves = [s.wave for s in ordered]
    assert waves == sorted(waves)
    assert [s.kind for s in ordered if s.wave == 3] == ["normal", "normal", "emergency"]
    assert [s.kind for s in ordered if s.wave == 4] == ["normal", "normal", "rush", "rush", "rush"]
    keys = [slot_sort_key(QuizSlot(k, 2, (1,))) for k in ("normal", "emergency", "rush")]
    assert keys == sorted(keys) and len(set(keys)) == 3  # 같은 웨이브: normal < emergency < rush
    assert slot_sort_key(QuizSlot("rush", 1, (1, 2))) < keys[0]  # 웨이브가 먼저


def test_quiz_slot_is_frozen():
    with pytest.raises(FrozenInstanceError):
        QuizSlot("normal", 1, (1,)).wave = 2  # type: ignore[misc]


# ---------- 출제 우선순위 ①~④ (docs/03 stages/start) ----------


def test_select_all_fresh_when_nothing_served(onyang_pool):
    slots = plan_stage_slots(3)
    pool_before = list(onyang_pool)
    picks = _select(slots, onyang_pool, seed=1)
    assert len(picks) == 15
    assert all(isinstance(p, Pick) and p.source == "fresh" for p in picks)
    ids = [p.question.id for p in picks]
    assert len(set(ids)) == 15
    assert set(ids) == {q.id for q in onyang_pool}
    assert [p.slot for p in picks] == slots[:15]  # 앞 15개 슬롯에 대응, 뒤 2개(normal 후반)는 잘림
    assert Counter(p.slot.kind for p in picks) == {"emergency": 2, "rush": 3, "normal": 10}
    assert onyang_pool == pool_before and slots == plan_stage_slots(3)  # 입력 불변


def test_select_priority_fresh_then_wrong_then_reuse(onyang_pool):
    ids = [q.id for q in onyang_pool]
    served, wrong = [*ids[:10], "nope"], [*ids[2:5], "nope"]  # 풀 밖 id 는 무시
    picks = _select(plan_stage_slots(3), onyang_pool, served=served, wrong=wrong, seed=5)
    assert len(picks) == 15
    assert [p.source for p in picks] == ["fresh"] * 5 + ["wrong_retry"] * 3 + ["reuse"] * 7
    assert {p.question.id for p in picks[:5]} == set(ids[10:])
    assert {p.question.id for p in picks[5:8]} == set(ids[2:5])
    assert {p.question.id for p in picks[8:]} == set(ids[:10]) - set(ids[2:5])
    assert len({p.question.id for p in picks}) == 15


def test_select_empty_pool_or_empty_slots_returns_nothing(onyang_pool):
    assert _select(plan_stage_slots(3), []) == []
    assert _select([], onyang_pool) == []


def test_select_is_deterministic_per_seed(onyang_pool):
    slots = plan_stage_slots(3)
    a = [p.question.id for p in _select(slots, onyang_pool, seed=42)]
    b = [p.question.id for p in _select(slots, onyang_pool, seed=42)]
    c = [p.question.id for p in _select(slots, onyang_pool, seed=43)]
    assert a == b
    assert a != c
    assert set(a) == set(c)  # 같은 문항 집합, 순서만 다름


def test_select_wave1_slots_get_difficulty_1_when_plentiful():
    pool = _make_pool({1: 10, 2: 10, 3: 6})
    picks = _select(plan_stage_slots(3), pool, seed=9)
    assert len(picks) == 17
    wave1 = [p for p in picks if p.slot.kind == "normal" and p.slot.wave == 1]
    assert len(wave1) == 4
    assert all(p.question.difficulty == 1 for p in wave1)
    # 풀이 넉넉하면 모든 슬롯이 ①(난이도 일치)로 채워진다
    assert all(p.question.difficulty in p.slot.difficulties for p in picks)
    assert all(p.source == "fresh" for p in picks)


def test_select_picks_difficulty_2_for_2_3_slot_when_no_difficulty_3():
    pool = _make_pool({1: 5, 2: 5})
    picks = _select([QuizSlot("emergency", 3, (2, 3))] * 5, pool, seed=2)
    assert len(picks) == 5
    assert all(p.question.difficulty == 2 for p in picks)
    assert len({p.question.id for p in picks}) == 5


def test_select_tier2_prefers_nearest_difficulty():
    # 난이도 3 슬롯인데 미출제 문항이 1·2뿐 → 거리 1인 난이도 2가 먼저, 그 다음 난이도 1
    picks = _select([QuizSlot("normal", 5, (3,))] * 4, _make_pool({1: 2, 2: 2}), seed=4)
    assert [p.question.difficulty for p in picks] == [2, 2, 1, 1]
    assert all(p.source == "fresh" for p in picks)


def test_select_tier3_prefers_matching_difficulty_among_wrong():
    pool = _make_pool({1: 2, 3: 2})
    all_ids = [q.id for q in pool]
    picks = _select([QuizSlot("normal", 5, (3,))] * 4, pool, served=all_ids, wrong=all_ids, seed=4)
    assert [p.source for p in picks] == ["wrong_retry"] * 4
    assert [p.question.difficulty for p in picks] == [3, 3, 1, 1]


def test_select_reuse_when_everything_served_and_nothing_wrong():
    pool = _make_pool({1: 3, 2: 2})
    picks = _select([QuizSlot("normal", 1, (1,))] * 8, pool, served=[q.id for q in pool], seed=1)
    assert len(picks) == 5  # 풀보다 많은 슬롯 → 남는 슬롯은 건너뜀
    assert all(p.source == "reuse" for p in picks)
    assert len({p.question.id for p in picks}) == 5
