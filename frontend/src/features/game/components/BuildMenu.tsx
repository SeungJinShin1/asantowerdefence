/** 빌드 메뉴: 타워 5종(해금·비용) + 선택한 타워의 업그레이드 패널 (docs/02 §4). */
import { TOWERS, TOWER_ORDER, type TowerId } from '../config/balance'
import type { UpgradeTrack } from '../config/upgrades'
import type { HudSnapshot } from '../controller'
import type { TowerState } from '../engine/state'
import { isTowerUnlocked } from '../engine/tower'
import { TOWER_COLORS } from '../render/sprites'
import { UpgradePanel } from './UpgradePanel'

export interface BuildMenuProps {
  hud: HudSnapshot
  stage: number
  selectedTower: TowerState | null
  onPick: (type: TowerId | null) => void
  onUpgrade: (track: UpgradeTrack) => void
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
      <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
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
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-1 text-sm font-bold transition lg:flex-row lg:justify-start lg:gap-3 ${
                active
                  ? 'border-amber-500 bg-amber-100'
                  : 'border-stone-200 bg-white hover:bg-amber-50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                aria-hidden
                className="inline-block h-7 w-7 shrink-0 rounded-lg"
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

      {selectedTower ? (
        <UpgradePanel
          tower={selectedTower}
          coins={hud.coins}
          onUpgrade={onUpgrade}
          onSell={onSell}
          onDeselect={onDeselect}
        />
      ) : (
        <p className="text-sm text-stone-600">
          타워를 고르고 빈 땅을 누르면 지어요. 세운 타워를 누르면 업그레이드할 수 있어요.
        </p>
      )}
    </section>
  )
}
