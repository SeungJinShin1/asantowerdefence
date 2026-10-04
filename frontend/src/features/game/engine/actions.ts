/** 플레이어·서버 입력을 상태에 반영하는 액션들(건설·업그레이드·판매·퀴즈 결과·재개). 순수 함수. */
import type { TowerId } from '../config/balance'
import { armEmergencyBonus, checkComboMilestone } from './events'
import { type GameContext, nextId } from './loop'
import type { GameState, QuizTriggerKind } from './state'
import {
  buildCost,
  canBuildAt,
  createTower,
  isTowerUnlocked,
  sellValue,
  upgradeCost,
  upgradeTower,
} from './tower'

export type ActionResult = { ok: true } | { ok: false; reason: string }

export function placeTower(
  state: GameState,
  ctx: GameContext,
  type: TowerId,
  tile: { x: number; y: number },
): ActionResult {
  if (!isTowerUnlocked(type, state.stage))
    return { ok: false, reason: '아직 열리지 않은 타워예요.' }
  if (!canBuildAt(ctx.map, ctx.path, state.towers, tile))
    return { ok: false, reason: '여기에는 지을 수 없어요.' }
  const cost = buildCost(type)
  if (state.coins < cost) return { ok: false, reason: '코인이 부족해요.' }
  state.coins -= cost
  state.towers.push(createTower(nextId(state), type, tile))
  return { ok: true }
}

export function upgradeTowerById(state: GameState, towerId: number): ActionResult {
  const index = state.towers.findIndex((t) => t.id === towerId)
  const tower = state.towers[index]
  if (!tower) return { ok: false, reason: '타워를 찾을 수 없어요.' }
  const cost = upgradeCost(tower.type, tower.level)
  if (cost === null) return { ok: false, reason: '이미 최고 레벨이에요.' }
  if (state.coins < cost) return { ok: false, reason: '코인이 부족해요.' }
  state.coins -= cost
  state.towers[index] = upgradeTower(tower)
  return { ok: true }
}

export function sellTowerById(state: GameState, towerId: number): ActionResult {
  const tower = state.towers.find((t) => t.id === towerId)
  if (!tower) return { ok: false, reason: '타워를 찾을 수 없어요.' }
  state.coins += sellValue(tower)
  state.towers = state.towers.filter((t) => t.id !== towerId)
  return { ok: true }
}

export interface QuizOutcome {
  kind: QuizTriggerKind
  correct: boolean
  /** 서버가 계산한 지급 코인(2배 타임 포함) */
  coins: number
  combo: number
}

/** 서버 채점 결과 반영: 코인은 서버 값 그대로, 콤보 마일스톤·긴급 퀴즈 보상은 클라이언트 이벤트 */
export function applyQuizOutcome(state: GameState, outcome: QuizOutcome): void {
  state.coins += Math.max(0, outcome.coins)
  checkComboMilestone(state, outcome.combo)
  if (outcome.kind === 'emergency' && outcome.correct) armEmergencyBonus(state)
}

/** 퀴즈(또는 러시 묶음)가 끝났을 때 게임 재개 */
export function resumeAfterQuiz(state: GameState): void {
  state.pendingQuiz = null
  state.paused = false
}

export function setPaused(state: GameState, paused: boolean): void {
  if (state.pendingQuiz) return // 퀴즈 중에는 수동 재개 불가
  state.paused = paused
}
