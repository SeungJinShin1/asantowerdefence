/**
 * 교사(검수) 도구 — 교사 모드에서만 쓰는 순수 액션(docs/02 §1 교사 모드).
 * 학생 화면에는 버튼이 없고, 서버는 교사 세션의 기록을 리더보드에 올리지 않는다(docs/04 §7).
 */
import type { ActionResult } from './actions'
import type { GameState } from './state'

/** '코인 받기' 한 번에 주는 코인 */
export const TEACHER_COIN_GRANT = 500

/** 검수용 코인 지급: 타워·업그레이드를 바로 살펴볼 수 있게 한다 */
export function grantReviewCoins(state: GameState, amount = TEACHER_COIN_GRANT): ActionResult {
  if (state.status !== 'playing') return { ok: false, reason: '게임이 끝났어요.' }
  state.coins += Math.max(0, amount)
  return { ok: true }
}

/**
 * 웨이브 건너뛰기: 남은 몬스터·스폰을 지우고 '전투 끝' 상태로 만든다.
 * 다음 step 에서 엔진의 정상 경로로 웨이브 클리어(보너스·다음 준비·마지막이면 승리)가 처리된다.
 * 준비 시간에 누르면 다음 웨이브를 통째로 건너뛴다. 퀴즈가 떠 있으면 먼저 풀어야 한다.
 */
export function skipWave(state: GameState): ActionResult {
  if (state.status !== 'playing') return { ok: false, reason: '게임이 끝났어요.' }
  if (state.pendingQuiz) return { ok: false, reason: '문제를 먼저 풀어 주세요.' }
  if (state.wavePhase === 'prep') {
    if (state.wave >= state.wavesPerStage) return { ok: false, reason: '마지막 웨이브예요.' }
    state.wave += 1
    state.outbox.push({ type: 'wave_started', wave: state.wave })
  }
  state.spawnQueue = []
  state.enemies = []
  state.projectiles = []
  state.quizMarks = []
  state.wavePhase = 'fighting'
  state.phaseTimer = 0
  state.paused = false
  return { ok: true }
}
