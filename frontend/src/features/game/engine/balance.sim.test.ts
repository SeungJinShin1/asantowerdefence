/**
 * 밸런스 헤드리스 시뮬레이션(3.11): 가상 플레이어가 부스 모드 5스테이지를 돌린다.
 * 숫자를 바꾸면 이 표(콘솔)로 "1단계는 쉽게, 5단계는 깰듯 말듯" 과 소요 시간을 확인한다.
 *
 * 플레이어 두 종류:
 *  - 초보(novice): 처음 하는 아이. 4초에 한 번만 결정, 길 옆 아무 데나(상위 절반) 세움, 타워 수 적음, 업그레이드 가끔
 *  - 고수(expert): 1초마다 결정, 경로를 가장 많이 덮는 자리, 코인을 남김없이 씀
 * 단언은 방향만 본다: 초보가 절반을 틀려도 1단계는 깨고, 고수가 잘 맞히면 전부 깬다.
 */
import { describe, expect, it } from 'vitest'

import { SIM_DT, TOWERS, TOWER_ORDER, type TowerId } from '../config/balance'
import { applyQuizOutcome, placeTower, resumeAfterQuiz, upgradeTowerById } from './actions'
import { type Game, createGame, drainOutbox, step } from './loop'
import { positionAt } from './path'
import { createRng } from './rng'
import type { QuizTriggerKind } from './state'
import { availableTracks, canBuildAt, isTowerUnlocked, upgradeCost } from './tower'

const TOPICS = ['onyang', 'maengsaseong', 'yisunsin', 'gongseri', 'seonjang']
const BASE_COINS: Record<QuizTriggerKind, number> = { normal: 30, emergency: 50, rush: 40 }
const MAX_SIM_SEC = 900

type Skill = 'novice' | 'expert'

interface Outcome {
  won: boolean
  lives: number
  simSec: number
  quizzes: number
  towers: number
  upgrades: number
}

interface RankedTile {
  x: number
  y: number
  score: number
}

