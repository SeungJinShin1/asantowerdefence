/**
 * 웨이브 구성표 + 퀴즈 페이싱 — docs/02 §2·§6.
 * 부스 모드(3웨이브)와 전체 모드(5웨이브)를 따로 정의한다.
 * 퀴즈는 시간이 아니라 "몬스터가 몇 마리 나왔나"로 낸다 → 몬스터 수와 문제 수가 비례하고 초반에도 바로 나온다.
 * 보스는 마지막 그룹이 모두 나온 뒤 BOSS_DELAY_SEC 뒤에 등장하며, 그 직전에 긴급 퀴즈가 뜬다.
 */
import type { EnemyId } from './balance'

export interface SpawnGroup {
  enemy: EnemyId
  count: number
  /** 같은 그룹 안의 스폰 간격(초) */
  intervalSec: number
}

export interface WaveDef {
  groups: SpawnGroup[]
  boss?: 'mid' | 'final'
  /** 웨이브 시작 시 역사 러시(연속 문제) — 웨이브 시작 퀴즈를 대신한다 */
  rush?: boolean
}

/** 그룹과 그룹 사이 간격(초) */
export const GROUP_GAP_SEC = 1.0
/** 마지막 몬스터 스폰 뒤 보스 등장까지(초) — 이 사이에 긴급 퀴즈 */
export const BOSS_DELAY_SEC = 2.0
/** 웨이브 시작 전 준비 시간(초) */
export const WAVE_PREP_SEC = 3.0

const SLIME = 1.0
const BAT = 0.8
const GOLEM = 1.6
const GHOST = 1.0
const DOKKAEBI = 0.35

const g = (enemy: EnemyId, count: number, intervalSec: number): SpawnGroup => ({
  enemy,
  count,
  intervalSec,
})

export const FULL_WAVES: readonly WaveDef[] = [
  { groups: [g('slime', 8, SLIME)] },
  { groups: [g('slime', 6, SLIME), g('bat', 6, BAT), g('dokkaebi', 8, DOKKAEBI)] },
  { groups: [g('golem', 3, GOLEM), g('slime', 6, SLIME), g('ghost', 4, GHOST)], boss: 'mid' },
  {
    groups: [
      g('bat', 8, BAT),
      g('dokkaebi', 10, DOKKAEBI),
      g('dokkaebi', 8, DOKKAEBI),
      g('ghost', 5, GHOST),
    ],
    rush: true,
  },
  {
    groups: [g('golem', 4, GOLEM), g('ghost', 5, GHOST), g('bat', 6, BAT), g('slime', 8, SLIME)],
    boss: 'final',
  },
]

/** 부스 모드: 3웨이브 (2웨이브 끝 중간보스, 3웨이브 끝 최종보스). 13 → 23 → 37마리로 점점 거세진다 */
export const BOOTH_WAVES: readonly WaveDef[] = [
  { groups: [g('slime', 8, SLIME), g('bat', 5, BAT)] },
  {
    groups: [
      g('slime', 6, SLIME),
      g('dokkaebi', 10, DOKKAEBI),
      g('golem', 3, GOLEM),
      g('ghost', 4, GHOST),
    ],
    boss: 'mid',
  },
  {
    groups: [
      g('bat', 8, BAT),
      g('dokkaebi', 12, DOKKAEBI),
      g('ghost', 5, GHOST),
      g('golem', 4, GOLEM),
      g('slime', 8, SLIME),
    ],
    boss: 'final',
    rush: true,
  },
]

export function wavesFor(wavesPerStage: number): readonly WaveDef[] {
  if (wavesPerStage === 3) return BOOTH_WAVES
  if (wavesPerStage === 5) return FULL_WAVES
  throw new Error(`지원하지 않는 웨이브 수: ${wavesPerStage}`)
}

export function totalEnemies(wave: WaveDef): number {
  return wave.groups.reduce((n, grp) => n + grp.count, 0)
}

// ---------- 퀴즈 페이싱 ----------

export const QUIZ_PACING = {
  /** 몬스터 이 수마다 문제 1개(웨이브 시작 1개 포함). 부스 목표: 스테이지당 7~8문제 */
  enemiesPerQuiz: 12,
  minPerWave: 2,
  maxPerWave: 3,
  /** 역사 러시 문제 수(웨이브 예산에서 2개로 센다) */
  rushCount: 2,
  /** 스폰이 끝난 뒤(보스전 등) 이 시간 동안 문제가 없으면 1개 더 낸다 */
  fallbackSec: { booth: 30, full: 35 },
} as const

/** 웨이브당 문제 수(긴급 퀴즈·러시 포함) = 몬스터 수 ÷ 12, 2~3개 */
export function quizBudget(wave: WaveDef): number {
  const raw = Math.round(totalEnemies(wave) / QUIZ_PACING.enemiesPerQuiz)
  return Math.min(QUIZ_PACING.maxPerWave, Math.max(QUIZ_PACING.minPerWave, raw))
}

/**
 * 일반 퀴즈를 낼 "스폰 수" 지점(오름차순). 0 = 웨이브 시작.
 * 보스 웨이브는 마지막 자리를 보스 직전 긴급 퀴즈가 차지하고, 러시 웨이브는 러시(2문제)가 앞자리를 차지한다.
 */
export function quizMarksFor(wave: WaveDef): number[] {
  const total = totalEnemies(wave)
  const budget = quizBudget(wave)
  const normal = Math.max(budget - (wave.boss ? 1 : 0), 0)
  const marks = Array.from({ length: normal }, (_, k) => Math.floor((k * total) / budget))
  return wave.rush ? marks.slice(QUIZ_PACING.rushCount) : marks
}
