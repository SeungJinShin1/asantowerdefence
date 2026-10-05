import { describe, expect, it } from 'vitest'

import { fakeCanvas } from '@/test/fakeCanvas'

import { TOWER_ORDER, type TowerId } from '../config/balance'
import { createEnemy } from '../engine/enemy'
import { buildPath } from '../engine/path'
import { createProjectile } from '../engine/projectile'
import { createTower } from '../engine/tower'
import { drawProjectile, projectileAngle } from './projectiles'

// 가로 일직선 경로 (0,2) → (10,2). 타워는 (5,0)
const line = buildPath([
  { x: 0, y: 2 },
  { x: 10, y: 2 },
])

function projectileOf(type: TowerId) {
  const tower = createTower(1, type, { x: 5, y: 0 })
  const enemy = createEnemy(2, 'slime', 1, 0)
  enemy.dist = 5.0 // 경로는 타일 중심 (0.5, 2.5) 에서 시작 → (5.5, 2.5): 타워 바로 아래
  return createProjectile(10, tower, enemy, line)
}

describe('발사체 방향', () => {
  it('유도 발사체는 대상 쪽을, 관통 발사체는 처음 쏜 방향을 본다', () => {
    const homing = projectileOf('geobukseon') // 타워 (5.5,0.5) → 대상 (5.5,2.5): 아래쪽
    expect(projectileAngle(homing)).toBeCloseTo(Math.PI / 2)
    homing.lastTargetPos = { x: homing.pos.x + 3, y: homing.pos.y } // 대상이 오른쪽으로 이동
    expect(projectileAngle(homing)).toBeCloseTo(0)

    const pierce = projectileOf('piri')
    expect(pierce.targetId).toBeNull()
    pierce.lastTargetPos = { x: 0, y: 0 } // 관통은 대상 위치와 무관
    expect(projectileAngle(pierce)).toBeCloseTo(Math.PI / 2)
  })
})

describe('타워마다 다른 발사체 모양', () => {
  it('5종 모두 오류 없이 그리고, 그리는 방식이 서로 다르다', () => {
    const shapes = TOWER_ORDER.map((type) => {
      const { ctx, calls } = fakeCanvas()
      expect(() => drawProjectile(ctx, projectileOf(type), 1.23)).not.toThrow()
      expect(calls[0]).toBe('save')
      expect(calls.at(-1)).toBe('restore')
      expect(calls).toContain('rotate') // 진행 방향으로 돌려 그린다
      return calls.join(',')
    })
    expect(new Set(shapes).size).toBe(TOWER_ORDER.length)
  })

  it('화살(만세)은 선으로, 대포알(거북선)은 원으로 그린다', () => {
    const arrow = fakeCanvas()
    drawProjectile(arrow.ctx, projectileOf('mansae'), 0)
    expect(arrow.calls).toContain('lineTo')

    const ball = fakeCanvas()
    drawProjectile(ball.ctx, projectileOf('geobukseon'), 0)
    expect(ball.calls).not.toContain('lineTo')
    expect(ball.calls.filter((c) => c === 'arc').length).toBeGreaterThanOrEqual(5) // 연기 3 + 불꽃 + 포탄 + 광택
  })
})
