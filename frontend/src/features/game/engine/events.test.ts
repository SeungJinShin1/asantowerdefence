import { describe, expect, it, vi } from 'vitest'

import {
  EventBus,
  armEmergencyBonus,
  checkComboMilestone,
  coinMultiplier,
  grantCoins,
  grantFullHealthBonus,
  grantWaveClearBonus,
  startDoubleCoin,
  waveClearBonus,
} from './events'
import { createGame } from './loop'
import type { EngineEvent } from './state'

const fresh = () => createGame({ stage: 1, topicId: 'onyang', wavesPerStage: 3 }).state

describe('EventBus', () => {
  it('타입별 구독·해제·발행', () => {
    const bus = new EventBus<EngineEvent>()
    const onWave = vi.fn()
    const off = bus.on('wave_started', onWave)
    bus.emit({ type: 'wave_started', wave: 1 })
    bus.emit({ type: 'stage_failed' })
    expect(onWave).toHaveBeenCalledTimes(1)
    off()
    bus.emit({ type: 'wave_started', wave: 2 })
    expect(onWave).toHaveBeenCalledTimes(1)
  })
})

describe('코인 이벤트', () => {
  it('2배 타임: 20초 동안 모든 코인 ×2', () => {
    const s = fresh()
    expect(coinMultiplier(s)).toBe(1)
    startDoubleCoin(s)
    expect(s.doubleCoinUntil).toBe(20)
    expect(s.outbox.at(-1)).toMatchObject({ type: 'game_event', id: 'DOUBLE_COIN_TIME', until: 20 })
    expect(grantCoins(s, 5)).toBe(10)
    s.time = 20
    expect(coinMultiplier(s)).toBe(1)
    expect(grantCoins(s, 5)).toBe(5)
    expect(s.coins).toBe(115)
  })

  it('웨이브 보너스 +20 × 웨이브 번호', () => {
    expect(waveClearBonus(3)).toBe(60)
    const s = fresh()
    expect(grantWaveClearBonus(s, 2)).toBe(40)
    expect(s.coins).toBe(140)
  })

  it('콤보 5 마일스톤 +100 은 스테이지당 1회', () => {
    const s = fresh()
    expect(checkComboMilestone(s, 4)).toBe(0)
    expect(checkComboMilestone(s, 5)).toBe(100)
    expect(checkComboMilestone(s, 6)).toBe(0)
    expect(s.coins).toBe(200)
  })

  it('긴급 퀴즈 보상과 만피 보너스', () => {
    const s = fresh()
    armEmergencyBonus(s)
    expect(s.bossBonusDamage).toBe(100)
    expect(grantFullHealthBonus(s)).toBe(100)
    s.lives = 9
    expect(grantFullHealthBonus(s)).toBe(0)
  })
})
