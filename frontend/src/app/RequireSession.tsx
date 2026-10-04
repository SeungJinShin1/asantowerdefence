/**
 * 세션이 없으면 타이틀로 돌려보내는 라우트 가드.
 * 보안(라우트 보호): 토큰 없이 학습·게임 화면에 들어갈 수 없다.
 * 새로고침 대비 sessionStorage 복원은 앱 시작 시(main.tsx) 한 번 수행한다.
 */
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'

import { useSessionStore } from '@/features/session/sessionStore'

export function RequireSession({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status)
  if (status !== 'ready') return <Navigate to="/" replace />
  return <>{children}</>
}
