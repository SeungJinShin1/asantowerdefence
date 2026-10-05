/**
 * 이벤트 정의 데이터 — docs/02 §7. 모두 보너스이며 감점·코인 감소형 이벤트는 없다.
 * 엔진(engine/events.ts)은 이 표를 읽어 발동·해제만 처리한다. 새 이벤트 = 여기 1줄 + 핸들러 1개.
 */

export type GameEventId =
  | 'DOUBLE_COIN_TIME'
  | 'GOLDEN_SLIME'
  | 'WAVE_CLEAR_BONUS'
  | 'FAST_ANSWER_BONUS'
  | 'HISTORY_RUSH'
  | 'EMERGENCY_QUIZ'
  | 'FULL_HEALTH_BONUS'
  | 'COMBO_MILESTONE'

export interface GameEventDef {
  id: GameEventId
  title: string
  description: string
}

export const EVENT_DEFS: Record<GameEventId, GameEventDef> = {
  DOUBLE_COIN_TIME: {
    id: 'DOUBLE_COIN_TIME',
    title: '코인 2배 타임!',
    description: '20초 동안 모든 코인 ×2',
  },
  GOLDEN_SLIME: {
    id: 'GOLDEN_SLIME',
    title: '황금 슬라임 등장!',
    description: '처치하면 +50 코인',
  },
  WAVE_CLEAR_BONUS: {
    id: 'WAVE_CLEAR_BONUS',
    title: '웨이브 클리어!',
    description: '+20 × 웨이브 번호 코인',
  },
  FAST_ANSWER_BONUS: { id: 'FAST_ANSWER_BONUS', title: '빠른 정답!', description: '+10 코인' },
  HISTORY_RUSH: { id: 'HISTORY_RUSH', title: '역사 러시!', description: '2문제 연속 도전!' },
  EMERGENCY_QUIZ: {
    id: 'EMERGENCY_QUIZ',
    title: '긴급 퀴즈!',
    description: '정답이면 보스 첫 피격 +100',
  },
  FULL_HEALTH_BONUS: {
    id: 'FULL_HEALTH_BONUS',
    title: '완벽 방어!',
    description: '체력 10 유지 +100 코인',
  },
  COMBO_MILESTONE: { id: 'COMBO_MILESTONE', title: '5연속 정답!', description: '+100 코인' },
}

export const EVENT_PARAMS = {
  DOUBLE_COIN_TIME: { durationSec: 20, mult: 2 },
  WAVE_CLEAR_BONUS: { perWave: 20 },
  COMBO_MILESTONE: { combo: 5, coins: 100 },
  EMERGENCY_QUIZ: { bonusDamage: 100 },
  FULL_HEALTH_BONUS: { coins: 100 },
  HISTORY_RUSH: { count: 2, windowSec: 20 },
  FAST_ANSWER_BONUS: { coins: 10, withinMs: 5000 },
} as const
