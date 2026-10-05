"""1.4 — 코인·콤보·점수 공식과 finish 상한 검증.

케이스 출처: docs/02_game_design.md §6 코인 보상·§9 점수 공식/검증, docs/03_api_contract.md answer·finish 예시.
"""

from __future__ import annotations

import dataclasses
import inspect
from typing import Any

import pytest

from app.domain import models, scoring
from app.domain.models import FinishReport, QuizKind, ScoreBreakdown
from app.domain.scoring import (
    BASE_COINS,
    MAX_CLIENT_BONUS_PER_STAGE,
    MAX_CLIENT_BONUS_PER_WAVE,
    MAX_LIVES,
    SCORE_COINS_CAP,
    CoinAward,
    award_coins,
    combo_multiplier,
    compute_score,
    max_client_coins,
    next_combo,
    validate_finish,
    waves_per_stage,
)

# ---------- 헬퍼 ----------


def _award(
    kind: QuizKind, *, combo: int = 1, ms: int = 8000, double: bool = False, correct: bool = True
) -> CoinAward:
    return award_coins(
        kind, correct=correct, combo_after=combo, answered_ms=ms, double_coin_active=double
    )


_SCORE_KEYS = tuple(inspect.signature(compute_score).parameters)  # 선언 순서 = 스펙 인자 순서


def _score(*values: int) -> tuple[int, ScoreBreakdown]:
    """compute_score 를 (correct, comboMax, waves, stages, lives, coins) 순서의 위치 인자로 호출."""
    padded = values + (0,) * (len(_SCORE_KEYS) - len(values))
    return compute_score(**dict(zip(_SCORE_KEYS, padded, strict=True)))


_CONTRACT_REPORT: dict[str, int] = {
    "stages_cleared": 3,
    "waves_cleared": 9,
    "lives_left_at_end": 7,
    "coins_left_at_end": 180,
    "client_score": 4690,
}


def _report(**overrides: int) -> FinishReport:
    """docs/03 finish 예시를 기본값으로 하는 보고서."""
    return FinishReport(**{**_CONTRACT_REPORT, **overrides})


def _check(
    report: FinishReport, *, started: int = 3, wps: int = 3, quiz_coins: int = 130
) -> list[str]:
    return validate_finish(
        report, stages_started=started, waves_per_stage=wps, coins_from_quiz=quiz_coins
    )


# ---------- 상수 (밸런스 숫자의 단일 출처 — 스펙 값 그대로) ----------


# fmt: off
_SPEC_CONSTANTS: dict[str, Any] = {  # 스펙 1.4 상수 표(이름·값) 그대로
    "WAVES_PER_STAGE_BOOTH": 3, "WAVES_PER_STAGE_FULL": 5, "STAGE_COUNT": 5, "MAX_LIVES": 10,
    "START_COINS": 150, "LEARN_BONUS": 50, "QUIZ_TIME_LIMIT_SEC": 15, "QUIZ_BATCH_NORMAL": 12,
    "QUIZ_BATCH_EMERGENCY": 2, "QUIZ_BATCH_RUSH": 3, "QUIZ_MORE_DEFAULT": 5, "QUIZ_MORE_MAX": 10,
    "MAX_QUIZZES_PER_SESSION": 200, "BASE_COINS": {"normal": 30, "emergency": 50, "rush": 40},
    "FAST_BONUS": 10, "FAST_ANSWER_MS": 5000, "DOUBLE_COIN_MULT": 2, "DOUBLE_COIN_SECONDS": 20,
    "COMBO_MULT_MAX": 3, "SCORE_PER_CORRECT": 100, "SCORE_PER_COMBO_MAX": 50,
    "SCORE_PER_WAVE": 150, "SCORE_PER_STAGE": 500, "SCORE_PER_LIFE": 30, "SCORE_COINS_CAP": 500,
    "MAX_CLIENT_BONUS_PER_STAGE": 1200, "MAX_CLIENT_BONUS_PER_WAVE": 1000,
}
# fmt: on


@pytest.mark.parametrize(("name", "expected"), list(_SPEC_CONSTANTS.items()))
def test_constants_match_spec(name: str, expected: Any) -> None:
    assert getattr(scoring, name) == expected


def test_stage_count_matches_models() -> None:
    """주제 수(models.TOPIC_IDS)와 스테이지 수가 어긋나면 바로 알 수 있도록."""
    assert scoring.STAGE_COUNT == models.STAGE_COUNT == len(models.TOPIC_IDS)


def test_waves_per_stage_booth_and_full() -> None:
    assert waves_per_stage(True) == 3
    assert waves_per_stage(False) == 5


