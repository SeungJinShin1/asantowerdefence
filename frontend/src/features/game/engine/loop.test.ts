import { describe, expect, it } from 'vitest'

import { SIM_DT } from '../config/balance'
import { WAVE_PREP_SEC } from '../config/waves'
import {
  applyQuizOutcome,
  placeTower,
  resumeAfterQuiz,
  sellTowerById,
  upgradeTowerById,
} from './actions'
import { damageEnemy } from './enemy'
import { type Game, createGame, drainOutbox, handleKill, startNextWave, step } from './loop'
import type { Rng } from './rng'
import type { EngineEvent } from './state'

const noGolden: Rng = { next: () => 0.99 }

function game(overrides: Partial<Parameters<typeof createGame>[0]> = {}): Game {
  return createGame({ stage: 1, topicId: 'onyang', wavesPerStage: 3, rng: noGolden, ...overrides })
}

function run(g: Game, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i += 1) step(g.state, g.ctx, SIM_DT)
}

function events(g: Game, type: EngineEvent['type']): EngineEvent[] {
  return drainOutbox(g.state).filter((e) => e.type === type)
}

/** 살아 있는 몬스터를 모두 처치(엔진 처치 경로를 그대로 사용) */
function killAll(g: Game): void {
  for (const e of g.state.enemies) {
    if (!e.alive) continue
    damageEnemy(e, e.hp)
    handleKill(g.state, g.ctx, e)
  }
}

describe('createGame', () => {
  it('시작 코인 100(+학습 50), 체력 10, 부스 모드 퀴즈 간격 14초', () => {
    const g = game()
    expect(g.state.coins).toBe(100)
    expect(g.state.lives).toBe(10)
    expect(g.state.wave).toBe(0)
    expect(g.state.wavePhase).toBe('prep')
    expect(g.state.quizIntervalSec).toBe(14)
    expect(game({ learnBonus: true }).state.coins).toBe(150)
    expect(game({ wavesPerStage: 5 }).state.quizIntervalSec).toBe(18)
  })
})

describe('웨이브 진행', () => {
  it('준비 시간 뒤 웨이브 1 이 시작되고 슬라임이 1.2초 간격으로 나온다', () => {
    const g = game()
    run(g, WAVE_PREP_SEC + 0.1)
    expect(g.state.wave).toBe(1)
    expect(events(g, 'wave_started')).toHaveLength(1)
    expect(g.state.enemies).toHaveLength(1)
    run(g, 1.2)
    expect(g.state.enemies).toHaveLength(2)
  })

  it('몬스터는 속도대로 이동하고 성에 닿으면 체력이 줄어든다', () => {
    const g = game()
    startNextWave(g.state, g.ctx)
    run(g, 2)
    const slime = g.state.enemies[0]!
    expect(slime.dist).toBeCloseTo(2, 1)
    const total = g.ctx.path.totalLength
    for (const e of g.state.enemies) e.dist = total - 0.01
    run(g, 0.1)
    expect(g.state.lives).toBeLessThan(10)
    expect(events(g, 'enemy_reached').length).toBeGreaterThan(0)
  })

  it('황금 슬라임은 성에 닿아도 체력을 깎지 않는다', () => {
    const g = game({ rng: { next: () => 0 } }) // 항상 황금 슬라임, at 0
    startNextWave(g.state, g.ctx)
    run(g, 0.05)
    const golden = g.state.enemies.find((e) => e.type === 'golden_slime')!
    golden.dist = g.ctx.path.totalLength
    for (const e of g.state.enemies) if (e !== golden) e.dist = 0
    run(g, SIM_DT)
    expect(g.state.lives).toBe(10)
  })

  it('웨이브를 모두 처치하면 보너스 +20×웨이브와 함께 다음 준비 단계로', () => {
    const g = game()
    startNextWave(g.state, g.ctx)
    run(g, 7) // 6마리 모두 스폰(마지막 6.0초)
    expect(g.state.wavePhase).toBe('fighting')
    const before = g.state.coins
    killAll(g)
    run(g, SIM_DT)
    expect(g.state.wavesCleared).toBe(1)
    expect(g.state.wavePhase).toBe('prep')
    expect(g.state.coins).toBe(before + 6 * 5 + 20)
    expect(events(g, 'wave_cleared')[0]).toMatchObject({ wave: 1, bonus: 20 })
  })

  it('체력이 0 이 되면 패배', () => {
    const g = game()
    startNextWave(g.state, g.ctx)
    g.state.lives = 1
    run(g, 0.05)
    g.state.enemies[0]!.dist = g.ctx.path.totalLength
    run(g, SIM_DT)
    expect(g.state.status).toBe('lost')
    expect(events(g, 'stage_failed')).toHaveLength(1)
    const t = g.state.time
    run(g, 1)
    expect(g.state.time).toBe(t) // 더 이상 진행하지 않음
  })
})

