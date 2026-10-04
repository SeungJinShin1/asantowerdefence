/**
 * 오답 정리 화면 (docs/02 §10): 서버 POST /review 로 틀린 문제·해설·AI 노트를 받고, 문항마다 "다시 풀기"(로컬 채점,
 * 점수 미반영). 보안: 정답 위치(retryCorrectIndex)는 게임이 끝난 뒤 서버가 내려준 값만 쓴다.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { ApiError, api, type ReviewItem } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export function ReviewPage() {
  const navigate = useNavigate()
  const session = useSessionStore((s) => s.session)
  const clearSession = useSessionStore((s) => s.clear)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const resetProgress = useProgressStore((s) => s.reset)
  const review = useRunStore((s) => s.review)
  const setReview = useRunStore((s) => s.setReview)
  const resetRun = useRunStore((s) => s.reset)
  const [error, setError] = useState<string | null>(null)
  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )

  useEffect(() => {
    if (!auth || review) return
    let cancelled = false
    api
      .review(auth)
      .then((res) => {
        if (!cancelled) setReview(res)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (handleApiError(e)) navigate('/', { replace: true })
        else setError(e instanceof ApiError ? e.message : '오답 정리를 불러오지 못했어요.')
      })
    return () => {
      cancelled = true
    }
  }, [auth, handleApiError, navigate, review, setReview])

  const playAgain = () => {
    clearSession()
    resetProgress()
    resetRun()
    navigate('/nickname')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-black text-amber-700">AI 선생님의 오답 정리</h1>
        {review?.summary && <p className="mt-2 text-lg text-amber-900/80">{review.summary}</p>}
      </header>

      {!review && !error && <p className="text-center text-xl">AI 선생님이 정리하는 중…</p>}
      {error && (
        <p role="alert" className="text-center text-rose-600">
          {error}
        </p>
      )}
      {review && review.items.length === 0 && (
        <section className="rounded-3xl bg-emerald-100 p-8 text-center text-2xl font-black text-emerald-900">
          완벽해요! 틀린 문제가 하나도 없어요 🎉
        </section>
      )}
      {review && review.items.length > 0 && (
        <ol className="flex flex-col gap-4">
          {review.items.map((item, index) => (
            <li key={item.quizId}>
              <ReviewCard index={index + 1} item={item} />
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => navigate('/result')}>
          결과 화면으로
        </Button>
        <Button size="lg" onClick={playAgain}>
          다시 도전
        </Button>
      </div>
    </main>
  )
}

function ReviewCard({ index, item }: { index: number; item: ReviewItem }) {
  const [retrying, setRetrying] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const correct = picked !== null && picked === item.retryCorrectIndex

  return (
    <article className="rounded-3xl border-2 border-amber-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-amber-900/70">문제 {index}</p>
      <h2 className="text-xl font-bold">{item.stem}</h2>
      <dl className="mt-3 grid gap-1 text-base sm:grid-cols-2">
        <div>
          <dt className="text-sm text-rose-700">내가 고른 답</dt>
          <dd className="font-semibold text-rose-800">{item.yourAnswer}</dd>
        </div>
        <div>
          <dt className="text-sm text-emerald-700">정답</dt>
          <dd className="font-semibold text-emerald-800">{item.correctAnswer}</dd>
        </div>
      </dl>
      <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3">{item.explanation}</p>
      {item.aiNote && (
        <p className="mt-2 rounded-2xl bg-sky-50 px-4 py-3 text-sky-900">🧑‍🏫 {item.aiNote}</p>
      )}

      <div className="mt-4">
        {!retrying ? (
          <Button variant="secondary" onClick={() => setRetrying(true)}>
            다시 풀기
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <ol className="grid gap-2 sm:grid-cols-2">
              {item.retryOptions.map((option, i) => {
                let tone = 'border-amber-300 bg-white hover:bg-amber-50'
                if (picked !== null && i === item.retryCorrectIndex)
                  tone = 'border-emerald-500 bg-emerald-50'
                else if (picked === i) tone = 'border-rose-400 bg-rose-50'
                return (
                  <li key={option}>
                    <button
                      type="button"
                      disabled={picked !== null}
                      onClick={() => setPicked(i)}
                      className={`w-full rounded-2xl border-2 px-4 py-2 text-left font-semibold ${tone}`}
                    >
                      {i + 1}. {option}
                    </button>
                  </li>
                )
              })}
            </ol>
            {picked !== null && (
              <p
                role="status"
                className={correct ? 'font-black text-emerald-700' : 'font-black text-rose-700'}
              >
                {correct
                  ? '정답이에요! 이제 확실히 기억하겠죠? 🎉'
                  : `아쉬워요. 정답은 ${item.retryCorrectIndex + 1}번 "${item.correctAnswer}" 이에요.`}
              </p>
            )}
            {picked !== null && (
              <Button variant="ghost" onClick={() => setPicked(null)}>
                한 번 더
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
