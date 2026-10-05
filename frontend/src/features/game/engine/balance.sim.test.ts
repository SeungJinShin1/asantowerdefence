/**
 * 밸런스 헤드리스 시뮬레이션(3.11): 정답률이 다른 가상 플레이어가 부스 모드 5스테이지를 돌린다.
 * 숫자를 바꾸면 이 표(콘솔)로 "깰듯 말듯" 난이도와 소요 시간을 확인한다. 단언은 느슨하게(방향만) 둔다.
 *  - 잘 맞히는 아이(90%)는 대부분 깨고, 많이 틀리는 아이(50%)는 후반 스테이지에서 지기도 해야 한다.
 */
import { describe, expect, it } from 'vitest'

import { SIM_DT, TOWERS, TOWER_ORDER, type TowerId } from '../config/balance'
import { EVENT_PARAMS } from '../config/events'
import { applyQuizOutcome, placeTower, resumeAfterQuiz, upgradeTowerById } from './actions'
import { type Game, createGame, drainOutbox, step } from './loop'
import { positionAt } from './path'
import { createRng } from './rng'
import type { QuizTriggerKind } from './state'
import { availableTracks, canBuildAt, isTowerUnlocked, upgradeCost } from './tower'

const TOPICS = ['onyang', 'maengsaseong', 'yisunsin', 'gongseri', 'seonjang']
const BASE_COINS: Record<QuizTriggerKind, number> = { normal: 30, emergency: 50, rush: 40 }
const MAX_SIM_SEC = 900

interface Outcome {
  won: boolean
  lives: number
  simSec: number
  quizzes: number
  towers: number
  upgrades: number
}

/** 경로를 가장 많이 덮는 순서로 건설 후보 타일을 고른다(아이가 길 옆에 세우는 것을 흉내) */
function rankTiles(g: Game): { x: number; y: number }[] {
  const samples: { x: number; y: number }[] = []
  for (let d = 0; d < g.ctx.path.totalLength; d += 0.25) samples.push(positionAt(g.ctx.path, d))
  const tiles: { x: number; y: number; score: number }[] = []
  for (let y = 0; y < g.ctx.map.rows; y += 1) {
    for (let x = 0; x < g.ctx.map.cols; x += 1) {
      if (!canBuildAt(g.ctx.map, g.ctx.path, [], { x, y })) continue
      const cx = x + 0.5
      const cy = y + 0.5
      const score = samples.filter((p) => Math.hypot(p.x - cx, p.y - cy) <= 2.2).length
      tiles.push({ x, y, score })
    }
  }
  tiles.sort((a, b) => b.score - a.score)
  return tiles
}

