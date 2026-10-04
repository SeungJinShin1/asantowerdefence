"""퀴즈 규칙 — 난이도 배정표, 보기 섞기, 스테이지 슬롯 계획, 출제 우선순위 (순수 로직).

근거: docs/02_game_design.md §6(난이도 배정), docs/03_api_contract.md stages/start(출제 우선순위 ①~④).
여기에는 '규칙 표'만 둔다. 코인·점수 같은 밸런스 숫자는 app/domain/scoring.py 가 단일 출처다.
FastAPI·DB·시간 의존이 없고, 무작위는 random.Random 인스턴스를 인자로 받아 시드 고정 테스트가 가능하다.

보안(서버 측 검증): 어떤 문항이 어떤 종류·난이도로 나가는지와 보기 순서(정답 위치)는 전부 서버가
이 모듈로 결정하고, 클라이언트는 결과만 받는다. shuffle_options 가 돌려주는 정답의 새 위치는
QuizRecord.correct_index 에만 저장되며 응답 스키마(QuizItem)에는 실리지 않는다.
"""

from __future__ import annotations

import random
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.domain.models import Question, QuizKind, Variant

# ---------- 규칙 표 ----------

# waves_per_stage → wave → 허용 난이도 (docs/02 §6: 전체 5웨이브 / 부스 3웨이브)
DIFFICULTY_BY_WAVE: dict[int, dict[int, tuple[int, ...]]] = {
    5: {1: (1,), 2: (1,), 3: (1, 2), 4: (1, 2), 5: (2, 3)},
    3: {1: (1,), 2: (1, 2), 3: (2, 3)},
}
# 종류별 허용 난이도: 긴급 퀴즈 → 2·3, 역사 러시 → 1·2
DIFFICULTY_BY_KIND: dict[QuizKind, tuple[int, ...]] = {"emergency": (2, 3), "rush": (1, 2)}
# waves_per_stage → 중간보스 / 최종보스 / 역사 러시가 나오는 웨이브
MIDBOSS_WAVE: dict[int, int] = {5: 3, 3: 2}
FINALBOSS_WAVE: dict[int, int] = {5: 5, 3: 3}
RUSH_WAVE: dict[int, int] = {5: 4, 3: 3}
SUPPORTED_WAVES_PER_STAGE: tuple[int, ...] = (3, 5)

PickSource = Literal["fresh", "variant", "wrong_retry", "reuse"]

# 같은 웨이브 안에서 클라이언트 응답을 정렬할 때의 종류 순서
_KIND_ORDER: dict[str, int] = {"normal": 0, "emergency": 1, "rush": 2}


def _check_waves_per_stage(waves_per_stage: int) -> None:
    if waves_per_stage not in SUPPORTED_WAVES_PER_STAGE:
        raise ValueError(
            f"waves_per_stage must be one of {SUPPORTED_WAVES_PER_STAGE}, got {waves_per_stage}"
        )


def difficulties_for(kind: QuizKind, wave: int, waves_per_stage: int) -> tuple[int, ...]:
    """슬롯 하나의 허용 난이도.

    normal 은 웨이브 표(웨이브를 1..waves_per_stage 로 클램프), emergency/rush 는 종류 표를 쓴다.
    waves_per_stage 가 3·5가 아니면 ValueError.
    """
    _check_waves_per_stage(waves_per_stage)
    if kind == "normal":
        clamped = min(max(wave, 1), waves_per_stage)
        return DIFFICULTY_BY_WAVE[waves_per_stage][clamped]
    if kind in DIFFICULTY_BY_KIND:
        return DIFFICULTY_BY_KIND[kind]
    raise ValueError(f"unknown quiz kind: {kind!r}")


def shuffle_options(
    options: Sequence[str], answer_index: int, rng: random.Random
) -> tuple[list[str], int]:
    """보기를 섞은 새 리스트와 정답의 새 위치를 돌려준다. 입력 시퀀스는 바꾸지 않는다."""
    if not 0 <= answer_index < len(options):
        raise ValueError(f"answer_index {answer_index} out of range for {len(options)} options")
    order = list(range(len(options)))
    rng.shuffle(order)
    return [options[i] for i in order], order.index(answer_index)


@dataclass(frozen=True)
class QuizSlot:
    """배치 안의 자리 하나 — 어떤 종류·웨이브에 쓰일 문제인지와 허용 난이도."""

    kind: QuizKind
    wave: int
    difficulties: tuple[int, ...]


