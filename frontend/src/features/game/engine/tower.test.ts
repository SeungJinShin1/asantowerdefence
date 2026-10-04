import { describe, expect, it } from 'vitest'

import { ONYANG_MAP } from '../config/maps/onyang'
import { createEnemy } from './enemy'
import { buildPath } from './path'
import { createProjectile, stepProjectile } from './projectile'
import type { EnemyState } from './state'
import {
  canBuildAt,
  createTower,
  selectTarget,
  sellValue,
  towerStats,
  upgradeCost,
  upgradeTower,
} from './tower'

// 가로 일직선 경로: (0,2) → (10,2). 타워는 (5,0) 에 두면 경로까지 거리 2
const line = buildPath([
  { x: 0, y: 2 },
  { x: 10, y: 2 },
])

function enemyAt(
  id: number,
  dist: number,
  type: Parameters<typeof createEnemy>[1] = 'slime',
): EnemyState {
  const e = createEnemy(id, type, 1, 0)
  e.dist = dist
  return e
}

describe('towerStats / upgrade / sell', () => {
  it('레벨당 피해 +40%, 사거리 +10%', () => {
    expect(towerStats('onsen', 1)).toEqual({ damage: 6, range: 2 })
    expect(towerStats('onsen', 2).damage).toBeCloseTo(8.4)
    expect(towerStats('onsen', 2).range).toBeCloseTo(2.2)
    expect(towerStats('onsen', 3).damage).toBeCloseTo(10.8)
    expect(towerStats('onsen', 3).range).toBeCloseTo(2.4)
  })

  it('업그레이드 비용 ×0.6, ×0.8, 3레벨이 최대. 판매는 투자액의 60%', () => {
    expect(upgradeCost('onsen', 1)).toBe(30)
    expect(upgradeCost('onsen', 2)).toBe(40)
    expect(upgradeCost('onsen', 3)).toBeNull()
    const t1 = createTower(1, 'onsen', { x: 5, y: 0 })
    expect(t1.invested).toBe(50)
    const t2 = upgradeTower(t1)
    const t3 = upgradeTower(t2)
    expect(t3.level).toBe(3)
    expect(t3.invested).toBe(120)
    expect(upgradeTower(t3)).toBe(t3)
    expect(sellValue(t3)).toBe(72)
    expect(sellValue(t1)).toBe(30)
  })
})

describe('canBuildAt', () => {
  const path = buildPath(ONYANG_MAP.waypoints)
  it('경로·막힌 타일·격자 밖·이미 지은 자리는 불가', () => {
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 5, y: 5 })).toBe(true)
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 1, y: 4 })).toBe(false) // 경로
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 15, y: 3 })).toBe(false) // 성(경로 끝)
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 1, y: 1 })).toBe(false) // blocked
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 16, y: 0 })).toBe(false)
    expect(canBuildAt(ONYANG_MAP, path, [], { x: 2.5, y: 0 })).toBe(false)
    const existing = [createTower(1, 'onsen', { x: 5, y: 5 })]
    expect(canBuildAt(ONYANG_MAP, path, existing, { x: 5, y: 5 })).toBe(false)
  })
})

describe('selectTarget', () => {
  it('기본은 사거리 안에서 성에 가장 가까운(진행 거리 최대) 적', () => {
    const tower = createTower(1, 'onsen', { x: 5, y: 1 }) // 중심 (5.5, 1.5), 경로 y=2.5 → 수직 거리 1
    const far = enemyAt(1, 6.0) // (6.5, 2.5) → 거리 √2 ≈ 1.41, 사거리 2.0 안
    const near = enemyAt(2, 4.0)
    const outside = enemyAt(3, 9.0)
    expect(selectTarget(tower, [near, far, outside], line, 0)?.id).toBe(1)
  })

  it('거북선은 체력이 가장 높은 적을, 숨은 유령은 무시한다', () => {
    const tower = createTower(1, 'geobukseon', { x: 5, y: 1 })
    const golem = enemyAt(1, 5.0, 'golem')
    const slime = enemyAt(2, 5.6)
    expect(selectTarget(tower, [slime, golem], line, 0)?.id).toBe(1)

    const ghost = enemyAt(3, 5.5, 'ghost') // spawnedAt 0 → 1.5~2.0 초 사이 숨음
    const onsen = createTower(2, 'onsen', { x: 5, y: 1 })
    expect(selectTarget(onsen, [ghost], line, 1.7)).toBeNull()
    expect(selectTarget(onsen, [ghost], line, 1.0)?.id).toBe(3)
  })

  it('사거리 안에 아무도 없으면 null', () => {
    const tower = createTower(1, 'onsen', { x: 5, y: 0 })
    expect(selectTarget(tower, [enemyAt(1, 0.5)], line, 0)).toBeNull()
  })
})