function simulate(stage: number, accuracy: number, seed: number): Outcome {
  const g = createGame({
    stage,
    topicId: TOPICS[stage - 1]!,
    wavesPerStage: 3,
    rng: createRng(seed),
    learnBonus: true,
  })
  const prng = createRng(seed * 7 + 1)
  const tiles = rankTiles(g)
  let combo = 0
  let quizzes = 0
  let upgrades = 0
  let decisionTimer = 0
  const unlocked = TOWER_ORDER.filter((t) => isTowerUnlocked(t, stage))

  while (g.state.status === 'playing' && g.state.time < MAX_SIM_SEC) {
    drainOutbox(g.state)
    if (g.state.pendingQuiz) {
      const kind = g.state.pendingQuiz
      const count = kind === 'rush' ? 2 : 1
      for (let i = 0; i < count; i += 1) {
        const correct = prng.next() < accuracy
        combo = correct ? combo + 1 : 0
        const mult = combo <= 1 ? 1 : Math.min(combo, 3)
        const fast = prng.next() < 0.5 ? 10 : 0
        const double = g.state.doubleCoinUntil > g.state.time ? 2 : 1
        const coins = correct ? (BASE_COINS[kind] * mult + fast) * double : 0
        applyQuizOutcome(g.state, { kind, correct, coins, combo })
        quizzes += 1
      }
      resumeAfterQuiz(g.state)
      continue
    }

    decisionTimer += 0.5
    if (decisionTimer >= 1.0) {
      decisionTimer = 0
      // 1) 새 타워: 해금된 것 중 가장 비싼 것부터, 살 수 있으면 짓는다
      const affordable = [...unlocked].reverse().find((t) => g.state.coins >= TOWERS[t].cost) as
        TowerId | undefined
      const spot = tiles.find((t) => canBuildAt(g.ctx.map, g.ctx.path, g.state.towers, t))
      const wantsNew = g.state.towers.length < 3 + stage || prng.next() < 0.4
      if (affordable && spot && wantsNew) {
        placeTower(g.state, g.ctx, affordable, spot)
      } else {
        // 2) 업그레이드: 아무 타워의 아무 옵션이나 살 수 있는 것 하나
        const options = g.state.towers.flatMap((tower) =>
          availableTracks(tower.type)
            .map((track) => ({
              tower,
              track,
              cost: upgradeCost(tower.type, tower.upgrades, track),
            }))
            .filter((o) => o.cost !== null && o.cost <= g.state.coins),
        )
        if (options.length > 0) {
          const pick = options[Math.floor(prng.next() * options.length)]!
          if (upgradeTowerById(g.state, pick.tower.id, pick.track).ok) upgrades += 1
        }
      }
    }
    for (let i = 0; i < 30; i += 1) step(g.state, g.ctx, SIM_DT)
  }
  return {
    won: g.state.status === 'won',
    lives: g.state.lives,
    simSec: g.state.time,
    quizzes,
    towers: g.state.towers.length,
    upgrades,
  }
}

const SEEDS = [1, 2, 3, 4]
const PROFILES = [0.5, 0.7, 0.9]

describe('밸런스 시뮬레이션(부스 모드, 가상 플레이어)', () => {
  it('정답률별 스테이지 승률 표를 출력하고, 방향이 맞는지만 확인한다', () => {
    const rows: string[] = []
    const winRate: Record<string, number> = {}
    for (const accuracy of PROFILES) {
      for (let stage = 1; stage <= 5; stage += 1) {
        const results = SEEDS.map((seed) => simulate(stage, accuracy, seed))
        const wins = results.filter((r) => r.won).length
        const avg = (f: (r: Outcome) => number) =>
          results.reduce((n, r) => n + f(r), 0) / results.length
        winRate[`${accuracy}-${stage}`] = wins / results.length
        rows.push(
          `정답률 ${Math.round(accuracy * 100)}% · ${stage}단계 → 승 ${wins}/${results.length}` +
            ` · 남은 체력 ${avg((r) => r.lives).toFixed(1)}` +
            ` · 시뮬 ${avg((r) => r.simSec).toFixed(0)}초` +
            ` · 퀴즈 ${avg((r) => r.quizzes).toFixed(1)}` +
            ` · 타워 ${avg((r) => r.towers).toFixed(1)} · 업글 ${avg((r) => r.upgrades).toFixed(1)}`,
        )
      }
    }
    console.info(`\n[밸런스 표]\n${rows.join('\n')}\n`)

    // 잘 맞히면 깬다(1~3단계는 전부, 전체 평균 80% 이상)
    expect(winRate['0.9-1']).toBe(1)
    expect(winRate['0.9-2']).toBe(1)
    const goodAll = [1, 2, 3, 4, 5].reduce((n, s) => n + winRate[`0.9-${s}`]!, 0) / 5
    expect(goodAll).toBeGreaterThanOrEqual(0.8)
    // 많이 틀리면 후반은 질 수도 있다(4~5단계 평균 승률 80% 이하)
    const weakLate = (winRate['0.5-4']! + winRate['0.5-5']!) / 2
    expect(weakLate).toBeLessThanOrEqual(0.8)
    // 황금 슬라임 처치 보너스 등 이벤트 수치가 바뀌면 이 표를 다시 본다
    expect(EVENT_PARAMS.WAVE_CLEAR_BONUS.perWave).toBe(20)
  }, 60_000)
})
