/** 콤보 배율 (docs/02 §6): 콤보 1 → ×1, 2 → ×2, 3 이상 → ×3. 서버 scoring.combo_multiplier 와 같은 표 */
export function comboMultiplier(combo: number): number {
  if (combo >= 3) return 3
  if (combo === 2) return 2
  return 1
}
