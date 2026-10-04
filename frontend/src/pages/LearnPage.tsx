/**
 * 학습 화면 (docs/02 §1): 카드 + 챗봇 패널. 끝까지 읽으면 LEARN_COMPLETED 를 서버에 보고하고(+50 코인은 서버 코인
 * 계산이 아니라 다음 스테이지 시작 코인에 클라이언트가 더한다 — docs/02 §8) 게임으로 넘어간다. 건너뛸 수 있다.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import { ChatPanel } from '@/features/learning/ChatPanel'
import { LearnCards } from '@/features/learning/LearnCards'
import { useTopicsStore } from '@/features/learning/topicsStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { api } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export function LearnPage() {
  const navigate = useNavigate()
  const params = useParams()
  const stage = Number(params.stage)
  const { status, load, byOrder } = useTopicsStore()
  const session = useSessionStore((s) => s.session)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const isUnlocked = useProgressStore((s) => s.isUnlocked)
  const learnedStages = useProgressStore((s) => s.learnedStages)
  const markLearned = useProgressStore((s) => s.markLearned)
  const [notice, setNotice] = useState<string | null>(null)

  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (!Number.isInteger(stage) || !isUnlocked(stage)) return <Navigate to="/stages" replace />

  const topic = byOrder(stage)
  const completed = learnedStages.includes(stage)

  const handleComplete = async () => {
    if (!auth || completed) return
    markLearned(stage) // 서버가 상한(스테이지당 1회)을 검사하므로 화면은 낙관적으로 표시
    setNotice(`학습 보너스 +50 코인! 게임을 시작하면 코인에 더해져요.`)
    try {
      await api.reportEvent(auth, {
        type: 'LEARN_COMPLETED',
        stageOrder: stage,
        wave: 0,
        at: new Date().toISOString(),
      })
    } catch (error) {
      if (handleApiError(error)) navigate('/', { replace: true })
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-900/70">{stage}단계 학습</p>
          <h1 className="text-3xl font-black text-amber-700">{topic?.title ?? '…'}</h1>
          {topic && <p className="text-amber-900/80">{topic.subtitle}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/stages')}>
            스테이지 선택
          </Button>
          <Button onClick={() => navigate(`/play/${stage}`)}>
            {completed ? '게임 시작!' : '건너뛰고 게임 시작'}
          </Button>
        </div>
      </header>

      {notice && (
        <p
          role="status"
          className="rounded-2xl bg-emerald-100 px-4 py-3 font-semibold text-emerald-900"
        >
          {notice}
        </p>
      )}

      {status === 'loading' && <p>학습 카드를 불러오는 중…</p>}
      {status === 'error' && (
        <p role="alert" className="text-rose-600">
          학습 카드를 불러오지 못했어요.{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            다시 시도
          </button>
        </p>
      )}

      {topic && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <LearnCards
            topic={topic}
            completed={completed}
            onComplete={() => void handleComplete()}
          />
          <ChatPanel topic={topic} />
        </div>
      )}
    </main>
  )
}
