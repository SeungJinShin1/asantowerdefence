import { describe, expect, it } from 'vitest'

import { DEFAULT_GAME_SPEED, ENEMIES, GAME_SPEEDS, TOWERS, TOWER_ORDER } from './balance'
import { EVENT_DEFS, EVENT_PARAMS } from './events'
import { MAX_UPGRADES_PER_TOWER, TOWER_TRACKS, UPGRADE_TRACKS } from './upgrades'
import {
  BOOTH_WAVES,
  FULL_WAVES,
  QUIZ_PACING,
  quizBudget,
  quizMarksFor,
  totalEnemies,
  wavesFor,
} from './waves'

describe('balance — docs/02 §4·§5 표', () => {
  it('나중에 열리는 타워일수록 비싸고, 비쌀수록 강하다', () => {
    const costs = TOWER_ORDER.map((id) => TOWERS[id].cost)
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(new Set(costs).size).toBe(costs.length)
    const dps = (id: (typeof TOWER_ORDER)[number]) => TOWERS[id].damage * TOWERS[id].fireRate
    // 단일 대상 초당 피해: 온천 < 피리 < 종탑(광역이라 한 대상 기준은 낮음) < 거북선 < 만세
    expect(dps('onsen')).toBeLessThan(dps('piri'))
    expect(dps('piri')).toBeLessThan(dps('bell'))
    expect(dps('bell')).toBeLessThan(dps('geobukseon'))
    expect(dps('geobukseon')).toBeLessThan(dps('mansae'))
    // 한 방 피해도 타워마다 다르다
    expect(new Set(TOWER_ORDER.map((id) => TOWERS[id].damage)).size).toBe(5)
    for (const id of TOWER_ORDER) expect(TOWERS[id].tagline.length).toBeGreaterThan(0)
  })

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
      ['piri', 70, 3.0, 12, 1.0],
      ['geobukseon', 100, 2.6, 55, 0.6],
      ['bell', 120, 2.4, 22, 0.9],
      ['mansae', 150, 3.5, 11, 4.0],
    ])
    expect(TOWERS.geobukseon.targeting).toBe('max_hp')
    expect(TOWERS.geobukseon.bossBonus).toBe(0.5)
    expect(TOWERS.piri.pierce).toBe(3)
    expect(TOWERS.bell.splashRadius).toBe(1.2)
    expect(TOWERS.geobukseon.splashRadius).toBe(0.5)
    expect(TOWERS.onsen.slow).toEqual({ factor: 0.3, durationSec: 1.5 })
    expect(TOWER_ORDER.map((id) => TOWERS[id].unlockStage)).toEqual([1, 2, 3, 4, 5])
    expect(GAME_SPEEDS).toEqual([1, 2, 4, 8])
    expect(DEFAULT_GAME_SPEED).toBe(2)
  })

  it('업그레이드 옵션: 타워마다 4개, 옵션별 최대 단계, 타워당 총 6회', () => {
    for (const id of TOWER_ORDER) expect(TOWER_TRACKS[id]).toHaveLength(4)
    expect(TOWER_TRACKS.piri).toContain('pierce')
    expect(TOWER_TRACKS.onsen).not.toContain('pierce')
    expect(UPGRADE_TRACKS.multishot.maxLevel).toBe(2)
    expect(UPGRADE_TRACKS.power.maxLevel).toBe(3)
    expect(MAX_UPGRADES_PER_TOWER).toBe(6)
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
    expect(FULL_WAVES.map(totalEnemies)).toEqual([8, 20, 13, 31, 23])
    expect(FULL_WAVES.map((w) => w.boss ?? null)).toEqual([null, null, 'mid', null, 'final'])
    expect(FULL_WAVES.map((w) => Boolean(w.rush))).toEqual([false, false, false, true, false])
  })

  it('부스 모드 3웨이브: 13 → 23(중간보스) → 37(러시+최종보스)', () => {
    expect(BOOTH_WAVES.map(totalEnemies)).toEqual([13, 23, 37])
    expect(BOOTH_WAVES.map((w) => w.boss ?? null)).toEqual([null, 'mid', 'final'])
    expect(BOOTH_WAVES.map((w) => Boolean(w.rush))).toEqual([false, false, true])
    expect(wavesFor(3)).toBe(BOOTH_WAVES)
    expect(wavesFor(5)).toBe(FULL_WAVES)
    expect(() => wavesFor(4)).toThrow()
  })
})

describe('퀴즈 페이싱 — 몬스터 수에 비례, 초반부터 출제', () => {
  it('웨이브당 문제 수 = 몬스터 ÷ 12 (2~3개); 보스 직전 긴급·러시 2문제가 자리를 차지 → 부스 스테이지당 7문제', () => {
    expect(QUIZ_PACING.rushCount).toBe(2)
    expect(BOOTH_WAVES.map(quizBudget)).toEqual([2, 2, 3])
    expect(quizMarksFor(BOOTH_WAVES[0]!)).toEqual([0, 6]) // 시작 + 6마리째
    expect(quizMarksFor(BOOTH_WAVES[1]!)).toEqual([0]) // 시작 + 보스 직전 긴급
    expect(quizMarksFor(BOOTH_WAVES[2]!)).toEqual([]) // 러시 2문제 + 보스 직전 긴급
    expect(FULL_WAVES.map(quizBudget)).toEqual([2, 2, 2, 3, 2])
    expect(quizMarksFor(FULL_WAVES[0]!)).toEqual([0, 4])
    expect(quizMarksFor(FULL_WAVES[3]!)).toEqual([20]) // 러시 뒤 20마리째
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
