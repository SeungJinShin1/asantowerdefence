"""코인·콤보·점수 공식과 finish 상한 검증 — 밸런스 숫자의 단일 출처.

근거: docs/02_game_design.md §6 코인 보상, §9 점수 공식·검증. 순수 모듈 — FastAPI·DB·시간 의존 없음, models만 import.

보안(중요 로직 서버 측 검증): 코인·콤보·점수는 이 모듈로만 계산하고 클라이언트는 표시만 한다.
클라이언트가 보고하는 finish 값(wavesCleared·stagesCleared·lives·coins)은 validate_finish 로 상한을 검증해
초과 시 거부한다. 감점·코인 감소형 규칙은 없다(오답·시간 초과는 0 코인, 콤보 초기화뿐).
보안(에러 로그): validate_finish 의 사유 문자열은 서버 로그용이다. 응답에는 code·message만 나가야 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.models import FinishReport, QuizKind, ScoreBreakdown

# ---------- 스테이지·세션 ----------

WAVES_PER_STAGE_BOOTH = 3  # 부스 모드: 짧은 플레이
WAVES_PER_STAGE_FULL = 5  # 전체 모드
STAGE_COUNT = 5  # 주제 5개 = 스테이지 5개 (models.TOPIC_IDS 와 같아야 함)
MAX_LIVES = 10  # 성(기지) 체력
START_COINS = 100  # 스테이지 시작 코인 (클라이언트 지급)
LEARN_BONUS = 50  # 학습 완료 보너스 (클라이언트 지급)

# ---------- 퀴즈 출제 ----------

QUIZ_TIME_LIMIT_SEC = 15  # 팝업 제한시간
QUIZ_BATCH_NORMAL = 12  # 스테이지 시작 배치: 일반
QUIZ_BATCH_EMERGENCY = 2  # 스테이지 시작 배치: 긴급(보스 직전)
QUIZ_BATCH_RUSH = 3  # 스테이지 시작 배치: 역사 러시
QUIZ_MORE_DEFAULT = 5  # quiz/more 기본 개수
QUIZ_MORE_MAX = 10  # quiz/more 최대 개수
MAX_QUIZZES_PER_SESSION = 200  # 세션당 출제 상한(저장 문서 크기 보호)

# ---------- 코인 보상 (docs/02 §6) ----------

BASE_COINS: dict[QuizKind, int] = {"normal": 30, "emergency": 50, "rush": 40}
FAST_BONUS = 10  # 빠른 정답 보너스
FAST_ANSWER_MS = 5000  # 이 시간 이내(포함) 정답이면 빠른 정답
DOUBLE_COIN_MULT = 2  # 코인 2배 타임 배율
DOUBLE_COIN_SECONDS = 20  # 중간보스 처치 후 2배 타임 지속 시간
COMBO_MULT_MAX = 3  # 콤보 배율 상한 (3연속 이상 ×3)

# ---------- 점수 (docs/02 §9) ----------

SCORE_PER_CORRECT = 100
SCORE_PER_COMBO_MAX = 50
SCORE_PER_WAVE = 150
SCORE_PER_STAGE = 500
SCORE_PER_LIFE = 30
SCORE_COINS_CAP = 500  # 남은 코인 환산 상한

# ---------- finish 상한 (docs/02 §9 검증) ----------

# 스테이지당 클라이언트가 지급할 수 있는 코인의 상한.
# 근거: 시작 100 + 학습 50 + 만피 100 + 콤보 마일스톤 100 + 중간보스 60 + 최종보스 120 = 530,
#       2배 타임 여유로 ×2 ≈ 1100.
MAX_CLIENT_BONUS_PER_STAGE = 1100
# 웨이브당 클라이언트가 지급할 수 있는 코인의 상한.
# 근거(부스 3웨이브 기준, 가장 큰 웨이브 37마리): 처치 코인 ≈ 212 + 황금 슬라임 50 + 최종보스 120
#       + 웨이브 보너스 최대 100 = 482, 2배 타임 여유 ×2 ≈ 964 → 1000.
MAX_CLIENT_BONUS_PER_WAVE = 1000


def waves_per_stage(booth_mode: bool) -> int:
    """모드별 스테이지당 웨이브 수."""
    return WAVES_PER_STAGE_BOOTH if booth_mode else WAVES_PER_STAGE_FULL


def combo_multiplier(combo: int) -> int:
    """콤보 배율: 콤보 ≤1 → 1, 2 → 2, ≥3 → 3(상한)."""
    if combo <= 1:
        return 1
    return min(combo, COMBO_MULT_MAX)


def next_combo(combo: int, correct: bool) -> int:
    """정답이면 콤보 +1, 오답·시간 초과면 0으로 초기화."""
    return combo + 1 if correct else 0


@dataclass(frozen=True)
class CoinAward:
    """퀴즈 1건의 코인 지급 결과와 분해(docs/03 answer 응답의 breakdown)."""

    coins: int
    base: int
    combo_mult: int
    fast_bonus: int
    event_mult: int


def award_coins(
    kind: QuizKind,
    *,
    correct: bool,
    combo_after: int,
    answered_ms: int,
    double_coin_active: bool,
) -> CoinAward:
    """코인 보상 공식 (docs/02 §6).

    정답: coins = (base × comboMult + fastBonus) × eventMult.
    오답(시간 초과 포함): coins 0. base는 종류의 base, combo_mult 1, fast_bonus 0,
    event_mult는 활성 여부 그대로(표시용). 감점은 없다.
    """
    base = BASE_COINS[kind]
    event_mult = DOUBLE_COIN_MULT if double_coin_active else 1
    if not correct:
        return CoinAward(coins=0, base=base, combo_mult=1, fast_bonus=0, event_mult=event_mult)
    combo_mult = combo_multiplier(combo_after)
    fast_bonus = FAST_BONUS if answered_ms <= FAST_ANSWER_MS else 0
    coins = (base * combo_mult + fast_bonus) * event_mult
    return CoinAward(
        coins=coins,
        base=base,
        combo_mult=combo_mult,
        fast_bonus=fast_bonus,
        event_mult=event_mult,
    )


def compute_score(
    *,
    correct_count: int,
    combo_max: int,
    waves_cleared: int,
    stages_cleared: int,
    lives_left: int,
    coins_left: int,
) -> tuple[int, ScoreBreakdown]:
    """점수 공식 (docs/02 §9). 입력은 validate_finish 를 통과한 값이어야 한다.

    breakdown 각 항목은 점수 기여분(가중치 적용 후)이며 score는 그 합이다.
    """
    breakdown = ScoreBreakdown(
        correct=correct_count * SCORE_PER_CORRECT,
        combo=combo_max * SCORE_PER_COMBO_MAX,
        waves=waves_cleared * SCORE_PER_WAVE,
        stages=stages_cleared * SCORE_PER_STAGE,
        lives=lives_left * SCORE_PER_LIFE,
        coins=min(coins_left, SCORE_COINS_CAP),
    )
    score = (
        breakdown.correct
        + breakdown.combo
        + breakdown.waves
        + breakdown.stages
        + breakdown.lives
        + breakdown.coins
    )
    return score, breakdown


def max_client_coins(*, coins_from_quiz: int, stages_started: int, waves_cleared: int) -> int:
    """클라이언트가 보고할 수 있는 남은 코인의 상한 (docs/02 §9 검증 식)."""
    return (
        coins_from_quiz
        + MAX_CLIENT_BONUS_PER_STAGE * stages_started
        + MAX_CLIENT_BONUS_PER_WAVE * waves_cleared
    )


def validate_finish(
    report: FinishReport,
    *,
    stages_started: int,
    waves_per_stage: int,
    coins_from_quiz: int,
) -> list[str]:
    """finish 보고값의 상한 검증 (docs/02 §9). 위반 사유 목록을 돌려주며 비어 있으면 통과.

    사유 문자열은 필드 이름·값·상한을 담은 서버 로그용이다(응답에 넣지 않는다).
    client_score는 참고값일 뿐 서버 점수를 쓰므로 검증하지 않는다(docs/03 finish).
    """
    reasons: list[str] = []

    if report.stages_cleared < 0:
        reasons.append(f"stages_cleared={report.stages_cleared} < 0")
    elif report.stages_cleared > stages_started:
        reasons.append(f"stages_cleared={report.stages_cleared} > stages_started={stages_started}")

    max_waves = waves_per_stage * stages_started
    if report.waves_cleared < 0:
        reasons.append(f"waves_cleared={report.waves_cleared} < 0")
    elif report.waves_cleared > max_waves:
        reasons.append(
            f"waves_cleared={report.waves_cleared} > waves_per_stage={waves_per_stage}"
            f" x stages_started={stages_started} = {max_waves}"
        )

    if not 0 <= report.lives_left_at_end <= MAX_LIVES:
        reasons.append(f"lives_left_at_end={report.lives_left_at_end} not in [0, {MAX_LIVES}]")

    coin_cap = max_client_coins(
        coins_from_quiz=coins_from_quiz,
        stages_started=stages_started,
        waves_cleared=report.waves_cleared,
    )
    if report.coins_left_at_end < 0:
        reasons.append(f"coins_left_at_end={report.coins_left_at_end} < 0")
    elif report.coins_left_at_end > coin_cap:
        reasons.append(
            f"coins_left_at_end={report.coins_left_at_end} > max_client_coins={coin_cap}"
            f" (coins_from_quiz={coins_from_quiz}, stages_started={stages_started},"
            f" waves_cleared={report.waves_cleared})"
        )

    return reasons
