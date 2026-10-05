/**
 * 선택한 타워의 업그레이드 패널 (docs/02 §4): 옵션 4개 중 골라서 단계를 올린다(●●○), 타워당 총 6회.
 * 색만으로 상태를 전달하지 않도록 비용·'최대' 문구를 함께 쓴다.
 */
import { Button } from '@/shared/ui/Button'

import { TOWERS } from '../config/balance'
import { MAX_UPGRADES_PER_TOWER, UPGRADE_TRACKS, type UpgradeTrack } from '../config/upgrades'
import type { TowerState } from '../engine/state'
import { availableTracks, sellValue, statsOf, totalUpgrades, upgradeCost } from '../engine/tower'

export interface UpgradePanelProps {
  tower: TowerState
  coins: number
  onUpgrade: (track: UpgradeTrack) => void
  onSell: () => void
  onDeselect: () => void
}

export function UpgradePanel({ tower, coins, onUpgrade, onSell, onDeselect }: UpgradePanelProps) {
  const stats = statsOf(tower)
  const used = totalUpgrades(tower.upgrades)
  const full = used >= MAX_UPGRADES_PER_TOWER
  const extras = [
    stats.splashRadius > 0 ? `폭발 ${stats.splashRadius.toFixed(1)}칸` : null,
    stats.pierce > 1 ? `관통 ${stats.pierce}마리` : null,
    stats.shots > 1 ? `${stats.shots}발씩` : null,
  ].filter(Boolean)

  return (
    <section
      aria-label="타워 업그레이드"
      className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm"
    >
      <p className="text-base font-black">
        {TOWERS[tower.type].name} Lv.{tower.level}
      </p>
      <p className="text-stone-700">
        피해 {stats.damage.toFixed(0)} · 연사 {stats.fireRate.toFixed(1)}/초 · 사거리{' '}
        {stats.range.toFixed(1)}칸{extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}
      </p>
      <p className="mt-1 font-bold">
        업그레이드 {used}/{MAX_UPGRADES_PER_TOWER}
        {full ? ' · 더 올릴 수 없어요' : ''}
      </p>

      <ul className="mt-2 grid grid-cols-2 gap-2">
        {availableTracks(tower.type).map((track) => {
          const def = UPGRADE_TRACKS[track]
          const level = tower.upgrades[track]
          const cost = upgradeCost(tower.type, tower.upgrades, track)
          const maxed = level >= def.maxLevel
          const affordable = cost !== null && coins >= cost
          const pips = '●'.repeat(level) + '○'.repeat(Math.max(0, def.maxLevel - level))
          const costLabel = cost === null ? (maxed ? '최대' : '—') : `${cost}코인`
          return (
            <li key={track}>
              <button
                type="button"
                disabled={!affordable}
                aria-label={`${def.name} 업그레이드 ${costLabel}`}
                onClick={() => onUpgrade(track)}
                className="flex min-h-16 w-full flex-col items-start rounded-xl border-2 border-stone-200 bg-white px-2 py-1 text-left leading-tight transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="font-bold">
                  {def.icon} {def.name} <span aria-hidden>{pips}</span>
                </span>
                <span className="text-xs text-stone-600">{def.description}</span>
                <span className={affordable ? 'text-amber-800' : 'text-rose-700'}>
                  {cost === null ? costLabel : `🪙 ${cost}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onSell}>
          판매 +🪙 {sellValue(tower)}
        </Button>
        <Button variant="ghost" onClick={onDeselect}>
          닫기
        </Button>
      </div>
    </section>
  )
}