def plan_stage_slots(
    waves_per_stage: int,
    *,
    normal_count: int = 12,
    emergency_count: int = 2,
    rush_count: int = 3,
) -> list[QuizSlot]:
    """스테이지 배치의 슬롯 목록을 '채우기 우선순위' 순서로 돌려준다.

    emergency(중간보스·최종보스 웨이브를 번갈아) → rush(RUSH_WAVE) → normal(웨이브 1..N 라운드로빈,
    웨이브 오름차순). 문항이 모자라면 select_for_slots 가 뒤쪽(normal 후반 웨이브)부터 비우게 된다.
    """
    _check_waves_per_stage(waves_per_stage)
    if min(normal_count, emergency_count, rush_count) < 0:
        raise ValueError("slot count must not be negative")

    boss_waves = (MIDBOSS_WAVE[waves_per_stage], FINALBOSS_WAVE[waves_per_stage])
    rush_wave = RUSH_WAVE[waves_per_stage]
    normal_waves = sorted(i % waves_per_stage + 1 for i in range(normal_count))

    slots: list[QuizSlot] = []
    for i in range(emergency_count):
        wave = boss_waves[i % len(boss_waves)]
        slots.append(
            QuizSlot("emergency", wave, difficulties_for("emergency", wave, waves_per_stage))
        )
    for _ in range(rush_count):
        slots.append(
            QuizSlot("rush", rush_wave, difficulties_for("rush", rush_wave, waves_per_stage))
        )
    for wave in normal_waves:
        slots.append(QuizSlot("normal", wave, difficulties_for("normal", wave, waves_per_stage)))
    return slots


def slot_sort_key(slot: QuizSlot) -> tuple[int, int]:
    """(wave, 종류 순서 normal=0 < emergency=1 < rush=2). 서비스가 클라이언트 응답을 이 키로 정렬한다."""
    return (slot.wave, _KIND_ORDER[slot.kind])


@dataclass(frozen=True)
class Pick:
    """슬롯 하나에 배정된 문항과 그 출처. variant 가 있으면 그 문장·보기로 낸다(정답은 options[0])."""

    slot: QuizSlot
    question: Question
    source: PickSource
    variant: Variant | None = None


def _difficulty_distance(question: Question, difficulties: tuple[int, ...]) -> int:
    if not difficulties:
        return 0
    return min(abs(question.difficulty - d) for d in difficulties)


def _pick_nearest(
    candidates: list[Question], difficulties: tuple[int, ...], rng: random.Random
) -> Question | None:
    """난이도 거리가 가장 가까운 후보들(거리 0 = 난이도 일치) 중 하나를 rng 로 고른다."""
    if not candidates:
        return None
    best = min(_difficulty_distance(q, difficulties) for q in candidates)
    nearest = [q for q in candidates if _difficulty_distance(q, difficulties) == best]
    return rng.choice(nearest)


def _unseen_variants(
    variants: Mapping[str, Sequence[Variant]] | None, question_id: str, seen: set[str]
) -> list[Variant]:
    if not variants:
        return []
    return [v for v in variants.get(question_id, ()) if v.valid and v.variant_id not in seen]


def select_for_slots(
    slots: Sequence[QuizSlot],
    pool: Sequence[Question],
    *,
    served_ids: Collection[str],
    wrong_ids: Collection[str],
    rng: random.Random,
    variants: Mapping[str, Sequence[Variant]] | None = None,
    seen_variant_ids: Collection[str] = (),
) -> list[Pick]:
    """슬롯 순서대로 문항을 하나씩 고른다 (docs/03 stages/start 출제 우선순위).

    ① 미출제 원본 중 난이도가 맞는(없으면 가장 가까운) 것 → fresh.
       그 문항에 아직 안 본 변형이 있으면 변형 문장으로 낸다(변형 캐시 우선, docs/03).
    ② 원본은 이미 나왔지만 안 본 변형이 남은 문항 → variant
    ③ wrong_ids 중 이 배치에서 안 쓴 것 → wrong_retry
    ④ pool 중 이 배치에서 안 쓴 아무 것 → reuse (서비스가 보기를 다시 섞는다)
    아무것도 없으면 그 슬롯은 건너뛴다. 같은 tier 안에서는 rng 로 무작위.
    한 배치 안에서 같은 question.id 는 한 번만 나온다. 입력은 바꾸지 않는다.
    """
    served = set(served_ids)
    wrong = set(wrong_ids)
    seen_variants = set(seen_variant_ids)
    used: set[str] = set()
    picks: list[Pick] = []

    for slot in slots:
        available = [q for q in pool if q.id not in used]
        source: PickSource = "fresh"
        variant: Variant | None = None
        question = _pick_nearest(
            [q for q in available if q.id not in served], slot.difficulties, rng
        )
        if question is None:
            source = "variant"
            question = _pick_nearest(
                [q for q in available if _unseen_variants(variants, q.id, seen_variants)],
                slot.difficulties,
                rng,
            )
        if question is None:
            source = "wrong_retry"
            question = _pick_nearest(
                [q for q in available if q.id in wrong], slot.difficulties, rng
            )
        if question is None:
            source = "reuse"
            question = _pick_nearest(available, slot.difficulties, rng)
        if question is None:
            continue
        if source in ("fresh", "variant"):
            candidates = _unseen_variants(variants, question.id, seen_variants)
            if candidates:
                variant = rng.choice(candidates)
                seen_variants.add(variant.variant_id)
        used.add(question.id)
        picks.append(Pick(slot=slot, question=question, source=source, variant=variant))
    return picks
