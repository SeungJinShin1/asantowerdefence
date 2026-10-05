/**
 * 투사체 — docs/02 §4 특징: 유도(단일/범위/감속), 직선 관통(피리 기본 3마리), 보스 추가 피해(거북선 +50%).
 * 폭탄·관통 업그레이드는 towerStats 로 반영된 splashRadius·pierce 를 그대로 쓴다. 순수 함수.
 */
import { TOWERS } from '../config/balance'
import { applySlow, damageEnemy, isTargetable } from './enemy'
import { type PathData, type Vec, distance, positionAt } from './path'
import type { EnemyState, ProjectileState, TowerState } from './state'
import { towerCenter, towerStats } from './tower'

/** 대상에 이 거리 안으로 들어오면 명중 */
export const HIT_RADIUS = 0.3
/** 관통 투사체가 지나가며 맞히는 반경 */
export const PIERCE_RADIUS = 0.45
/** 관통 투사체 최대 비행 거리(사거리 + 여유) */
const PIERCE_EXTRA_TRAVEL = 1.5

export interface Hit {
  enemyId: number
  damage: number
  killed: boolean
  pos: Vec
}

export function createProjectile(
  id: number,
  tower: TowerState,
  target: EnemyState,
  path: PathData,
): ProjectileState {
  const spec = TOWERS[tower.type]
  const {
    damage,
    range,
    splashRadius,
    pierce: pierceCount,
  } = towerStats(tower.type, tower.upgrades)
  const from = towerCenter(tower)
  const targetPos = positionAt(path, target.dist)
  const dx = targetPos.x - from.x
  const dy = targetPos.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const pierce = spec.projectile === 'pierce'
  return {
    id,
    tower: tower.type,
    pos: { ...from },
    speed: spec.projectileSpeed,
    damage,
    targetId: pierce ? null : target.id,
    lastTargetPos: targetPos,
    dir: { x: dx / len, y: dy / len },
    pierceLeft: pierce ? pierceCount : 1,
    hitIds: [],
    splashRadius,
    slow: spec.slow ?? null,
    bossBonus: spec.bossBonus ?? 0,
    traveled: 0,
    maxTravel: pierce ? range + PIERCE_EXTRA_TRAVEL : Number.POSITIVE_INFINITY,
    alive: true,
  }
}

function damageFor(p: ProjectileState, enemy: EnemyState): number {
  return enemy.isBoss ? p.damage * (1 + p.bossBonus) : p.damage
}

function strike(p: ProjectileState, enemy: EnemyState, time: number, extraDamage: number): Hit {
  const damage = damageFor(p, enemy) + extraDamage
  const killed = damageEnemy(enemy, damage)
  if (p.slow) applySlow(enemy, p.slow.factor, p.slow.durationSec, time)
  p.hitIds.push(enemy.id)
  return { enemyId: enemy.id, damage, killed, pos: p.pos }
}

/**
 * 한 스텝 진행. 명중 목록을 돌려준다.
 * @param bonusOnBoss 보스 첫 피격에 더할 추가 피해(긴급 퀴즈 보상). 사용하면 호출자가 0으로 되돌린다
 */
export function stepProjectile(
  p: ProjectileState,
  enemies: readonly EnemyState[],
  path: PathData,
  time: number,
  dt: number,
  bonusOnBoss = 0,
): Hit[] {
  if (!p.alive) return []
  const hits: Hit[] = []
  const stepLen = p.speed * dt

  if (p.targetId === null) {
    // 직선 관통
    p.pos = { x: p.pos.x + p.dir.x * stepLen, y: p.pos.y + p.dir.y * stepLen }
    p.traveled += stepLen
    for (const enemy of enemies) {
      if (p.pierceLeft <= 0) break
      if (p.hitIds.includes(enemy.id) || !isTargetable(enemy, time)) continue
      if (distance(p.pos, positionAt(path, enemy.dist)) <= PIERCE_RADIUS) {
        const extra =
          enemy.isBoss && bonusOnBoss > 0 && !hits.some((h) => h.enemyId === enemy.id)
            ? bonusOnBoss
            : 0
        hits.push(strike(p, enemy, time, extra))
        if (extra > 0) bonusOnBoss = 0
        p.pierceLeft -= 1
      }
    }
    if (p.pierceLeft <= 0 || p.traveled >= p.maxTravel) p.alive = false
    return hits
  }

  // 유도: 대상이 살아 있으면 현재 위치로, 아니면 마지막 위치로
  const target = enemies.find((e) => e.id === p.targetId)
  if (target && target.alive && !target.reached) p.lastTargetPos = positionAt(path, target.dist)
  const goal = p.lastTargetPos
  const gap = distance(p.pos, goal)
  if (gap > stepLen + HIT_RADIUS) {
    p.pos = {
      x: p.pos.x + ((goal.x - p.pos.x) / gap) * stepLen,
      y: p.pos.y + ((goal.y - p.pos.y) / gap) * stepLen,
    }
    return hits
  }

  // 도착 — 폭발
  p.pos = { ...goal }
  p.alive = false
  const radius = p.splashRadius
  const primary = target && isTargetable(target, time) ? target : null
  if (primary) {
    const extra = primary.isBoss ? bonusOnBoss : 0
    hits.push(strike(p, primary, time, extra))
    if (extra > 0) bonusOnBoss = 0
  }
  if (radius > 0) {
    for (const enemy of enemies) {
      if (enemy === primary || !isTargetable(enemy, time)) continue
      if (distance(goal, positionAt(path, enemy.dist)) <= radius) {
        const extra = enemy.isBoss ? bonusOnBoss : 0
        hits.push(strike(p, enemy, time, extra))
        if (extra > 0) bonusOnBoss = 0
      }
    }
  }
  return hits
}
