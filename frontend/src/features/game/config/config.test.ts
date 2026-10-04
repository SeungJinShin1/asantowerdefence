import { describe, expect, it } from 'vitest'

import { ENEMIES, TOWERS, TOWER_ORDER, UPGRADE } from './balance'
import { EVENT_DEFS, EVENT_PARAMS } from './events'
import { BOOTH_WAVES, FULL_WAVES, totalEnemies, wavesFor } from './waves'

describe('balance — docs/02 §4·§5 표', () => {
  it('타워 5종의 비용·사거리·피해·공격속도', () => {
    expect(
      TOWER_ORDER.map((id) => [
        id,
        TOWERS[id].cost,
        TOWERS[id].range,
        TOWERS[id].damage,
        TOWERS[id].fireRate,
      ]),
    ).toEqual([
      ['onsen', 50, 2.0, 6, 1.2],
      ['piri', 70, 3.0, 8, 1.0],
      ['geobukseon', 100, 2.5, 30, 0.5],
      ['bell', 90, 2.2, 12, 0.8],
      ['mansae', 80, 3.5, 5, 3.0],
    ])
    expect(TOWERS.geobukseon.targeting).toBe('max_hp')
    expect(TOWERS.geobukseon.bossBonus).toBe(0.5)
    expect(TOWERS.piri.pierce).toBe(3)
    expect(TOWERS.bell.splashRadius).toBe(1.0)
    expect(TOWERS.onsen.slow).toEqual({ factor: 0.3, durationSec: 1.5 })
    expect(TOWER_ORDER.map((id) => TOWERS[id].unlockStage)).toEqual([1, 2, 3, 4, 5])
    expect(UPGRADE.costMult[2]).toBe(0.6)
    expect(UPGRADE.costMult[3]).toBe(0.8)
  })

  it('몬스터 8종의 체력·속도·코인·성 피해', () => {
    const rows = Object.values(ENEMIES).map((e) => [e.id, e.hp, e.speed, e.coins, e.damageToBase])
    expect(rows).toEqual([
      ['slime', 40, 1.0, 5, 1],
      ['bat', 25, 1.8, 6, 1],
      ['golem', 120, 0.6, 12, 2],
      ['ghost', 60, 1.2, 8, 1],
      ['dokkaebi', 20, 1.4, 3, 1],
      ['golden_slime', 50, 1.5, 50, 0],
      ['boss_mid', 400, 0.7, 60, 3],
      ['boss_final', 900, 0.6, 120, 5],
    ])
    expect(ENEMIES.golem.slowImmune).toBe(true)
    expect(ENEMIES.ghost.phase).toEqual({ periodSec: 2, hiddenSec: 0.5 })
    expect(ENEMIES.golden_slime.vanishAtBase).toBe(true)
  })
})

describe('waves — docs/02 §2 구성표', () => {
  it('전체 모드 5웨이브: 수량·보스·러시 위치', () => {
    expect(FULL_WAVES.map(totalEnemies)).toEqual([6, 13, 9, 20, 17])
    expect(FULL_WAVES.map((w) => w.boss ?? null)).toEqual([null, null, 'mid', null, 'final'])
    expect(FULL_WAVES.map((w) => Boolean(w.rush))).toEqual([false, false, false, true, false])
  })

  it('부스 모드 3웨이브: 1 → (2+3, 중간보스) → (4+5 60%, 러시+최종보스)', () => {
    expect(BOOTH_WAVES).toHaveLength(3)
    expect(totalEnemies(BOOTH_WAVES[0]!)).toBe(6)
    expect(totalEnemies(BOOTH_WAVES[1]!)).toBe(22)
    expect(BOOTH_WAVES[1]!.boss).toBe('mid')
    const late = BOOTH_WAVES[2]!
    expect(late.boss).toBe('final')
    expect(late.rush).toBe(true)
    expect(totalEnemies(late)).toBeLessThan(37)
    expect(totalEnemies(late)).toBeGreaterThanOrEqual(Math.floor(37 * 0.6))
    expect(wavesFor(3)).toBe(BOOTH_WAVES)
    expect(wavesFor(5)).toBe(FULL_WAVES)
    expect(() => wavesFor(4)).toThrow()
  })
})

describe('events — docs/02 §7', () => {
  it('8개 이벤트 정의와 수치', () => {
    expect(Object.keys(EVENT_DEFS)).toHaveLength(8)
    expect(EVENT_PARAMS.DOUBLE_COIN_TIME).toEqual({ durationSec: 20, mult: 2 })
    expect(EVENT_PARAMS.WAVE_CLEAR_BONUS.perWave).toBe(20)
    expect(EVENT_PARAMS.COMBO_MILESTONE).toEqual({ combo: 5, coins: 100 })
    expect(EVENT_PARAMS.EMERGENCY_QUIZ.bonusDamage).toBe(100)
    expect(EVENT_PARAMS.FULL_HEALTH_BONUS.coins).toBe(100)
  })
})
