/**
 * 타워 업그레이드 옵션 — docs/02 §4. 타워마다 4가지 옵션 중 골라서 여러 단계 올린다(타워당 총 6회).
 * 숫자는 여기서만 바꾼다. 엔진(engine/tower.ts)은 이 표를 읽어 스탯을 계산한다.
 */
import type { TowerId } from './balance'

export type UpgradeTrack = 'power' | 'speed' | 'splash' | 'pierce' | 'multishot' | 'range'

export interface UpgradeTrackDef {
  id: UpgradeTrack
  name: string
  icon: string
  /** 한 단계당 효과(아이에게 보여 주는 문구) */
  description: string
  maxLevel: number
  /** 1단계 비용 = 타워 기본 비용 × costMult. n단계 = × (1 + UPGRADE_COST_STEP × (n − 1)) */
  costMult: number
}

export const UPGRADE_TRACKS: Record<UpgradeTrack, UpgradeTrackDef> = {
  power: {
    id: 'power',
    name: '위력',
    icon: '💥',
    description: '피해 +35%',
    maxLevel: 3,
    costMult: 0.6,
  },
  speed: {
    id: 'speed',
    name: '연사',
    icon: '⚡',
    description: '공격 속도 +30%',
    maxLevel: 3,
    costMult: 0.6,
  },
  splash: {
    id: 'splash',
    name: '폭탄',
    icon: '💣',
    description: '폭발 범위 +0.5칸',
    maxLevel: 3,
    costMult: 0.8,
  },
  pierce: {
    id: 'pierce',
    name: '관통',
    icon: '🌀',
    description: '관통 +1마리',
    maxLevel: 3,
    costMult: 0.7,
  },
  multishot: {
    id: 'multishot',
    name: '쌍발',
    icon: '✌️',
    description: '한 번에 +1발',
    maxLevel: 2,
    costMult: 1.0,
  },
  range: {
    id: 'range',
    name: '사거리',
    icon: '🎯',
    description: '사거리 +20%',
    maxLevel: 2,
    costMult: 0.5,
  },
}

export const UPGRADE_EFFECT = {
  powerPerLevel: 0.35,
  speedPerLevel: 0.3,
  splashPerLevel: 0.5,
  piercePerLevel: 1,
  shotsPerLevel: 1,
  rangePerLevel: 0.2,
} as const

/** 타워 1개가 받을 수 있는 업그레이드 총 횟수(옵션 합계) — 무엇을 올릴지 고르게 만든다 */
export const MAX_UPGRADES_PER_TOWER = 6
export const UPGRADE_COST_STEP = 0.5

/** 타워별로 고를 수 있는 옵션 4개 */
export const TOWER_TRACKS: Record<TowerId, readonly UpgradeTrack[]> = {
  onsen: ['power', 'speed', 'splash', 'multishot'],
  piri: ['power', 'speed', 'pierce', 'multishot'],
  geobukseon: ['power', 'speed', 'splash', 'range'],
  bell: ['power', 'speed', 'splash', 'multishot'],
  mansae: ['power', 'speed', 'multishot', 'range'],
}

export type UpgradeLevels = Record<UpgradeTrack, number>

export const ZERO_UPGRADES: Readonly<UpgradeLevels> = Object.freeze({
  power: 0,
  speed: 0,
  splash: 0,
  pierce: 0,
  multishot: 0,
  range: 0,
})

export const UPGRADE_TRACK_ORDER: readonly UpgradeTrack[] = [
  'power',
  'speed',
  'splash',
  'pierce',
  'multishot',
  'range',
]
