/**
 * 퀴즈 연습 (docs/05 2.7, 개발·시연용): 백엔드와 연결해 출제 → 답변 → 코인·콤보 표시 흐름을 확인한다.
 * Phase 3 에서 Play 화면이 이 흐름(큐·모달·채점)을 그대로 가져다 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { ComboBadge } from '@/features/quiz/ComboBadge'
import { QuizModal } from '@/features/quiz/QuizModal'
import { useQuizQueue } from '@/features/quiz/useQuizQueue'
import { useSessionStore } from '@/features/session/sessionStore'
import {
  ApiError,
  api,
  type AnswerResponse,
  type QuizItem,
  type QuizKind,
  type StageStartResponse,
} from '@/shared/api'
import { Button } from '@/shared/ui/Button'

interface Hud {
  coins: number
  combo: number
  comboMax: number
  answered: number
  correct: number
}

const EMPTY_HUD: Hud = { coins: 0, combo: 0, comboMax: 0, answered: 0, correct: 0 }

export function QuizPracticePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stage = Math.min(Math.max(Number(searchParams.get('stage')) || 1, 1), 5)
  const session = useSessionStore((s) => s.session)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )
  const { sizes, load, take } = useQuizQueue(auth, stage)

  const [wavesPerStage, setWavesPerStage] = useState<number | null>(null)
  const [wave, setWave] = useState(1)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [current, setCurrent] = useState<QuizItem | null>(null)
  const [result, setResult] = useState<AnswerResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const fail = useCallback(
    (error: unknown) => {
      if (handleApiError(error)) {
        navigate('/', { replace: true })
        return
      }
      setMessage(error instanceof ApiError ? error.message : '잠시 문제가 생겼어요.')
    },
    [handleApiError, navigate],
  )

  const applyStart = useCallback(
    (res: StageStartResponse, retry: boolean) => {
      setWavesPerStage(res.wavesPerStage)
      load(res.quizBatch)
      setWave(1)
      setMessage(retry ? '같은 스테이지를 다시 시작했어요. 코인·콤보 통계는 이어집니다.' : null)
    },
    [load],
  )

  // 처음 들어오면 스테이지 시작(배치 수신). 언마운트·세션 변경 뒤 도착한 응답은 버린다.
  useEffect(() => {
    if (!auth) return
    let cancelled = false
    api
      .startStage(auth, stage, false)
      .then((res) => {
        if (!cancelled) applyStart(res, false)
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error)
      })
    return () => {
      cancelled = true
    }
  }, [applyStart, auth, fail, stage])

  const retryStage = async () => {
    if (!auth) return
    try {
      applyStart(await api.startStage(auth, stage, true), true)
    } catch (error) {
      fail(error)
    }
  }

  const open = async (kind: QuizKind) => {
    const item = await take(kind, wave)
    if (!item) {
      setMessage('더 꺼낼 문제가 없어요.')
      return
    }
    setResult(null)
    setCurrent(item)
  }

  const submit = async (choiceIndex: number, answeredMs: number) => {
    if (!auth || !current) return
    try {
      const res = await api.answerQuiz(auth, {
        quizId: current.quizId,
        choiceIndex,
        answeredMs,
        wave,
      })
      setResult(res)
      setHud((h) => ({
        coins: h.coins + res.coins,
        combo: res.combo,
        comboMax: res.comboMax,
        answered: h.answered + 1,
        correct: h.correct + (res.correct ? 1 : 0),
      }))
    } catch (error) {
      setCurrent(null)
      fail(error)
    }
  }

  const close = useCallback(() => {
    setCurrent(null)
    setResult(null)
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-900/70">퀴즈 연습 · {stage}단계</p>
          <h1 className="text-3xl font-black text-amber-700">출제 → 답변 → 코인 흐름 확인</h1>
        </div>
        <Button variant="ghost" onClick={() => navigate('/stages')}>
          스테이지 선택
        </Button>
      </header>

      <section
        aria-label="HUD"
        className="grid grid-cols-2 gap-3 rounded-3xl bg-white p-4 shadow-sm sm:grid-cols-4"
      >
        <Stat label="코인(퀴즈)" value={`🪙 ${hud.coins}`} />
        <Stat label="정답 / 답변" value={`${hud.correct} / ${hud.answered}`} />
        <Stat label="최대 콤보" value={String(hud.comboMax)} />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-amber-900/70">콤보</span>
          <ComboBadge combo={hud.combo} />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-3xl bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 font-semibold">
          웨이브
          <select
            value={wave}
            onChange={(e) => setWave(Number(e.target.value))}
            className="rounded-xl border-2 border-amber-300 px-3 py-2"
          >
            {Array.from({ length: wavesPerStage ?? 3 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-amber-900/70">
          남은 문제 — 일반 {sizes.normal} · 긴급 {sizes.emergency} · 러시 {sizes.rush}
          {wavesPerStage ? ` · 스테이지당 ${wavesPerStage}웨이브` : ''}
        </span>
      </section>

      <section className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => void open('normal')} disabled={!!current}>
          일반 퀴즈
        </Button>
        <Button
          size="lg"
          variant="danger"
          onClick={() => void open('emergency')}
          disabled={!!current}
        >
          긴급 퀴즈
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => void open('rush')}
          disabled={!!current}
        >
          역사 러시
        </Button>
        <Button variant="ghost" onClick={() => void retryStage()} disabled={!!current}>
          재도전(처음부터)
        </Button>
      </section>

      {message && (
        <p
          role="status"
          className="rounded-2xl bg-amber-100 px-4 py-3 font-semibold text-amber-900"
        >
          {message}
        </p>
      )}

      {current && (
        <QuizModal
          quiz={current}
          result={result}
          onSubmit={(c, ms) => void submit(c, ms)}
          onClose={close}
        />
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-amber-900/70">{label}</span>
      <span className="text-2xl font-black text-amber-800">{value}</span>
    </div>
  )
}
