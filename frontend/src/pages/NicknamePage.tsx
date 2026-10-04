/**
 * 닉네임 입력 → 서버 깨우기(/healthz) → 세션 생성 → 스테이지 선택.
 * 보안: 닉네임만 묻는다(개인정보 없음). 토큰은 세션 스토어가 sessionStorage 에만 보관한다.
 */
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'

import { NICKNAME_MAX, normalizeNickname, validateNickname } from '@/features/session/nickname'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { Button } from '@/shared/ui/Button'

type Phase = 'input' | 'waking' | 'starting'

export function NicknamePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<Phase>('input')
  const startSession = useSessionStore((s) => s.startSession)
  const wakeServer = useSessionStore((s) => s.wakeServer)
  const serverAwake = useSessionStore((s) => s.serverAwake)
  const errorMessage = useSessionStore((s) => s.errorMessage)
  const resetProgress = useProgressStore((s) => s.reset)

  const validation = validateNickname(name)
  const busy = phase !== 'input'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (validation) return
    if (!serverAwake) {
      setPhase('waking')
      await wakeServer()
    }
    setPhase('starting')
    const ok = await startSession(normalizeNickname(name))
    if (ok) {
      resetProgress() // 새 판
      navigate('/stages')
    } else {
      setPhase('input')
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-black text-amber-700">닉네임을 정해 주세요</h1>
      <p className="text-amber-900/80">
        2~10글자, 한글·영어·숫자만 돼요. 실제 이름은 쓰지 않아도 괜찮아요.
      </p>
      <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-4">
        <label className="flex flex-col gap-2 text-left text-lg font-semibold">
          닉네임
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={NICKNAME_MAX + 2}
            autoComplete="off"
            disabled={busy}
            aria-invalid={touched && validation ? true : undefined}
            aria-describedby="nickname-help"
            className="rounded-2xl border-2 border-amber-300 bg-white px-4 py-3 text-2xl focus:border-amber-500 focus:outline-none"
          />
        </label>
        <p
          id="nickname-help"
          role={touched && validation ? 'alert' : undefined}
          className="min-h-6 text-rose-600"
        >
          {touched && validation ? validation : ''}
        </p>
        <Button size="lg" type="submit" disabled={busy}>
          {phase === 'waking' && '서버를 깨우는 중이에요…'}
          {phase === 'starting' && '게임을 준비하는 중…'}
          {phase === 'input' && '출발!'}
        </Button>
        {errorMessage && phase === 'input' && (
          <p role="alert" className="text-rose-600">
            {errorMessage}
          </p>
        )}
      </form>
    </main>
  )
}
