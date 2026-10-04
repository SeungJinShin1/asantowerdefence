/** 타워 규칙 — docs/02 §4: 스탯·업그레이드·판매·건설 가능 판정·조준 우선순위. 순수 함수. */
import { SELL_REFUND, TOWERS, type TowerId, UPGRADE } from '../config/balance'
import type { MapDef } from '../config/maps'
import { isTargetable } from './enemy'
import { type PathData, type Vec, distance, positionAt, tileKey } from './path'
import type { EnemyState, TowerState } from './state'

export interface TowerStats {
  damage: number
  range: number
}

export function towerStats(type: TowerId, level: number): TowerStats {
  const spec = TOWERS[type]
  const steps = Math.max(level - 1, 0)
  return {
    damage: spec.damage * (1 + UPGRADE.damagePerLevel * steps),
    range: spec.range * (1 + UPGRADE.rangePerLevel * steps),
  }
}

export const buildCost = (type: TowerId): number => TOWERS[type].cost

/** 다음 레벨 비용. 최대 레벨이면 null */
export function upgradeCost(type: TowerId, currentLevel: number): number | null {
  const next = currentLevel + 1
  if (next > UPGRADE.maxLevel) return null
  const mult = UPGRADE.costMult[next]
  return mult === undefined ? null : Math.round(TOWERS[type].cost * mult)
}

export const sellValue = (tower: TowerState): number => Math.floor(tower.invested * SELL_REFUND)

export const isTowerUnlocked = (type: TowerId, stage: number): boolean =>
  TOWERS[type].unlockStage <= stage

export function createTower(id: number, type: TowerId, tile: { x: number; y: number }): TowerState {
  return { id, type, tile: { ...tile }, level: 1, cooldown: 0, invested: TOWERS[type].cost }
}

/** 업그레이드된 새 상태(비용 지불은 호출자 책임). 최대 레벨이면 그대로 */
export function upgradeTower(tower: TowerState): TowerState {
  const cost = upgradeCost(tower.type, tower.level)
  if (cost === null) return tower
  return { ...tower, level: tower.level + 1, invested: tower.invested + cost }
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

/** 사거리 안의 대상 중 우선순위(성에 가장 가까운 = dist 최대 / 체력 최대)에 따라 하나 고른다 */
export function selectTarget(
  tower: TowerState,
  enemies: readonly EnemyState[],
  path: PathData,
  time: number,
): EnemyState | null {
  const { range } = towerStats(tower.type, tower.level)
  const center = towerCenter(tower)
  const targeting = TOWERS[tower.type].targeting
  let best: EnemyState | null = null
  for (const enemy of enemies) {
    if (!isTargetable(enemy, time)) continue
    if (distance(center, positionAt(path, enemy.dist)) > range) continue
    if (!best) {
      best = enemy
      continue
    }
    if (targeting === 'max_hp') {
      if (enemy.hp > best.hp || (enemy.hp === best.hp && enemy.dist > best.dist)) best = enemy
    } else if (enemy.dist > best.dist) {
      best = enemy
    }
  }
  return best
}
