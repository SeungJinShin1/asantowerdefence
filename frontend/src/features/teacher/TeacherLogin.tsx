/**
 * 교사 모드 입장 — 타이틀의 운영자 메뉴(로고 5번 탭) 안에서만 보인다.
 *
 * 보안 5항목:
 * - 라우트 보호: 코드는 서버(POST /sessions/teacher)가 환경변수 TEACHER_CODE 와 비교한다. IP당 5회/분.
 * - ENV 노출 방지: 코드는 프론트 번들에 없다. 입력값은 저장하지 않고(메모리 state 만) 요청 뒤 바로 지운다.
 * - 서버 측 검증: 여기서 받는 teacher 표시는 화면용이다. 리더보드 제외 등 권한 판단은 서버 세션이 한다.
 * - 에러 처리: 서버 메시지("교사 코드가 맞지 않아요.")만 보여 주고 상세는 드러내지 않는다.
 */
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { Button } from '@/shared/ui/Button'

export function TeacherLogin() {
  const navigate = useNavigate()
  const startTeacherSession = useSessionStore((s) => s.startTeacherSession)
  const wakeServer = useSessionStore((s) => s.wakeServer)
  const resetProgress = useProgressStore((s) => s.reset)
  const resetRun = useRunStore((s) => s.reset)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || code.trim() === '') return
    setBusy(true)
    setMessage(null)
    const awake = await wakeServer()
    if (!awake) {
      setBusy(false)
      setMessage('서버가 아직 깨어나지 않았어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    const ok = await startTeacherSession(code)
    setCode('')
    setBusy(false)
    if (!ok) {
      setMessage(useSessionStore.getState().errorMessage ?? '교사 모드로 들어가지 못했어요.')
      return
    }
    // 이전 학생의 진행도·기록이 남아 있지 않게 비우고 단계 선택으로
    resetProgress()
    resetRun()
    navigate('/stages')
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 border-t border-amber-300 pt-3">
      <h3 className="font-bold">교사 모드</h3>
      <p className="mb-2 text-sm">
        교사 코드를 넣으면 모든 단계가 열리고 검수 도구를 쓸 수 있어요. 교사 모드 기록은 순위에
        올라가지 않습니다.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          교사 코드
          <input
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={64}
            className="min-h-12 rounded-xl border-2 border-amber-300 px-3 text-lg"
          />
        </label>
        <Button type="submit" disabled={busy || code.trim() === ''}>
          {busy ? '확인 중…' : '교사 모드로 시작'}
        </Button>
      </div>
      {message && (
        <p role="alert" className="mt-2 text-sm font-bold text-rose-700">
          {message}
        </p>
      )}
    </form>
  )
}
