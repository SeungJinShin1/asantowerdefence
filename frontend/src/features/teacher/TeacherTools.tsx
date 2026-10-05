/**
 * 교사 검수 도구(플레이 화면) — 교사 세션에서만 그린다. 5단계를 처음부터 다 깨지 않고도 훑어볼 수 있게 한다.
 * 버튼은 엔진의 순수 액션(engine/teacher.ts)을 부르며, 교사 세션의 기록은 서버가 리더보드에서 제외한다.
 */
import { TEACHER_COIN_GRANT } from '@/features/game/engine/teacher'
import { Button } from '@/shared/ui/Button'

export interface TeacherToolsProps {
  onAddCoins: () => void
  onSkipWave: () => void
  /** 퀴즈 중이거나 게임이 끝났으면 건너뛰기를 막는다 */
  canSkip: boolean
}

export function TeacherTools({ onAddCoins, onSkipWave, canSkip }: TeacherToolsProps) {
  return (
    <section
      aria-label="교사 검수 도구"
      className="mt-2 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-50 p-3 text-sm text-indigo-950"
    >
      <p className="font-black">👩‍🏫 교사 모드 · 검수 도구</p>
      <p>이 판의 기록은 순위에 올라가지 않아요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onAddCoins}>
          🪙 코인 +{TEACHER_COIN_GRANT}
        </Button>
        <Button variant="secondary" onClick={onSkipWave} disabled={!canSkip}>
          ⏭ 웨이브 건너뛰기
        </Button>
      </div>
    </section>
  )
}
