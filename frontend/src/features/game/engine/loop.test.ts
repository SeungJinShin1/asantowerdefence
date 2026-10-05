import { describe, expect, it } from 'vitest'

import { ENEMIES, SIM_DT } from '../config/balance'
import { WAVE_PREP_SEC } from '../config/waves'
import {
  applyQuizOutcome,
  placeTower,
  resumeAfterQuiz,
  sellTowerById,
  upgradeTowerById,
} from './actions'
import { createEnemy, damageEnemy } from './enemy'
import {
  type Game,
  MAX_CATCH_UP_SEC,
  advance,
  createGame,
  drainOutbox,
  handleKill,
  startNextWave,
  step,
} from './loop'
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

/** 퀴즈가 떠 있으면 즉시 재개하면서 진행(퀴즈 페이싱과 무관한 시나리오용) */
function runResuming(g: Game, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i += 1) {
    if (g.state.pendingQuiz) resumeAfterQuiz(g.state)
    step(g.state, g.ctx, SIM_DT)
  }
}

function events(g: Game, type: EngineEvent['type']): EngineEvent[] {
  return drainOutbox(g.state).filter((e) => e.type === type)
}

/** 웨이브 시작(시작 퀴즈는 바로 재개) */
function startWave(g: Game): void {
  startNextWave(g.state, g.ctx)
  resumeAfterQuiz(g.state)
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
  it('시작 코인 150(+학습 50), 체력 10, 보조 출제 대기 부스 30초/전체 35초', () => {
    const g = game()
    expect(g.state.coins).toBe(150)
    expect(g.state.lives).toBe(10)
    expect(g.state.wave).toBe(0)
    expect(g.state.wavePhase).toBe('prep')
    expect(g.state.quizFallbackSec).toBe(30)
    expect(game({ learnBonus: true }).state.coins).toBe(200)
    expect(game({ wavesPerStage: 5 }).state.quizFallbackSec).toBe(35)
  })
})

