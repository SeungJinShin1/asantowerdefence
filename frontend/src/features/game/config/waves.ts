/**
 * 웨이브 구성표 — docs/02 §2. 전체 모드 5웨이브가 원본이고, 부스 모드는 1 → (2+3) → (4+5 합침, 수량 60%)로 압축한다.
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
  /** 웨이브 시작 시 역사 러시(3문제 연속) */
  rush?: boolean
}

/** 그룹과 그룹 사이 간격(초) */
export const GROUP_GAP_SEC = 1.0
/** 마지막 몬스터 스폰 뒤 보스 등장까지(초) — 이 사이에 긴급 퀴즈 */
export const BOSS_DELAY_SEC = 2.0
/** 웨이브 시작 전 준비 시간(초) */
export const WAVE_PREP_SEC = 3.0
/** 부스 모드로 합칠 때 후반 웨이브 수량 배율 */
export const BOOTH_LATE_SCALE = 0.6

// 표에 간격이 적힌 종류(슬라임 1.2, 도깨비 0.4) 외에는 기본 간격
const SLIME = 1.2
const BAT = 1.0
const GOLEM = 2.0
const GHOST = 1.2
const DOKKAEBI = 0.4

export const FULL_WAVES: readonly WaveDef[] = [
  { groups: [{ enemy: 'slime', count: 6, intervalSec: SLIME }] },
  {
    groups: [
      { enemy: 'slime', count: 4, intervalSec: SLIME },
      { enemy: 'bat', count: 4, intervalSec: BAT },
      { enemy: 'dokkaebi', count: 5, intervalSec: DOKKAEBI },
    ],
  },
  {
    groups: [
      { enemy: 'golem', count: 2, intervalSec: GOLEM },
      { enemy: 'slime', count: 4, intervalSec: SLIME },
      { enemy: 'ghost', count: 3, intervalSec: GHOST },
    ],
    boss: 'mid',
  },
  {
    groups: [
      { enemy: 'bat', count: 6, intervalSec: BAT },
      { enemy: 'dokkaebi', count: 5, intervalSec: DOKKAEBI },
      { enemy: 'dokkaebi', count: 5, intervalSec: DOKKAEBI },
      { enemy: 'ghost', count: 4, intervalSec: GHOST },
    ],
    rush: true,
  },
  {
    groups: [
      { enemy: 'golem', count: 3, intervalSec: GOLEM },
      { enemy: 'ghost', count: 4, intervalSec: GHOST },
      { enemy: 'bat', count: 4, intervalSec: BAT },
      { enemy: 'slime', count: 6, intervalSec: SLIME },
    ],
    boss: 'final',
  },
]

function scaleGroups(groups: SpawnGroup[], scale: number): SpawnGroup[] {
  return groups.map((g) => ({ ...g, count: Math.max(1, Math.round(g.count * scale)) }))
}

function merge(a: WaveDef, b: WaveDef, scale = 1): WaveDef {
  return {
    groups: scaleGroups([...a.groups, ...b.groups], scale),
    boss: b.boss ?? a.boss,
    rush: Boolean(a.rush || b.rush),
  }
}

/** 부스 모드: 3웨이브 (2웨이브 끝 중간보스, 3웨이브 끝 최종보스) */
export const BOOTH_WAVES: readonly WaveDef[] = [
  FULL_WAVES[0]!,
  merge(FULL_WAVES[1]!, FULL_WAVES[2]!),
  merge(FULL_WAVES[3]!, FULL_WAVES[4]!, BOOTH_LATE_SCALE),
]

export function wavesFor(wavesPerStage: number): readonly WaveDef[] {
  if (wavesPerStage === 3) return BOOTH_WAVES
  if (wavesPerStage === 5) return FULL_WAVES
  throw new Error(`지원하지 않는 웨이브 수: ${wavesPerStage}`)
}

export function totalEnemies(wave: WaveDef): number {
  return wave.groups.reduce((n, g) => n + g.count, 0)
}
