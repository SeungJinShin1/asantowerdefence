/** 타워 규칙 — docs/02 §4: 스탯·업그레이드 옵션·판매·건설 가능 판정·조준 우선순위. 순수 함수. */
import { SELL_REFUND, TOWERS, type TowerId } from '../config/balance'
import type { MapDef } from '../config/maps'
import {
  MAX_UPGRADES_PER_TOWER,
  TOWER_TRACKS,
  UPGRADE_COST_STEP,
  UPGRADE_EFFECT,
  UPGRADE_TRACKS,
  type UpgradeLevels,
  type UpgradeTrack,
  ZERO_UPGRADES,
} from '../config/upgrades'
import { isTargetable } from './enemy'
import { type PathData, type Vec, distance, positionAt, tileKey } from './path'
import type { EnemyState, TowerState } from './state'

export interface TowerStats {
  damage: number
  /** 사거리(타일) */
  range: number
  /** 공격 속도(회/초) */
  fireRate: number
  /** 폭발 반지름(타일). 0 이면 단일 대상 */
  splashRadius: number
  /** 관통 수(관통 투사체만 의미) */
  pierce: number
  /** 한 번에 쏘는 발 수 */
  shots: number
}

/** 기본 스탯에 업그레이드 옵션을 반영한 최종 스탯 */
export function towerStats(
  type: TowerId,
  upgrades: Readonly<UpgradeLevels> = ZERO_UPGRADES,
): TowerStats {
  const spec = TOWERS[type]
  return {
    damage: spec.damage * (1 + UPGRADE_EFFECT.powerPerLevel * upgrades.power),
    range: spec.range * (1 + UPGRADE_EFFECT.rangePerLevel * upgrades.range),
    fireRate: spec.fireRate * (1 + UPGRADE_EFFECT.speedPerLevel * upgrades.speed),
    splashRadius: (spec.splashRadius ?? 0) + UPGRADE_EFFECT.splashPerLevel * upgrades.splash,
    pierce: (spec.pierce ?? 1) + UPGRADE_EFFECT.piercePerLevel * upgrades.pierce,
    shots: 1 + UPGRADE_EFFECT.shotsPerLevel * upgrades.multishot,
  }
}

export const statsOf = (tower: Pick<TowerState, 'type' | 'upgrades'>): TowerStats =>
  towerStats(tower.type, tower.upgrades)

export const buildCost = (type: TowerId): number => TOWERS[type].cost

export const availableTracks = (type: TowerId): readonly UpgradeTrack[] => TOWER_TRACKS[type]

export const totalUpgrades = (upgrades: Readonly<UpgradeLevels>): number =>
  Object.values(upgrades).reduce((n, v) => n + v, 0)

/**
 * 옵션 1단계 올리는 비용. 그 타워에 없는 옵션·옵션 최대 단계·타워 총 횟수(6회) 초과면 null.
 * 같은 옵션을 올릴수록 비싸진다: 기본 비용 × costMult × (1 + 0.5 × 현재 단계)
 */
export function upgradeCost(
  type: TowerId,
  upgrades: Readonly<UpgradeLevels>,
  track: UpgradeTrack,
): number | null {
  if (!TOWER_TRACKS[type].includes(track)) return null
  const level = upgrades[track]
  if (level >= UPGRADE_TRACKS[track].maxLevel) return null
  if (totalUpgrades(upgrades) >= MAX_UPGRADES_PER_TOWER) return null
  const def = UPGRADE_TRACKS[track]
  return Math.round(TOWERS[type].cost * def.costMult * (1 + UPGRADE_COST_STEP * level))
}

export const sellValue = (tower: TowerState): number => Math.floor(tower.invested * SELL_REFUND)

export const isTowerUnlocked = (type: TowerId, stage: number): boolean =>
  TOWERS[type].unlockStage <= stage

export function createTower(id: number, type: TowerId, tile: { x: number; y: number }): TowerState {
  return {
    id,
    type,
    tile: { ...tile },
    level: 1,
    upgrades: { ...ZERO_UPGRADES },
    cooldown: 0,
    invested: TOWERS[type].cost,
  }
}

/** 옵션을 1단계 올린 새 상태(비용 지불은 호출자 책임). 올릴 수 없으면 그대로 */
export function applyUpgrade(tower: TowerState, track: UpgradeTrack): TowerState {
  const cost = upgradeCost(tower.type, tower.upgrades, track)
  if (cost === null) return tower
  const upgrades: UpgradeLevels = { ...tower.upgrades, [track]: tower.upgrades[track] + 1 }
  return {
    ...tower,
    upgrades,
    level: 1 + totalUpgrades(upgrades),
    invested: tower.invested + cost,
  }
}

export const towerCenter = (tower: TowerState): Vec => ({
  x: tower.tile.x + 0.5,
  y: tower.tile.y + 0.5,
})

export function canBuildAt(
  map: MapDef,
  path: PathData,
  towers: readonly TowerState[],
  tile: { x: number; y: number },
): boolean {
  if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) return false
  if (tile.x < 0 || tile.y < 0 || tile.x >= map.cols || tile.y >= map.rows) return false
  const key = tileKey(tile.x, tile.y)
  if (path.tiles.has(key)) return false
  if (map.blocked?.some((b) => tileKey(b.x, b.y) === key)) return false
  return !towers.some((t) => t.tile.x === tile.x && t.tile.y === tile.y)
}

/**
 * 사거리 안의 대상을 우선순위대로 최대 count 마리 고른다(쌍발용).
 * 기본: 성에 가장 가까운(진행 거리 최대) 순. 거북선(max_hp): 체력 최대 → 진행 거리 순.
 */
export function selectTargets(
  tower: TowerState,
  enemies: readonly EnemyState[],
  path: PathData,
  time: number,
  count = 1,
): EnemyState[] {
  const { range } = statsOf(tower)
  const center = towerCenter(tower)
  const targeting = TOWERS[tower.type].targeting
  const inRange = enemies.filter(
    (enemy) => isTargetable(enemy, time) && distance(center, positionAt(path, enemy.dist)) <= range,
  )
  inRange.sort((a, b) => {
    if (targeting === 'max_hp' && a.hp !== b.hp) return b.hp - a.hp
    return b.dist - a.dist
  })
  return inRange.slice(0, Math.max(1, count))
}

export function selectTarget(
  tower: TowerState,
  enemies: readonly EnemyState[],
  path: PathData,
  time: number,
): EnemyState | null {
  return selectTargets(tower, enemies, path, time, 1)[0] ?? null
}