describe('웨이브 진행', () => {
  it('준비 시간 뒤 웨이브 1 이 시작되면 먼저 시작 퀴즈가 뜨고, 풀고 나면 슬라임이 1초 간격으로 나온다', () => {
    const g = game()
    run(g, WAVE_PREP_SEC + 0.1)
    expect(g.state.wave).toBe(1)
    expect(events(g, 'wave_started')).toHaveLength(1)
    expect(g.state.pendingQuiz).toBe('normal')
    expect(g.state.enemies).toHaveLength(0)
    resumeAfterQuiz(g.state)
    run(g, 0.05)
    expect(g.state.enemies).toHaveLength(1)
    run(g, 1.0)
    expect(g.state.enemies).toHaveLength(2)
  })

  it('몬스터는 속도대로 이동하고 성에 닿으면 체력이 줄어든다', () => {
    const g = game()
    startWave(g)
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
    startWave(g)
    run(g, 0.05)
    const golden = g.state.enemies.find((e) => e.type === 'golden_slime')!
    golden.dist = g.ctx.path.totalLength
    for (const e of g.state.enemies) if (e !== golden) e.dist = 0
    run(g, SIM_DT)
    expect(g.state.lives).toBe(10)
  })

  it('웨이브를 모두 처치하면 보너스 +20×웨이브와 함께 다음 준비 단계로', () => {
    const g = game()
    startWave(g)
    runResuming(g, 8) // 1단계(×0.6): 슬라임 5 + 박쥐 3 = 8마리, 마지막 스폰 6.6초
    expect(g.state.wavePhase).toBe('fighting')
    expect(g.state.enemies).toHaveLength(8)
    const before = g.state.coins
    killAll(g)
    run(g, SIM_DT)
    expect(g.state.wavesCleared).toBe(1)
    expect(g.state.wavePhase).toBe('prep')
    const killCoins = 5 * ENEMIES.slime.coins + 3 * ENEMIES.bat.coins
    expect(g.state.coins).toBe(before + killCoins + 20)
    expect(events(g, 'wave_cleared')[0]).toMatchObject({ wave: 1, bonus: 20 })
  })

  it('체력이 0 이 되면 패배', () => {
    const g = game()
    startWave(g)
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

  it('advance 는 한 번에 최대 0.5초까지만 따라잡는다(×8 배속 대비)', () => {
    const g = game()
    advance(g.state, g.ctx, 3, SIM_DT)
    expect(g.state.time).toBeCloseTo(MAX_CATCH_UP_SEC, 1)
  })
})

describe('퀴즈 페이싱 — 몬스터 수에 맞춰 출제', () => {
  it('웨이브 1(1단계 8마리): 시작 퀴즈 → 4마리째가 나오면 두 번째 퀴즈. 퀴즈 중에는 시간이 멈춘다', () => {
    const g = game()
    startNextWave(g.state, g.ctx)
    expect(g.state.pendingQuiz).toBe('normal')
    expect(g.state.quizMarks).toEqual([4])
    expect(events(g, 'quiz_requested')[0]).toMatchObject({ kind: 'normal', count: 1 })
    const t = g.state.time
    run(g, 5)
    expect(g.state.time).toBe(t)

    resumeAfterQuiz(g.state)
    run(g, 2.9) // 3마리(0~2초)
    expect(g.state.paused).toBe(false)
    expect(g.state.spawnedThisWave).toBe(3)
    run(g, 0.2) // 4마리째(3.0초)
    expect(g.state.paused).toBe(true)
    expect(g.state.pendingQuiz).toBe('normal')
    expect(g.state.spawnedThisWave).toBe(4)
    expect(g.state.quizMarks).toEqual([])
    expect(g.state.quizzesAsked).toBe(2)
    resumeAfterQuiz(g.state)
    run(g, 10)
    expect(g.state.pendingQuiz).toBeNull() // 더 이상 일반 퀴즈 없음
  })

  it('보조 출제: 스폰이 끝난 뒤 30초 동안 문제가 없고 몬스터가 남아 있으면 1개 더', () => {
    const g = game()
    startWave(g)
    g.state.spawnQueue = []
    g.state.quizMarks = []
    g.state.enemies.push(createEnemy(999, 'golem', 1, g.state.time))
    run(g, 29.9)
    expect(g.state.paused).toBe(false)
    expect(g.state.wavePhase).toBe('fighting')
    run(g, 0.2)
    expect(g.state.pendingQuiz).toBe('normal')
    expect(g.state.sinceQuizSec).toBe(0)
  })

  it('보스 웨이브: 보스 직전 긴급 퀴즈 → 재개 후 보스 등장, 중간보스 처치 시 2배 타임', () => {
    const g = game()
    g.state.wave = 1 // 웨이브 2(중간보스)로 바로
    startNextWave(g.state, g.ctx)
    expect(g.state.quizMarks).toEqual([]) // 시작 퀴즈 + 보스 직전 긴급 퀴즈뿐
    let guard = 0
    while (g.state.wavePhase === 'spawning' && guard < 5000) {
      if (g.state.pendingQuiz === 'normal') resumeAfterQuiz(g.state)
      if (g.state.pendingQuiz === 'emergency') break
      run(g, 0.5)
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

  it('러시 웨이브 시작 시 2문제 묶음을 요청하고, 시작 퀴즈 자리는 러시가 대신한다', () => {
    const g = game()
    g.state.wave = 2 // 부스 3웨이브(러시+최종보스)
    startNextWave(g.state, g.ctx)
    expect(g.state.pendingQuiz).toBe('rush')
    expect(events(g, 'quiz_requested')[0]).toMatchObject({ kind: 'rush', count: 2 })
    expect(g.state.quizMarks).toEqual([]) // 러시 2문제가 예산을 차지, 남은 건 긴급 퀴즈
  })

  it('마지막 웨이브를 끝내면 승리(만피 보너스 포함)', () => {
    const g = game()
    g.state.wave = 2
    startWave(g)
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

describe('퀴즈 결과 반영', () => {
  it('서버 코인을 그대로 더하고 콤보 5 에 +100', () => {
    const g = game()
    applyQuizOutcome(g.state, { kind: 'normal', correct: true, coins: 70, combo: 2 })
    expect(g.state.coins).toBe(220)
    applyQuizOutcome(g.state, { kind: 'normal', correct: true, coins: 90, combo: 5 })
    expect(g.state.coins).toBe(220 + 90 + 100)
    applyQuizOutcome(g.state, { kind: 'normal', correct: false, coins: 0, combo: 0 })
    expect(g.state.coins).toBe(410)
  })
})

describe('건설·업그레이드·판매', () => {
  it('코인·해금·위치 검사 뒤 타워를 세우고, 옵션 업그레이드·판매가 코인에 반영된다', () => {
    const g = game()
    expect(placeTower(g.state, g.ctx, 'piri', { x: 5, y: 5 })).toEqual({
      ok: false,
      reason: '아직 열리지 않은 타워예요.',
    })
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 1, y: 4 }).ok).toBe(false) // 경로
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 5, y: 5 })).toEqual({ ok: true })
    expect(g.state.coins).toBe(100)
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 6, y: 5 })).toEqual({ ok: true })
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 5, y: 6 })).toEqual({ ok: true })
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 8, y: 5 })).toEqual({
      ok: false,
      reason: '코인이 부족해요.',
    })

    const id = g.state.towers[0]!.id
    g.state.coins = 30
    expect(upgradeTowerById(g.state, id, 'power')).toEqual({ ok: true })
    expect(g.state.coins).toBe(0)
    expect(g.state.towers[0]!.level).toBe(2)
    expect(g.state.towers[0]!.upgrades.power).toBe(1)
    expect(upgradeTowerById(g.state, id, 'power')).toEqual({
      ok: false,
      reason: '코인이 부족해요.',
    })
    expect(upgradeTowerById(g.state, id, 'pierce')).toEqual({
      ok: false,
      reason: '더 올릴 수 없어요.',
    })

    expect(sellTowerById(g.state, id)).toEqual({ ok: true })
    expect(g.state.coins).toBe(48) // (50+30)×0.6
    expect(g.state.towers).toHaveLength(2)
  })

  it('타워가 사거리 안의 몬스터를 처치하면 코인이 들어온다', () => {
    const g = game()
    // 온양 경로 (3,4)→(3,1) 세로 구간 옆에 온천 타워
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 4, y: 2 })).toEqual({ ok: true })
    startWave(g)
    runResuming(g, 12)
    const killed = events(g, 'enemy_killed')
    expect(killed.length).toBeGreaterThan(0)
    expect(g.state.kills).toBe(killed.length)
    const earned = killed.reduce((n, e) => n + (e.type === 'enemy_killed' ? e.coins : 0), 0)
    expect(g.state.coins).toBe(100 + earned)
  })

  it('연사 옵션은 쿨다운을 줄이고, 쌍발 옵션은 한 번에 두 대상에게 쏜다', () => {
    const g = game()
    g.state.coins = 1000
    expect(placeTower(g.state, g.ctx, 'onsen', { x: 4, y: 2 })).toEqual({ ok: true })
    const id = g.state.towers[0]!.id
    expect(upgradeTowerById(g.state, id, 'speed')).toEqual({ ok: true })
    expect(upgradeTowerById(g.state, id, 'multishot')).toEqual({ ok: true })
    // 사거리 안(세로 구간 (3,4)→(3,1), 진행 거리 3~6)에 몬스터 둘
    const a = createEnemy(901, 'golem', 1, 0)
    a.dist = 4.5
    const b = createEnemy(902, 'golem', 1, 0)
    b.dist = 4.0
    g.state.enemies.push(a, b)
    g.state.wavePhase = 'fighting'
    g.state.wave = 1
    run(g, SIM_DT)
    expect(g.state.projectiles).toHaveLength(2)
    expect(new Set(g.state.projectiles.map((p) => p.targetId))).toEqual(new Set([901, 902]))
    expect(g.state.towers[0]!.cooldown).toBeCloseTo(1 / (1.2 * 1.3), 3)
  })
})
