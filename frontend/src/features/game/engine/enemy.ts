/** 몬스터 규칙 — docs/02 §2(체력 배율)·§5(종류별 특징). 순수 함수. */
import { ENEMIES, type EnemyId, stageScale } from '../config/balance'
import type { EnemyState } from './state'

/** 단계별 체력 배율(config/balance.STAGE_SCALE). 보스는 따로 */
export function stageHpMultiplier(stage: number, boss = false): number {
  const scale = stageScale(stage)
  return boss ? scale.bossHp : scale.hp
}

export function createEnemy(id: number, type: EnemyId, stage: number, time: number): EnemyState {
  const spec = ENEMIES[type]
  const hp = Math.round(spec.hp * stageHpMultiplier(stage, spec.boss !== undefined))
  return {
    id,
    type,
    hp,
    maxHp: hp,
    dist: 0,
    spawnedAt: time,
    slowUntil: 0,
    slowFactor: 0,
    alive: true,
    reached: false,
    isBoss: spec.boss !== undefined,
  }
}

/** 유령은 주기의 마지막 hiddenSec 동안 반투명(피격·조준 불가). 나머지는 항상 대상 가능 */
export function isTargetable(enemy: EnemyState, time: number): boolean {
  if (!enemy.alive || enemy.reached) return false
  const phase = ENEMIES[enemy.type].phase
  if (!phase) return true
  const t = (time - enemy.spawnedAt) % phase.periodSec
  return t < phase.periodSec - phase.hiddenSec
}

/** 감속 적용. 골렘은 면역. 더 강한 감속이 들어오면 교체, 같은 세기면 시간 연장 */
export function applySlow(
  enemy: EnemyState,
  factor: number,
  durationSec: number,
  time: number,
): void {
  if (ENEMIES[enemy.type].slowImmune) return
  const until = time + durationSec
  const active = enemy.slowUntil > time
  if (
    !active ||
    factor > enemy.slowFactor ||
    (factor === enemy.slowFactor && until > enemy.slowUntil)
  ) {
    enemy.slowFactor = factor
    enemy.slowUntil = until
  }
}

export function speedOf(enemy: EnemyState, time: number): number {
  const base = ENEMIES[enemy.type].speed
  return enemy.slowUntil > time ? base * (1 - enemy.slowFactor) : base
}

/** 피해를 주고 처치 여부를 돌려준다 */
export function damageEnemy(enemy: EnemyState, amount: number): boolean {
  if (!enemy.alive) return false
  enemy.hp = Math.max(0, enemy.hp - amount)
  if (enemy.hp === 0) {
    enemy.alive = false
    return true
  }
  return false
}

export const killCoins = (type: EnemyId): number => ENEMIES[type].coins
export const baseDamageOf = (type: EnemyId): number => ENEMIES[type].damageToBase
export const vanishesAtBase = (type: EnemyId): boolean => Boolean(ENEMIES[type].vanishAtBase)
