/** 빌드 메뉴: 타워 5종(해금·비용), 선택한 타워의 업그레이드·판매 (docs/02 §4). */
import { Button } from '@/shared/ui/Button'

import { TOWERS, TOWER_ORDER, type TowerId } from '../config/balance'
import type { HudSnapshot } from '../controller'
import { isTowerUnlocked, sellValue, towerStats, upgradeCost } from '../engine/tower'
import type { TowerState } from '../engine/state'
import { TOWER_COLORS } from '../render/sprites'

export interface BuildMenuProps {
  hud: HudSnapshot
  stage: number
  selectedTower: TowerState | null
  onPick: (type: TowerId | null) => void
  onUpgrade: () => void
  onSell: () => void
  onDeselect: () => void
}

export function BuildMenu({
  hud,
  stage,
  selectedTower,
  onPick,
  onUpgrade,
  onSell,
  onDeselect,
}: BuildMenuProps) {
  return (
    <section
      aria-label="타워 건설"
      className="flex flex-col gap-3 rounded-2xl bg-white/90 p-3 shadow"
    >
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-1">
        {TOWER_ORDER.map((type) => {
          const spec = TOWERS[type]
          const unlocked = isTowerUnlocked(type, stage)
          const affordable = hud.coins >= spec.cost
          const active = hud.buildType === type
          return (
            <button
              key={type}
              type="button"
              disabled={!unlocked}
              aria-pressed={active}
              aria-label={`${spec.name} ${spec.cost}코인${unlocked ? '' : ' (잠김)'}`}
              onClick={() => onPick(active ? null : type)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-sm font-bold transition sm:flex-row sm:justify-start sm:gap-3 ${
                active
                  ? 'border-amber-500 bg-amber-100'
                  : 'border-stone-200 bg-white hover:bg-amber-50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                aria-hidden
                className="inline-block h-7 w-7 rounded-lg"
                style={{ background: TOWER_COLORS[type] }}
              />
              <span className="flex flex-col leading-tight">
                <span>{spec.name}</span>
                <span className={affordable ? 'text-amber-800' : 'text-rose-600'}>
                  {unlocked ? `🪙 ${spec.cost}` : `${spec.unlockStage}단계 해금`}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selectedTower && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="text-base font-black">
            {TOWERS[selectedTower.type].name} Lv.{selectedTower.level}
          </p>
          <p>
            피해 {towerStats(selectedTower.type, selectedTower.level).damage.toFixed(1)} · 사거리{' '}
            {towerStats(selectedTower.type, selectedTower.level).range.toFixed(1)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {upgradeCost(selectedTower.type, selectedTower.level) !== null ? (
              <Button
                onClick={onUpgrade}
                disabled={hud.coins < (upgradeCost(selectedTower.type, selectedTower.level) ?? 0)}
              >
                업그레이드 🪙 {upgradeCost(selectedTower.type, selectedTower.level)}
              </Button>
            ) : (
              <span className="self-center font-bold">최고 레벨 ★★</span>
            )}
            <Button variant="secondary" onClick={onSell}>
              판매 +🪙 {sellValue(selectedTower)}
            </Button>
            <Button variant="ghost" onClick={onDeselect}>
              닫기
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
