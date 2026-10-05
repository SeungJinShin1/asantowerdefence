import { describe, expect, it } from 'vitest'

import { SIM_DT } from '../config/balance'
import { resumeAfterQuiz } from './actions'
import { type Game, createGame, drainOutbox, startNextWave, step } from './loop'
import { TEACHER_COIN_GRANT, grantReviewCoins, skipWave } from './teacher'

function game(): Game {
  return createGame({ stage: 3, topicId: 'yisunsin', wavesPerStage: 3, rng: { next: () => 0.99 } })
}

describe('교사 검수 도구', () => {
  it('코인 받기: +500, 게임이 끝난 뒤에는 불가', () => {
    const g = game()
    const before = g.state.coins
    expect(grantReviewCoins(g.state)).toEqual({ ok: true })
    expect(g.state.coins).toBe(before + TEACHER_COIN_GRANT)
    g.state.status = 'won'
    expect(grantReviewCoins(g.state).ok).toBe(false)
    expect(g.state.coins).toBe(before + TEACHER_COIN_GRANT)
  })

  it('웨이브 건너뛰기: 전투 중이면 그 웨이브를, 준비 중이면 다음 웨이브를 엔진의 정상 경로로 클리어한다', () => {
    const g = game()
    // 준비 시간(웨이브 0)에서 누르면 1웨이브를 통째로 건너뛴다
    expect(skipWave(g.state)).toEqual({ ok: true })
    expect(g.state.wave).toBe(1)
    step(g.state, g.ctx, SIM_DT)
    expect(g.state.wavesCleared).toBe(1)
    expect(g.state.wavePhase).toBe('prep')
    const first = drainOutbox(g.state)
    expect(first.map((e) => e.type)).toEqual(['wave_started', 'game_event', 'wave_cleared']) // 가운데는 웨이브 보너스

    // 2웨이브 전투 중에 누르면 남은 몬스터·스폰이 사라지고 바로 클리어
    startNextWave(g.state, g.ctx)
    resumeAfterQuiz(g.state)
    for (let i = 0; i < 120; i += 1) step(g.state, g.ctx, SIM_DT)
    expect(g.state.enemies.length).toBeGreaterThan(0)
    expect(skipWave(g.state)).toEqual({ ok: true })
    expect(g.state.enemies).toHaveLength(0)
    expect(g.state.spawnQueue).toHaveLength(0)
    step(g.state, g.ctx, SIM_DT)
    expect(g.state.wavesCleared).toBe(2)
  })

  it('세 번 건너뛰면 스테이지 승리(성 체력 그대로), 그 뒤에는 더 건너뛸 수 없다', () => {
    const g = game()
    for (let i = 0; i < 3; i += 1) {
      expect(skipWave(g.state)).toEqual({ ok: true })
      step(g.state, g.ctx, SIM_DT)
    }
    expect(g.state.status).toBe('won')
    expect(g.state.lives).toBe(10)
    expect(drainOutbox(g.state).some((e) => e.type === 'stage_won')).toBe(true)
    expect(skipWave(g.state).ok).toBe(false)
  })

  it('퀴즈가 떠 있으면 먼저 풀어야 한다', () => {
    const g = game()
    startNextWave(g.state, g.ctx) // 시작 퀴즈로 멈춤
    expect(g.state.pendingQuiz).toBe('normal')
    expect(skipWave(g.state)).toEqual({ ok: false, reason: '문제를 먼저 풀어 주세요.' })
    resumeAfterQuiz(g.state)
    expect(skipWave(g.state)).toEqual({ ok: true })
  })
})