# ---------- 콤보 ----------


@pytest.mark.parametrize(("combo", "expected"), [(0, 1), (1, 1), (2, 2), (3, 3), (10, 3)])
def test_combo_multiplier_boundaries(combo: int, expected: int) -> None:
    assert combo_multiplier(combo) == expected


def test_next_combo_chain() -> None:
    """0 → 정답 → 1 → 정답 → 2 → 오답 → 0. 시간 초과도 오답이라 0."""
    combo = next_combo(0, True)
    assert combo == 1
    combo = next_combo(combo, True)
    assert combo == 2
    assert next_combo(combo, False) == 0
    assert next_combo(5, False) == 0


# ---------- 코인 보상 (docs/02 §6 표) ----------


@pytest.mark.parametrize(
    ("kind", "combo", "ms", "double", "expected"),
    [
        ("normal", 1, 8000, False, CoinAward(30, 30, 1, 0, 1)),  # 콤보1, 느림 → 30
        ("normal", 2, 4200, False, CoinAward(70, 30, 2, 10, 1)),  # docs/03 answer 예시 → 70
        ("normal", 3, 8000, False, CoinAward(90, 30, 3, 0, 1)),  # 콤보3 → 90
        ("normal", 7, 8000, False, CoinAward(90, 30, 3, 0, 1)),  # 콤보7 → 90 (×3 상한)
        ("emergency", 1, 3000, False, CoinAward(60, 50, 1, 10, 1)),  # 긴급, 빠름 → 60
        ("rush", 2, 9000, False, CoinAward(80, 40, 2, 0, 1)),  # 러시, 콤보2, 느림 → 80
        ("normal", 2, 4200, True, CoinAward(140, 30, 2, 10, 2)),  # 2배 타임 → 140
    ],
)
def test_award_coins_correct_table(
    kind: QuizKind, combo: int, ms: int, double: bool, expected: CoinAward
) -> None:
    assert _award(kind, combo=combo, ms=ms, double=double) == expected


def test_award_coins_formula_matches_breakdown() -> None:
    """coins == (base × comboMult + fastBonus) × eventMult 가 분해 항목과 항상 일치하고 0 이상이다."""
    for kind in BASE_COINS:
        for combo in range(6):
            for ms in (0, 5000, 5001, 15000):
                for double in (False, True):
                    a = _award(kind, combo=combo, ms=ms, double=double)
                    assert a.base == BASE_COINS[kind]
                    assert a.coins == (a.base * a.combo_mult + a.fast_bonus) * a.event_mult
                    assert a.coins >= 0


@pytest.mark.parametrize("double", [False, True])
def test_award_coins_wrong_answer_is_zero_but_keeps_base_and_event(double: bool) -> None:
    award = _award("emergency", combo=0, ms=4000, double=double, correct=False)
    assert award == CoinAward(
        coins=0, base=50, combo_mult=1, fast_bonus=0, event_mult=2 if double else 1
    )


def test_award_coins_fast_bonus_boundary() -> None:
    assert _award("normal", ms=5000) == CoinAward(40, 30, 1, 10, 1)
    assert _award("normal", ms=5001) == CoinAward(30, 30, 1, 0, 1)


def test_award_coins_timeout_is_zero_never_negative() -> None:
    """시간 초과(제한 15초, choiceIndex -1)는 오답 — 코인 0, 감점형 규칙 없음."""
    assert _award("normal", combo=0, ms=15000, correct=False).coins == 0
    for kind in BASE_COINS:
        for correct in (True, False):
            assert _award(kind, combo=0, ms=99999, correct=correct).coins >= 0


def test_coin_award_is_frozen() -> None:
    award = _award("normal", ms=1000)
    with pytest.raises(dataclasses.FrozenInstanceError):
        award.coins = 999  # type: ignore[misc]


# ---------- 점수 공식 (docs/02 §9, docs/03 finish 예시) ----------


def test_compute_score_api_contract_example() -> None:
    score, breakdown = _score(12, 5, 9, 3, 7, 180)
    assert score == 4690
    assert breakdown == ScoreBreakdown(
        correct=1200, combo=250, waves=1350, stages=1500, lives=210, coins=180
    )


def test_compute_score_caps_coins() -> None:
    score, breakdown = _score(0, 0, 0, 0, 0, 999)
    assert breakdown.coins == SCORE_COINS_CAP == 500
    assert score == 500


def test_compute_score_all_zero() -> None:
    score, breakdown = _score()
    assert score == 0
    assert breakdown == ScoreBreakdown(correct=0, combo=0, waves=0, stages=0, lives=0, coins=0)


