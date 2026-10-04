/**
 * 퀴즈 팝업 (docs/02 §6): 보기 4개, 제한시간(기본 15초), 시간 초과는 choiceIndex -1 로 제출(감점 없음),
 * 서버 응답이 오기 전에는 "확인 중", 결과·해설을 보여 준 뒤(기본 3초) 닫힌다.
 * 정답 여부는 서버만 안다 — 이 컴포넌트는 result 로 받은 값을 표시만 한다.
 */
import { useCallback, useEffect, useState } from 'react'

import type { AnswerResponse, QuizItem, QuizKind } from '@/shared/api'

export const EXPLANATION_MS = 3_000
const TICK_MS = 100

const KIND_LABEL: Record<QuizKind, { text: string; className: string }> = {
  normal: { text: '퀴즈', className: 'bg-amber-500' },
  emergency: { text: '긴급 퀴즈!', className: 'bg-rose-600' },
  rush: { text: '역사 러시', className: 'bg-violet-600' },
}

export interface QuizModalProps {
  quiz: QuizItem
  /** 서버 채점 결과. null 이면 아직 풀고 있거나 확인 중 */
  result: AnswerResponse | null
  onSubmit: (choiceIndex: number, answeredMs: number) => void
  onClose: () => void
  explanationMs?: number
  /** 테스트용 시계 */
  now?: () => number
}

export function QuizModal({
  quiz,
  result,
  onSubmit,
  onClose,
  explanationMs = EXPLANATION_MS,
  now = () => Date.now(),
}: QuizModalProps) {
  const limitMs = quiz.timeLimitSec * 1000
  const [startedAt] = useState(() => now())
  const [remainingMs, setRemainingMs] = useState(limitMs)
  const [choice, setChoice] = useState<number | null>(null)
  const submitted = choice !== null

  const submit = useCallback(
    (index: number) => {
      setChoice((current) => {
        if (current !== null) return current // 두 번 제출 방지
        onSubmit(index, Math.min(Math.max(now() - startedAt, 0), limitMs))
        return index
      })
    },
    [limitMs, now, onSubmit, startedAt],
  )

  // 제한시간 타이머
  useEffect(() => {
    if (submitted) return
    const id = setInterval(() => {
      const left = limitMs - (now() - startedAt)
      if (left <= 0) {
        setRemainingMs(0)
        submit(-1)
      } else {
        setRemainingMs(left)
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [limitMs, now, startedAt, submit, submitted])

  // 결과를 보여 준 뒤 자동으로 닫기
  useEffect(() => {
    if (!result) return
    const id = setTimeout(onClose, explanationMs)
    return () => clearTimeout(id)
  }, [explanationMs, onClose, result])

  const label = KIND_LABEL[quiz.kind]
  const seconds = Math.ceil(remainingMs / 1000)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-stem"
        className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <span
            className={`rounded-full px-3 py-1 text-sm font-black text-white ${label.className}`}
          >
            {label.text}
          </span>
          <span
            role="timer"
            aria-label="남은 시간"
            className={`text-2xl font-black ${seconds <= 5 ? 'text-rose-600' : 'text-amber-700'}`}
          >
            {submitted ? '—' : `${seconds}초`}
          </span>
        </div>
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-amber-100">
          <div
            className="h-full bg-amber-500 transition-[width] duration-100"
            style={{ width: `${(remainingMs / limitMs) * 100}%` }}
          />
        </div>

        <h2 id="quiz-stem" className="mb-4 text-2xl font-bold leading-snug">
          {quiz.stem}
        </h2>

        <ol className="grid gap-3 sm:grid-cols-2">
          {quiz.options.map((option, index) => {
            const isChosen = choice === index
            const isCorrect = result ? result.correctIndex === index : false
            let tone = 'border-amber-300 bg-white hover:bg-amber-50'
            if (result && isCorrect) tone = 'border-emerald-500 bg-emerald-50'
            else if (result && isChosen) tone = 'border-rose-400 bg-rose-50'
            else if (isChosen) tone = 'border-amber-500 bg-amber-100'
            return (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => submit(index)}
                  disabled={submitted}
                  aria-pressed={isChosen}
                  className={`w-full rounded-2xl border-2 px-4 py-3 text-left text-lg font-semibold transition disabled:cursor-default ${tone}`}
                >
                  <span className="mr-2 text-amber-700">{index + 1}.</span>
                  {option}
                  {result && isCorrect && <span className="ml-2">✅</span>}
                </button>
              </li>
            )
          })}
        </ol>

        <div role="status" aria-live="polite" className="mt-4 min-h-16 text-lg">
          {submitted && !result && <p className="text-amber-800">확인 중…</p>}
          {result && (
            <div className={result.correct ? 'text-emerald-800' : 'text-rose-800'}>
              <p className="text-xl font-black">
                {result.correct
                  ? `정답이에요! +${result.coins} 코인`
                  : choice === -1
                    ? '시간 초과! 다음엔 더 빨리 골라 봐요'
                    : '아쉬워요! 정답을 확인해 봐요'}
              </p>
              <p className="mt-1 text-base text-stone-800">{result.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
