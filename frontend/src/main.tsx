import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import { App } from '@/app/App'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useSessionStore } from '@/features/session/sessionStore'

import './index.css'

// 새로고침 대비: sessionStorage 에 남은(만료되지 않은) 세션을 먼저 복원한다
useSessionStore.getState().restore()

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root 요소를 찾을 수 없어요.')
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