describe('projectiles', () => {
  function flyUntilDone(p: ReturnType<typeof createProjectile>, enemies: EnemyState[], time = 0) {
    const hits = []
    for (let i = 0; i < 600 && p.alive; i += 1)
      hits.push(...stepProjectile(p, enemies, line, time, 1 / 60))
    return hits
  }

  it('유도 투사체는 대상을 맞혀 피해를 준다 (대상이 움직여도)', () => {
    const tower = createTower(1, 'mansae', { x: 5, y: 0 })
    const slime = enemyAt(1, 5.5)
    const p = createProjectile(10, tower, slime, line)
    const hits = []
    for (let i = 0; i < 300 && p.alive; i += 1) {
      slime.dist += 1.0 / 60
      hits.push(...stepProjectile(p, [slime], line, 0, 1 / 60))
    }
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ enemyId: 1, damage: 5, killed: false })
    expect(slime.hp).toBe(35)
  })

  it('종탑은 반지름 1타일 범위 피해, 온천은 감속을 건다', () => {
    const bell = createTower(1, 'bell', { x: 5, y: 0 })
    const a = enemyAt(1, 5.5)
    const b = enemyAt(2, 6.2) // 0.7 타일 옆
    const c = enemyAt(3, 7.5) // 2 타일 옆 — 범위 밖
    const hits = flyUntilDone(createProjectile(10, bell, a, line), [a, b, c])
    expect(hits.map((h) => h.enemyId).sort()).toEqual([1, 2])
    expect(c.hp).toBe(40)

    const onsen = createTower(2, 'onsen', { x: 5, y: 0 })
    const d = enemyAt(4, 5.5)
    flyUntilDone(createProjectile(11, onsen, d, line), [d], 3)
    expect(d.slowFactor).toBe(0.3)
    expect(d.slowUntil).toBeCloseTo(4.5)
  })

  it('피리는 직선으로 최대 3마리를 관통한다', () => {
    const piri = createTower(1, 'piri', { x: 5, y: 2 }) // 경로 위에 두고 오른쪽으로 쏘게 한다(테스트용)
    const targets = [enemyAt(1, 6.5), enemyAt(2, 7.2), enemyAt(3, 7.9), enemyAt(4, 8.4)]
    const p = createProjectile(10, piri, targets[0]!, line)
    expect(p.targetId).toBeNull()
    const hits = flyUntilDone(p, targets)
    expect(hits.map((h) => h.enemyId)).toEqual([1, 2, 3])
    expect(targets[3]!.hp).toBe(40)
  })

  it('거북선은 보스에 +50% 피해, 긴급 퀴즈 보너스는 보스 첫 피격에 한 번만', () => {
    const geo = createTower(1, 'geobukseon', { x: 5, y: 0 })
    const boss = enemyAt(1, 5.5, 'boss_mid')
    const p = createProjectile(10, geo, boss, line)
    const hits = []
    for (let i = 0; i < 300 && p.alive; i += 1)
      hits.push(...stepProjectile(p, [boss], line, 0, 1 / 60, 100))
    expect(hits[0]!.damage).toBe(145) // 30 × 1.5 + 100
    expect(boss.hp).toBe(400 - 145)

    const slime = enemyAt(2, 5.5)
    const p2 = createProjectile(11, geo, slime, line)
    const hits2 = flyUntilDone(p2, [slime])
    expect(hits2[0]!.damage).toBe(30)
  })

  it('대상이 먼저 죽으면 마지막 위치로 날아가 범위 피해만 준다', () => {
    const bell = createTower(1, 'bell', { x: 5, y: 0 })
    const a = enemyAt(1, 5.5)
    const b = enemyAt(2, 5.9)
    const p = createProjectile(10, bell, a, line)
    a.alive = false
    const hits = flyUntilDone(p, [a, b])
    expect(hits.map((h) => h.enemyId)).toEqual([2])
    expect(p.alive).toBe(false)
  })
})