def test_compute_score_equals_sum_of_breakdown() -> None:
    score, breakdown = _score(7, 3, 4, 1, 10, 250)
    assert score == sum(breakdown.model_dump().values())
    assert score == 7 * 100 + 3 * 50 + 4 * 150 + 1 * 500 + 10 * 30 + 250


# ---------- finish 상한 검증 (docs/02 §9) ----------


def test_max_client_coins_formula() -> None:
    assert max_client_coins(coins_from_quiz=130, stages_started=2, waves_cleared=5) == (
        130 + MAX_CLIENT_BONUS_PER_STAGE * 2 + MAX_CLIENT_BONUS_PER_WAVE * 5
    )
    assert max_client_coins(coins_from_quiz=0, stages_started=0, waves_cleared=0) == 0


def test_validate_finish_passes_contract_example() -> None:
    assert _check(_report()) == []


def test_validate_finish_rejects_stages_over_started() -> None:
    reasons = _check(_report(stages_cleared=4), started=3)
    assert len(reasons) == 1
    assert "stages_cleared" in reasons[0] and "4" in reasons[0] and "3" in reasons[0]


def test_validate_finish_rejects_waves_over_cap() -> None:
    reasons = _check(_report(waves_cleared=10), started=3, wps=3)
    assert len(reasons) == 1
    assert "waves_cleared" in reasons[0] and "10" in reasons[0] and "9" in reasons[0]


@pytest.mark.parametrize("lives", [11, -1])
def test_validate_finish_rejects_lives_out_of_range(lives: int) -> None:
    reasons = _check(_report(lives_left_at_end=lives))
    assert len(reasons) == 1
    assert "lives_left_at_end" in reasons[0]
    assert str(lives) in reasons[0] and str(MAX_LIVES) in reasons[0]


def test_validate_finish_rejects_coins_over_cap() -> None:
    """coins_from_quiz 0, 스테이지 1 시작, 웨이브 0 → 상한 1200: 1200 통과, 1201 거부."""
    ok = _report(stages_cleared=0, waves_cleared=0, lives_left_at_end=10, coins_left_at_end=1200)
    bad = ok.model_copy(update={"coins_left_at_end": 1201})
    assert _check(ok, started=1, quiz_coins=0) == []
    reasons = _check(bad, started=1, quiz_coins=0)
    assert len(reasons) == 1
    assert "coins_left_at_end" in reasons[0] and "1201" in reasons[0] and "1200" in reasons[0]


def test_validate_finish_coin_cap_counts_quiz_coins_and_waves() -> None:
    """서버가 아는 퀴즈 코인과 보고된 웨이브 수가 상한에 더해진다."""
    cap = 130 + MAX_CLIENT_BONUS_PER_STAGE * 1 + MAX_CLIENT_BONUS_PER_WAVE * 2
    report = _report(stages_cleared=1, waves_cleared=2, coins_left_at_end=cap)
    assert _check(report, started=1, quiz_coins=130) == []
    over = report.model_copy(update={"coins_left_at_end": cap + 1})
    assert _check(over, started=1, quiz_coins=130) != []


@pytest.mark.parametrize(
    ("field", "value"),
    [("stages_cleared", -1), ("waves_cleared", -1), ("coins_left_at_end", -1)],
)
def test_validate_finish_rejects_negative_values(field: str, value: int) -> None:
    reasons = _check(_report(**{field: value}))
    assert len(reasons) == 1
    assert field in reasons[0]


def test_validate_finish_reports_multiple_violations() -> None:
    report = _report(
        stages_cleared=4, waves_cleared=99, lives_left_at_end=11, coins_left_at_end=10**9
    )
    reasons = _check(report, started=3, quiz_coins=0)
    assert len(reasons) == 4
    joined = "\n".join(reasons)
    for field in ("stages_cleared", "waves_cleared", "lives_left_at_end", "coins_left_at_end"):
        assert field in joined


def test_validate_finish_uses_waves_per_stage_mode() -> None:
    """같은 보고도 부스(3웨이브)에서는 거부, 전체(5웨이브)에서는 통과."""
    report = _report(stages_cleared=3, waves_cleared=10)
    booth = _check(report, started=3, wps=3)
    assert booth != [] and "waves_cleared" in booth[0]
    assert _check(report, started=3, wps=5) == []


def test_validate_finish_does_not_mutate_report() -> None:
    report = _report()
    before = report.model_dump()
    _check(report)
    assert report.model_dump() == before