/** 경로를 많이 덮는 순서로 건설 후보 타일을 매긴다 */
function rankTiles(g: Game): RankedTile[] {
  const samples: { x: number; y: number }[] = []
  for (let d = 0; d < g.ctx.path.totalLength; d += 0.25) samples.push(positionAt(g.ctx.path, d))
  const tiles: RankedTile[] = []
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

function simulate(stage: number, accuracy: number, seed: number, skill: Skill): Outcome {
  const g = createGame({
    stage,
    topicId: TOPICS[stage - 1]!,
    wavesPerStage: 3,
    rng: createRng(seed),
    learnBonus: true,
  })
  const prng = createRng(seed * 7 + 1)
  const ranked = rankTiles(g)
  const best = ranked[0]?.score ?? 1
  // 초보는 "길 옆이면 아무 데나": 상위 절반 중 무작위. 고수는 항상 최선의 자리
  const candidates = skill === 'expert' ? ranked : ranked.filter((t) => t.score >= best * 0.5)
  const decisionEvery = skill === 'expert' ? 1.0 : 4.0
  const maxTowers = skill === 'expert' ? Number.POSITIVE_INFINITY : 3 + stage
  const fastChance = skill === 'expert' ? 0.5 : 0.3
  const unlocked = TOWER_ORDER.filter((t) => isTowerUnlocked(t, stage))

  let combo = 0
  let quizzes = 0
  let upgrades = 0
  let decisionTimer = 0

  const pickSpot = () => {
    const free = candidates.filter((t) => canBuildAt(g.ctx.map, g.ctx.path, g.state.towers, t))
    if (free.length === 0) return null
    return skill === 'expert' ? free[0]! : free[Math.floor(prng.next() * free.length)]!
  }
  const pickTower = (): TowerId | undefined => {
    const affordable = unlocked.filter((t) => g.state.coins >= TOWERS[t].cost)
    if (affordable.length === 0) return undefined
    if (skill === 'expert') return affordable[affordable.length - 1]
    // 초보: 60% 가장 싼 것, 40% 아무거나
    return prng.next() < 0.6
      ? affordable[0]
      : affordable[Math.floor(prng.next() * affordable.length)]
  }
  const tryUpgrade = () => {
    const options = g.state.towers.flatMap((tower) =>
      availableTracks(tower.type)
        .map((track) => ({ tower, track, cost: upgradeCost(tower.type, tower.upgrades, track) }))
        .filter((o) => o.cost !== null && o.cost <= g.state.coins),
    )
    if (options.length === 0) return
    const pick = options[Math.floor(prng.next() * options.length)]!
    if (upgradeTowerById(g.state, pick.tower.id, pick.track).ok) upgrades += 1
  }

  while (g.state.status === 'playing' && g.state.time < MAX_SIM_SEC) {
    drainOutbox(g.state)
    if (g.state.pendingQuiz) {
      const kind = g.state.pendingQuiz
      const count = kind === 'rush' ? 2 : 1
      for (let i = 0; i < count; i += 1) {
        const correct = prng.next() < accuracy
        combo = correct ? combo + 1 : 0
        const mult = combo <= 1 ? 1 : Math.min(combo, 3)
        const fast = prng.next() < fastChance ? 10 : 0
        const double = g.state.doubleCoinUntil > g.state.time ? 2 : 1
        const coins = correct ? (BASE_COINS[kind] * mult + fast) * double : 0
        applyQuizOutcome(g.state, { kind, correct, coins, combo })
        quizzes += 1
      }
      resumeAfterQuiz(g.state)
      continue
    }

    decisionTimer += 0.5
    if (decisionTimer >= decisionEvery) {
      decisionTimer = 0
      const type = pickTower()
      const spot = pickSpot()
      const wantsNew =
        g.state.towers.length < maxTowers && (skill === 'expert' || prng.next() < 0.7)
      if (type && spot && wantsNew) placeTower(g.state, g.ctx, type, spot)
      else if (skill === 'expert' || prng.next() < 0.6) tryUpgrade()
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

function table(skill: Skill): { rows: string[]; winRate: Record<string, number> } {
  const rows: string[] = []
  const winRate: Record<string, number> = {}
  for (const accuracy of PROFILES) {
    for (let stage = 1; stage <= 5; stage += 1) {
      const results = SEEDS.map((seed) => simulate(stage, accuracy, seed, skill))
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
  return { rows, winRate }
}

describe('밸런스 시뮬레이션(부스 모드, 가상 플레이어)', () => {
  it('초보: 절반을 틀려도 1~2단계는 깨고, 70%면 3단계까지 안정적으로 깬다', () => {
    const { rows, winRate } = table('novice')
    console.info(`\n[밸런스 표 — 초보]\n${rows.join('\n')}\n`)
    expect(winRate['0.5-1']).toBeGreaterThanOrEqual(0.75)
    expect(winRate['0.5-2']).toBeGreaterThanOrEqual(0.5)
    expect(winRate['0.7-1']).toBe(1)
    expect(winRate['0.7-2']).toBeGreaterThanOrEqual(0.75)
    expect(winRate['0.7-3']).toBeGreaterThanOrEqual(0.75)
    // 후반은 초보에게 긴장감이 있어야 한다(절반 틀리면 5단계는 대체로 진다)
    expect(winRate['0.5-5']).toBeLessThanOrEqual(0.5)
    // 잘 맞히는 초보는 5단계도 절반 이상 깬다(너무 어렵지 않게)
    expect(winRate['0.9-5']).toBeGreaterThanOrEqual(0.5)
  }, 120_000)

  it('고수: 잘 맞히면 전부 깬다', () => {
    const { rows, winRate } = table('expert')
    console.info(`\n[밸런스 표 — 고수]\n${rows.join('\n')}\n`)
    const goodAll = [1, 2, 3, 4, 5].reduce((n, s) => n + winRate[`0.9-${s}`]!, 0) / 5
    expect(goodAll).toBeGreaterThanOrEqual(0.9)
  }, 120_000)
})
