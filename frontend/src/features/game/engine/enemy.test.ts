import { describe, expect, it } from 'vitest'

import {
  applySlow,
  createEnemy,
  damageEnemy,
  isTargetable,
  killCoins,
  speedOf,
  stageHpMultiplier,
} from './enemy'

describe('enemy', () => {
  it('스테이지 체력 배율은 STAGE_SCALE 표(일반·보스 따로), 1단계가 가장 약하다', () => {
    expect([1, 2, 3, 5].map((s) => stageHpMultiplier(s))).toEqual([1, 1.15, 1.3, 1.6])
    expect([1, 3, 5].map((s) => stageHpMultiplier(s, true))).toEqual([0.55, 0.85, 1.15])
    expect(createEnemy(1, 'slime', 3, 0).hp).toBe(52)
    expect(createEnemy(2, 'boss_mid', 1, 0).hp).toBe(220)
    expect(createEnemy(3, 'boss_final', 5, 0).hp).toBe(1035)
    expect(createEnemy(1, 'boss_final', 5, 0).maxHp).toBe(1035)
    expect(createEnemy(1, 'boss_mid', 1, 0).isBoss).toBe(true)
    expect(createEnemy(1, 'bat', 1, 0).isBoss).toBe(false)
  })

  it('유령은 2초 주기의 마지막 0.5초 동안 피격 불가', () => {
    const ghost = createEnemy(1, 'ghost', 1, 10)
    expect(isTargetable(ghost, 10.2)).toBe(true)
    expect(isTargetable(ghost, 11.4)).toBe(true)
    expect(isTargetable(ghost, 11.6)).toBe(false)
    expect(isTargetable(ghost, 11.99)).toBe(false)
    expect(isTargetable(ghost, 12.1)).toBe(true)
    const slime = createEnemy(2, 'slime', 1, 10)
    expect(isTargetable(slime, 11.7)).toBe(true)
  })

  it('죽었거나 성에 닿은 몬스터는 대상이 아니다', () => {
    const slime = createEnemy(1, 'slime', 1, 0)
    slime.alive = false
    expect(isTargetable(slime, 1)).toBe(false)
    const bat = createEnemy(2, 'bat', 1, 0)
    bat.reached = true
    expect(isTargetable(bat, 1)).toBe(false)
  })

  it('감속: 30% 1.5초, 만료 후 원래 속도, 골렘은 면역', () => {
    const slime = createEnemy(1, 'slime', 1, 0)
    applySlow(slime, 0.3, 1.5, 5)
    expect(speedOf(slime, 5.5)).toBeCloseTo(0.7)
    expect(speedOf(slime, 6.6)).toBe(1.0)

    const golem = createEnemy(2, 'golem', 1, 0)
    applySlow(golem, 0.3, 1.5, 5)
    expect(speedOf(golem, 5.5)).toBe(0.6)
  })

  it('감속 갱신: 더 강한 감속이 우선, 같은 세기는 시간 연장', () => {
    const bat = createEnemy(1, 'bat', 1, 0)
    applySlow(bat, 0.3, 1.5, 0)
    applySlow(bat, 0.1, 5, 0.5) // 더 약하므로 무시
    expect(bat.slowFactor).toBe(0.3)
    expect(bat.slowUntil).toBe(1.5)
    applySlow(bat, 0.3, 1.5, 1.0) // 같은 세기 → 연장
    expect(bat.slowUntil).toBe(2.5)
    applySlow(bat, 0.5, 1, 1.2) // 더 강함 → 교체
    expect(bat.slowFactor).toBe(0.5)
  })

  it('피해와 처치, 처치 코인', () => {
    const slime = createEnemy(1, 'slime', 1, 0)
    expect(damageEnemy(slime, 30)).toBe(false)
    expect(slime.hp).toBe(10)
    expect(damageEnemy(slime, 30)).toBe(true)
    expect(slime.hp).toBe(0)
    expect(slime.alive).toBe(false)
    expect(damageEnemy(slime, 10)).toBe(false) // 이미 죽음
    expect(killCoins('golden_slime')).toBe(50)
    expect(killCoins('boss_final')).toBe(120)
  })
})