describe('퀴즈 트리거와 일시정지', () => {
  it('웨이브 진행 중 14초마다 일반 퀴즈를 요청하고 멈춘다. 재개하면 이어서 진행', () => {
    const g = game()
    startNextWave(g.state, g.ctx)
    run(g, 13.9)
    expect(g.state.paused).toBe(false)
    run(g, 0.2)
    expect(g.state.paused).toBe(true)
    expect(g.state.pendingQuiz).toBe('normal')
    expect(events(g, 'quiz_requested')[0]).toMatchObject({ kind: 'normal', count: 1 })
    const t = g.state.time
    run(g, 5)
    expect(g.state.time).toBe(t)
    resumeAfterQuiz(g.state)
    run(g, 1)
    expect(g.state.time).toBeGreaterThan(t)
    expect(g.state.quizTimer).toBeCloseTo(13, 0)
  })

  it('보스 웨이브: 보스 직전 긴급 퀴즈 → 재개 후 보스 등장, 중간보스 처치 시 2배 타임', () => {
    const g = game()
    g.state.wave = 1 // 웨이브 2(중간보스)로 바로
    startNextWave(g.state, g.ctx)
    run(g, 13.9) // 퀴즈 타이머 직전까지(14초) — 스폰은 아직 진행 중
    resumeIfQuiz(g)
    // 보스가 뜰 때까지 진행하되 퀴즈는 즉시 재개
    let guard = 0
    while (g.state.wavePhase === 'spawning' && guard < 5000) {
      run(g, 0.5)
      if (g.state.pendingQuiz === 'normal') resumeAfterQuiz(g.state)
      if (g.state.pendingQuiz === 'emergency') break
      guard += 1
    }
    expect(g.state.pendingQuiz).toBe('emergency')
    expect(g.state.enemies.some((e) => e.isBoss)).toBe(false)
    applyQuizOutcome(g.state, { kind: 'emergency', correct: true, coins: 50, combo: 1 })
    expect(g.state.bossBonusDamage).toBe(100)
    resumeAfterQuiz(g.state)
    run(g, SIM_DT)
    const boss = g.state.enemies.find((e) => e.type === 'boss_mid')!
    expect(boss).toBeDefined()
    expect(events(g, 'boss_spawned')[0]).toMatchObject({ boss: 'mid' })

    const coinsBefore = g.state.coins
    for (const e of g.state.enemies) if (e !== boss) e.alive = false
    damageEnemy(boss, boss.hp)
    handleKill(g.state, g.ctx, boss)
    expect(g.state.coins).toBe(coinsBefore + 60)
    expect(g.state.doubleCoinUntil).toBeGreaterThan(g.state.time)
    expect(events(g, 'boss_defeated')[0]).toMatchObject({ boss: 'mid' })
  })

  it('러시 웨이브 시작 시 3문제 묶음을 요청한다', () => {
    const g = game()
    g.state.wave = 2 // 부스 3웨이브(러시+최종보스)
    startNextWave(g.state, g.ctx)
    expect(g.state.pendingQuiz).toBe('rush')
    expect(events(g, 'quiz_requested')[0]).toMatchObject({ kind: 'rush', count: 3 })
  })

  it('마지막 웨이브를 끝내면 승리(만피 보너스 포함)', () => {
    const g = game()
    g.state.wave = 2
    startNextWave(g.state, g.ctx)
    resumeAfterQuiz(g.state)
    g.state.spawnQueue = []
    g.state.wavePhase = 'fighting'
    g.state.enemies = []
    const before = g.state.coins
    run(g, SIM_DT)
    expect(g.state.status).toBe('won')
    expect(g.state.coins).toBe(before + 60 + 100)
    expect(events(g, 'stage_won')[0]).toMatchObject({ fullHealth: true })
  })
})

function resumeIfQuiz(g: Game): void {
  if (g.state.pendingQuiz === 'normal') resumeAfterQuiz(g.state)
}

describe('퀴즈 결과 반영', () => {
  it('서버 코인을 그대로 더하고 콤보 5 에 +100', () => {
    const g = game()
    applyQuizOutcome(g.state, { kind: 'normal', correct: true, coins: 70, combo: 2 })
    expect(g.state.coins).toBe(170)
    applyQuizOutcome(g.state, { kind: 'normal', correct: true, coins: 90, combo: 5 })
    expect(g.state.coins).toBe(170 + 90 + 100)
    applyQuizOutcome(g.state, { kind: 'normal', correct: false, coins: 0, combo: 0 })
    expect(g.state.coins).toBe(360)
  })
})

describe('건설·업그레이드·판매', () => {
  it('코인·해금·위치 검사 뒤 타워를 세우고, 업그레이드·판매가 코인에 반영된다', () => {
    const g = game()
    expect(placeTower(g.state, g.ctx, 'piri', { x: 5, y: 5 })).toEqual({
      ok: false,
      reason: '아직 열리지 않은 타워예요.',
    })
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 1, y: 4 }).ok).toBe(false) // 경로
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 5, y: 5 })).toEqual({ ok: true })
    expect(g.state.coins).toBe(50)
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 6, y: 5 })).toEqual({ ok: true })
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 8, y: 5 })).toEqual({
      ok: false,
      reason: '코인이 부족해요.',
    })

    const id = g.state.towers[0]!.id
    g.state.coins = 30
    expect(upgradeTowerById(g.state, id)).toEqual({ ok: true })
    expect(g.state.coins).toBe(0)
    expect(g.state.towers[0]!.level).toBe(2)
    expect(upgradeTowerById(g.state, id).ok).toBe(false)

    expect(sellTowerById(g.state, id)).toEqual({ ok: true })
    expect(g.state.coins).toBe(48) // (50+30)×0.6
    expect(g.state.towers).toHaveLength(1)
  })

  it('타워가 사거리 안의 몬스터를 처치하면 코인이 들어온다', () => {
    const g = game()
    // 온양 경로 (3,4)→(3,1) 세로 구간 옆에 온천 타워
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 4, y: 2 })).toEqual({ ok: true })
    startNextWave(g.state, g.ctx)
    run(g, 12)
    const killed = events(g, 'enemy_killed')
    expect(killed.length).toBeGreaterThan(0)
    expect(g.state.kills).toBe(killed.length)
    expect(g.state.coins).toBe(50 + killed.length * 5)
  })
})
