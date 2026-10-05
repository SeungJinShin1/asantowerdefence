/**
 * 리더보드 (docs/02 §10, docs/03 /leaderboard): 상위 20 조회(공개) + 끝난 세션의 기록 등록(세션당 1회).
 * 보안: 점수는 서버가 세션 결과에서 가져오고, 프론트는 닉네임만 보낸다(1차 검증 후). 등록 결과는 runStore 에 캐시.
 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { useRunStore } from '@/features/game/runStore'
import { normalizeNickname, validateNickname } from '@/features/session/nickname'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { ApiError, api, type LeaderboardEntry } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export function LeaderboardPage() {
  const navigate = useNavigate()
  const session = useSessionStore((s) => s.session)
  const clearSession = useSessionStore((s) => s.clear)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const resetProgress = useProgressStore((s) => s.reset)
  const finish = useRunStore((s) => s.finish)
  const registered = useRunStore((s) => s.leaderboard)
  const setLeaderboard = useRunStore((s) => s.setLeaderboard)
  const resetRun = useRunStore((s) => s.reset)

  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nickname, setNickname] = useState(session?.nickname ?? '')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )
  // 교사 모드 기록은 순위에 올리지 않는다(서버도 409 로 막는다)
  const isTeacher = session?.teacher === true
  const canRegister = Boolean(auth && finish && !registered && !isTeacher)
  const validation = validateNickname(nickname)

  const load = useCallback(async () => {
    try {
      setRows(await api.getLeaderboard(20))
      setLoadError(null)
    } catch {
      setLoadError('순위를 불러오지 못했어요.')
    }
  }, [])

  // 처음 들어오면 조회(언마운트 뒤 도착한 응답은 버린다). 재시도·등록 뒤 갱신은 load() 가 맡는다
  useEffect(() => {
    let cancelled = false
    api
      .getLeaderboard(20)
      .then((data) => {
        if (!cancelled) {
          setRows(data)
          setLoadError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('순위를 불러오지 못했어요.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!auth || validation || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await api.registerLeaderboard(auth, normalizeNickname(nickname))
      setLeaderboard(result)
      await load()
    } catch (error) {
      if (handleApiError(error)) {
        navigate('/', { replace: true })
        return
      }
      setSubmitError(error instanceof ApiError ? error.message : '기록을 올리지 못했어요.')
    } finally {
      setSubmitting(false)
    }
  }

  const leave = (to: string) => {
    clearSession()
    resetProgress()
    resetRun()
    navigate(to)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-black text-amber-700">명예의 전당</h1>
        <p className="text-amber-900/80">닉네임과 점수만 기록돼요.</p>
      </header>

      {registered && (
        <p
          role="status"
          className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-xl font-black text-emerald-900"
        >
          {registered.nickname} 님은 {registered.rank}위예요! ({registered.score.toLocaleString()}
          점)
        </p>
      )}

      {isTeacher && finish && (
        <p
          role="note"
          className="rounded-2xl bg-indigo-100 px-4 py-3 text-center font-bold text-indigo-950"
        >
          교사 모드 기록은 순위에 올라가지 않아요.
        </p>
      )}

      {canRegister && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow">
          <p className="text-lg font-bold">
            이번 판 {finish!.score.toLocaleString()}점을 기록할 닉네임을 확인해 주세요
          </p>
          <label className="flex flex-col gap-1 font-semibold">
            닉네임
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={12}
              disabled={submitting}
              aria-invalid={touched && validation ? true : undefined}
              className="rounded-2xl border-2 border-amber-300 px-4 py-3 text-xl focus:border-amber-500 focus:outline-none"
            />
          </label>
          {touched && validation && (
            <p role="alert" className="text-rose-600">
              {validation}
            </p>
          )}
          {submitError && (
            <p role="alert" className="text-rose-600">
              {submitError}
            </p>
          )}
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? '올리는 중…' : '기록 올리기'}
          </Button>
        </form>
      )}

      <section aria-label="상위 기록" className="rounded-3xl bg-white p-4 shadow">
        {rows === null && !loadError && <p className="text-center">순위를 불러오는 중…</p>}
        {loadError && (
          <p role="alert" className="text-center text-rose-600">
            {loadError}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              다시 시도
            </button>
          </p>
        )}
        {rows && rows.length === 0 && (
          <p className="text-center">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</p>
        )}
        {rows && rows.length > 0 && (
          <ol className="flex flex-col divide-y divide-amber-100">
            {rows.map((row) => {
              const mine =
                registered !== null &&
                row.rank === registered.rank &&
                row.nickname === registered.nickname
              return (
                <li
                  key={`${row.rank}-${row.createdAt}`}
                  aria-current={mine ? 'true' : undefined}
                  className={`flex items-center justify-between gap-3 px-2 py-2 text-lg ${
                    mine ? 'rounded-xl bg-amber-100 font-black' : ''
                  }`}
                >
                  <span className="w-10 text-center text-xl font-black text-amber-700">
                    {row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}
                  </span>
                  <span className="flex-1">{row.nickname}</span>
                  <span className="text-sm text-amber-900/70">{row.stageReached}단계</span>
                  <span className="w-24 text-right font-bold">{row.score.toLocaleString()}점</span>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => leave('/nickname')}>
          다시 도전
        </Button>
        <Button variant="secondary" size="lg" onClick={() => leave('/')}>
          처음으로
        </Button>
      </div>
    </main>
  )
}
