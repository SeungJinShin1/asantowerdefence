/** 콤보 표시 (docs/02 §6): 2연속 ×2, 3연속 이상 ×3 */
import { comboMultiplier } from './combo'

export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 2) {
    return (
      <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">
        콤보 {combo}
      </span>
    )
  }
  return (
    <span
      aria-live="polite"
      className="rounded-full bg-orange-500 px-3 py-1 text-sm font-black text-white shadow"
    >
      🔥 {combo}연속! 코인 ×{comboMultiplier(combo)}
    </span>
  )
}
