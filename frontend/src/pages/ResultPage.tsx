/**
 * 결과 화면 (docs/02 §10): finish 를 한 번 호출해 서버 점수를 받는다. 클라이언트 점수는 참고값(0)으로 보낸다.
 * 보안(서버 측 검증): 점수는 서버 breakdown 만 표시한다. 세션은 결과 화면을 떠날 때 정리한다(docs/04 §3).
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { ApiError, api, type FinishResponse } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export function ResultPage() {
  const navigate = useNavigate()
  const session = useSessionStore((s) => s.session)
  const clearSession = useSessionStore((s) => s.clear)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const resetProgress = useProgressStore((s) => s.reset)
  const run = useRunStore()
  const [error, setError] = useState<string | null>(null)
  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )
  const result: FinishResponse | null = run.finish

  useEffect(() => {
    if (!auth || result) return
    let cancelled = false
    api
      .finishSession(auth, {
        stagesCleared: run.stagesCleared,
        wavesCleared: run.wavesCleared,
        livesLeftAtEnd: run.livesLeftAtEnd,
        coinsLeftAtEnd: run.coinsLeftAtEnd,
        clientScore: 0,
      })
      .then((res) => {
        if (!cancelled) run.setFinish(res)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (handleApiError(e)) navigate('/', { replace: true })
        else setError(e instanceof ApiError ? e.message : '점수를 계산하지 못했어요.')
      })
    return () => {
      cancelled = true
    }
    // run 객체 전체가 아니라 보고값만 의존
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, result, run.stagesCleared, run.wavesCleared, run.livesLeftAtEnd, run.coinsLeftAtEnd])

  const playAgain = () => {
    clearSession()
    resetProgress()
    run.reset()
    navigate('/nickname')
  }

  const accuracy =
    result && result.answeredCount > 0
      ? Math.round((result.correctCount / result.answeredCount) * 100)
      : 0

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-black text-amber-700">결과</h1>
      {!result && !error && <p className="text-xl">점수를 계산하는 중…</p>}
      {error && (
        <p role="alert" className="text-rose-600">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="text-6xl font-black text-amber-800" aria-label={`점수 ${result.score}`}>
            {result.score.toLocaleString()}점
          </p>
          <dl className="grid w-full grid-cols-2 gap-3 rounded-3xl bg-white p-5 text-left shadow sm:grid-cols-3">
            <Stat
              label="정답"
              value={`${result.correctCount} / ${result.answeredCount} (${accuracy}%)`}
            />
            <Stat label="최대 콤보" value={`${result.comboMax}연속`} />
            <Stat label="도달 스테이지" value={`${result.stageReached}단계`} />
            <Stat label="정답 점수" value={`${result.breakdown.correct}`} />
            <Stat
              label="웨이브·스테이지"
              value={`${result.breakdown.waves + result.breakdown.stages}`}
            />
            <Stat label="체력·코인" value={`${result.breakdown.lives + result.breakdown.coins}`} />
          </dl>
          <p className="text-amber-900/80">
            {result.wrongQuizIds.length === 0
              ? '완벽해요! 틀린 문제가 하나도 없어요.'
              : `틀린 문제 ${result.wrongQuizIds.length}개는 AI 선생님이 곧 정리해 줄 거예요(다음 단계에서 열려요).`}
          </p>
        </>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={playAgain}>
          다시 도전
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => navigate('/review')}
          disabled={!result}
        >
          오답 정리
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => navigate('/leaderboard')}
          disabled={!result}
        >
          리더보드
        </Button>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-amber-900/70">{label}</dt>
      <dd className="text-xl font-black">{value}</dd>
    </div>
  )
}
