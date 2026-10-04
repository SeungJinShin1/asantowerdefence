/**
 * 최상위 오류 경계 (docs/01 §6).
 *
 * 보안(프로덕션 에러 로그 처리): 사용자에게는 친절한 안내 화면만 보여 주고,
 * 스택·오류 메시지는 개발 환경(import.meta.env.DEV)에서만 console.error 로 남긴다.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 폴백 화면의 "다시 시도" 동작. 기본값은 새로고침. */
  onRetry?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false })
    if (this.props.onRetry) {
      this.props.onRetry()
    } else {
      window.location.reload()
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }
    return (
      <main
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center"
      >
        <p className="text-2xl font-bold">잠시 문제가 생겼어요</p>
        <p>걱정하지 마세요. 다시 시도하면 이어서 할 수 있어요.</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="rounded-2xl bg-amber-500 px-8 py-3 text-xl font-bold text-white shadow"
        >
          다시 시도
        </button>
      </main>
    )
  }
}
