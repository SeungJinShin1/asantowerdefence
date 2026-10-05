/** HUD(DOM): 코인·체력·웨이브·콤보·2배 타임·게임 속도·일시정지. 글자 18px 이상, 색만으로 전달하지 않는다(docs/02 §11). */
import { ComboBadge } from '@/features/quiz/ComboBadge'
import { Button } from '@/shared/ui/Button'

import { GAME_SPEEDS, type GameSpeed, MAX_LIVES } from '../config/balance'
import type { HudSnapshot } from '../controller'

const PHASE_LABEL: Record<HudSnapshot['wavePhase'], string> = {
  prep: '준비',
  spawning: '몬스터 등장 중',
  boss_pending: '보스 등장 직전',
  fighting: '전투 중',
  cleared: '웨이브 클리어',
  done: '종료',
}

export interface HudProps {
  hud: HudSnapshot
  combo: number
  stage: number
  onSkipPrep: () => void
  onTogglePause: () => void
  onSetSpeed: (speed: GameSpeed) => void
}

export function Hud({ hud, combo, stage, onSkipPrep, onTogglePause, onSetSpeed }: HudProps) {
  const hearts = '❤️'.repeat(hud.lives) + '🖤'.repeat(Math.max(0, MAX_LIVES - hud.lives))
  const quizPaused = hud.pendingQuiz !== null
  return (
    <section
      aria-label="게임 상태"
      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/90 px-4 py-2 shadow"
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xl font-black text-amber-800" aria-label={`코인 ${hud.coins}`}>
          🪙 {hud.coins}
        </span>
        <span className="text-lg" aria-label={`성 체력 ${hud.lives} / ${MAX_LIVES}`}>
          {hearts}
        </span>
        <span className="font-bold">
          {stage}단계 · 웨이브 {Math.max(hud.wave, 1)}/{hud.wavesPerStage} ·{' '}
          {hud.wavePhase === 'prep' && hud.prepLeft > 0
            ? `${hud.prepLeft}초 뒤 시작`
            : PHASE_LABEL[hud.wavePhase]}
        </span>
        <ComboBadge combo={combo} />
        {hud.doubleCoinLeft > 0 && (
          <span className="rounded-full bg-yellow-400 px-3 py-1 text-sm font-black text-yellow-950">
            ✨ 코인 2배 {hud.doubleCoinLeft}초
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="게임 속도"
          className="flex overflow-hidden rounded-xl border-2 border-amber-400"
        >
          {GAME_SPEEDS.map((speed) => {
            const active = hud.speed === speed
            return (
              <button
                key={speed}
                type="button"
                aria-pressed={active}
                aria-label={`${speed}배 속도`}
                onClick={() => onSetSpeed(speed)}
                className={`min-h-12 min-w-12 px-3 text-base font-black transition ${
                  active ? 'bg-amber-500 text-white' : 'bg-white text-amber-800 hover:bg-amber-50'
                }`}
              >
                ×{speed}
              </button>
            )
          })}
        </div>
        {hud.wavePhase === 'prep' && hud.status === 'playing' && (
          <Button onClick={onSkipPrep}>바로 시작</Button>
        )}
        <Button
          variant="secondary"
          onClick={onTogglePause}
          disabled={quizPaused || hud.status !== 'playing'}
        >
          {hud.paused && !quizPaused ? '▶ 계속' : '⏸ 멈춤'}
        </Button>
      </div>
    </section>
  )
}
