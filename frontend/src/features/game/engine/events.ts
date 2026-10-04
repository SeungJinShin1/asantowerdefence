/**
 * 이벤트 처리 — docs/02 §7. EventBus 는 화면용 구독 도구이고, 아래 함수들은 상태에 보너스를 적용한다.
 * 모든 이벤트는 코인이 늘어나는 보너스뿐이다(감점·코인 감소 없음).
 */
import { MAX_LIVES } from '../config/balance'
import { EVENT_PARAMS } from '../config/events'
import type { EngineEvent, GameState } from './state'

export type Listener<E> = (event: E) => void

/** 아주 작은 타입 안전 이벤트 버스(렌더·토스트·효과음이 엔진 사건을 구독할 때 사용) */
export class EventBus<E extends { type: string }> {
  private readonly listeners = new Map<string, Set<Listener<E>>>()

  on<T extends E['type']>(type: T, fn: Listener<Extract<E, { type: T }>>): () => void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn as Listener<E>)
    this.listeners.set(type, set)
    return () => this.off(type, fn)
  }

  off<T extends E['type']>(type: T, fn: Listener<Extract<E, { type: T }>>): void {
    this.listeners.get(type)?.delete(fn as Listener<E>)
  }

  emit(event: E): void {
    this.listeners.get(event.type)?.forEach((fn) => fn(event))
  }

  emitAll(events: readonly E[]): void {
    events.forEach((e) => this.emit(e))
  }
}

export function coinMultiplier(state: GameState): number {
  return state.doubleCoinUntil > state.time ? EVENT_PARAMS.DOUBLE_COIN_TIME.mult : 1
}

/** 코인 지급(2배 타임 반영). 실제 지급액을 돌려준다 */
export function grantCoins(state: GameState, amount: number): number {
  const granted = Math.round(amount * coinMultiplier(state))
  state.coins += granted
  return granted
}

export function startDoubleCoin(state: GameState): void {
  state.doubleCoinUntil = state.time + EVENT_PARAMS.DOUBLE_COIN_TIME.durationSec
  state.outbox.push({ type: 'game_event', id: 'DOUBLE_COIN_TIME', until: state.doubleCoinUntil })
}

export function waveClearBonus(wave: number): number {
  return EVENT_PARAMS.WAVE_CLEAR_BONUS.perWave * wave
}

export function grantWaveClearBonus(state: GameState, wave: number): number {
  const granted = grantCoins(state, waveClearBonus(wave))
  state.outbox.push({ type: 'game_event', id: 'WAVE_CLEAR_BONUS', coins: granted })
  return granted
}

/** 콤보 5 달성 시 +100, 스테이지당 1회 */
export function checkComboMilestone(state: GameState, combo: number): number {
  if (state.comboMilestoneGiven || combo < EVENT_PARAMS.COMBO_MILESTONE.combo) return 0
  state.comboMilestoneGiven = true
  const granted = grantCoins(state, EVENT_PARAMS.COMBO_MILESTONE.coins)
  state.outbox.push({ type: 'game_event', id: 'COMBO_MILESTONE', coins: granted })
  return granted
}

/** 긴급 퀴즈 정답: 다음 보스 첫 피격 +100 */
export function armEmergencyBonus(state: GameState): void {
  state.bossBonusDamage = EVENT_PARAMS.EMERGENCY_QUIZ.bonusDamage
  state.outbox.push({ type: 'game_event', id: 'EMERGENCY_QUIZ' })
}

/** 스테이지 클리어 시 체력 10 유지 → +100 */
export function grantFullHealthBonus(state: GameState): number {
  if (state.lives < MAX_LIVES) return 0
  const granted = grantCoins(state, EVENT_PARAMS.FULL_HEALTH_BONUS.coins)
  state.outbox.push({ type: 'game_event', id: 'FULL_HEALTH_BONUS', coins: granted })
  return granted
}

export type EngineBus = EventBus<EngineEvent>
