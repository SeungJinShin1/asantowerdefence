import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('secret internal detail')
  }
  return <p>정상 화면</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React 가 jsdom 에 찍는 오류 로그를 조용히 한다
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('자식이 정상일 때는 그대로 그린다', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('정상 화면')).toBeInTheDocument()
  })

  it('예외가 나면 안내 화면을 보여 주고 내부 메시지는 노출하지 않는다', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('잠시 문제가 생겼어요')
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument()
  })

  it('"다시 시도"를 누르면 onRetry 를 호출하고 자식을 다시 그린다', async () => {
    const onRetry = vi.fn()
    let shouldThrow = true
    const { rerender } = render(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    shouldThrow = false
    rerender(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('정상 화면')).toBeInTheDocument()
  })
})
