/**
 * 타이틀 화면 (docs/02 §1, §2, docs/04 §8).
 * - 개인정보 안내 문구: "닉네임과 점수만 기록됩니다"
 * - 숨김 메뉴: 로고를 5번 탭하면 부스 운영자 메뉴(세션 초기화, 모드 안내, 퀴즈 연습)
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { Button } from '@/shared/ui/Button'

export const HIDDEN_MENU_TAPS = 5

export function TitlePage() {
  const navigate = useNavigate()
  const [taps, setTaps] = useState(0)
  const clearSession = useSessionStore((s) => s.clear)
  const resetProgress = useProgressStore((s) => s.reset)
  const menuOpen = taps >= HIDDEN_MENU_TAPS
  const finished = useRunStore((s) => s.finish !== null)
  const resetRun = useRunStore((s) => s.reset)

  // 결과 화면을 거쳐 타이틀로 돌아오면(게임 종료) 다음 학생을 위해 세션·진행도·기록을 지운다 (docs/04 §3)
  useEffect(() => {
    if (finished) {
      clearSession()
      resetProgress()
      resetRun()
    }
  }, [clearSession, finished, resetProgress, resetRun])

  const handleReset = () => {
    clearSession()
    resetProgress()
    resetRun()
    setTaps(0)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <button
        type="button"
        aria-label="아산 역사 지킴이 로고"
        onClick={() => setTaps((n) => n + 1)}
        className="rounded-3xl bg-transparent p-4 focus:outline-none"
      >
        <h1 className="text-5xl font-black text-amber-700">아산 역사 지킴이</h1>
      </button>
      <p className="max-w-xl text-xl">
        아산의 역사를 AI 선생님과 함께 배우고, 퀴즈를 맞혀 코인을 모아 타워를 세우고,
        <br />
        망각의 괴물로부터 성을 지켜요!
      </p>
      <Button size="lg" onClick={() => navigate('/nickname')}>
        시작하기
      </Button>
      <p className="text-sm text-amber-900/70">
        이 게임은 닉네임과 점수만 기록됩니다. 이름·학교·연락처는 묻지 않아요.
      </p>

      {menuOpen && (
        <section
          aria-label="운영자 메뉴"
          className="mt-4 w-full max-w-md rounded-2xl border-2 border-dashed border-amber-400 bg-white/70 p-4 text-left text-base"
        >
          <h2 className="mb-2 font-bold">운영자 메뉴</h2>
          <p className="mb-3 text-sm">
            웨이브 수(부스 모드 3 / 전체 모드 5)는 서버 설정 <code>BOOTH_MODE</code>로 정해지며,
            세션 시작 시 자동으로 적용됩니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={handleReset}>
              세션·진행도 초기화
            </Button>
            <Link
              to="/practice"
              className="self-center rounded-2xl px-4 py-3 font-bold text-amber-800 underline"
            >
              퀴즈 연습(개발용)
            </Link>
          </div>
        </section>
      )}
    </main>
  )
}
