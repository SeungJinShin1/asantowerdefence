import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnswerResponse, QuizItem } from '@/shared/api'

import { QuizModal } from './QuizModal'

const quiz: QuizItem = {
  quizId: 'q_1',
  difficulty: 1,
  kind: 'normal',
  stem: '백제 시대에 온양을 부르던 이름은?',
  options: ['온수', '탕정', '온창', '온양'],
  timeLimitSec: 15,
}

const result: AnswerResponse = {
  correct: true,
  correctIndex: 1,
  explanation: '백제 탕정 → 고려 온수 → 조선 온양',
  coins: 40,
  breakdown: { base: 30, comboMult: 1, fastBonus: 10, eventMult: 1 },
  combo: 1,
  comboMax: 1,
  coinsFromQuiz: 40,
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('QuizModal', () => {
  it('보기를 고르면 선택 번호와 걸린 시간을 한 번만 제출한다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onSubmit = vi.fn()
    render(<QuizModal quiz={quiz} result={null} onSubmit={onSubmit} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(quiz.stem)

    await act(async () => {
      vi.advanceTimersByTime(4_200)
    })
    await user.click(screen.getByRole('button', { name: /2\./ }))
    await user.click(screen.getByRole('button', { name: /3\./ }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [choice, answeredMs] = onSubmit.mock.calls[0]!
    expect(choice).toBe(1)
    expect(answeredMs).toBeGreaterThanOrEqual(4_200)
    expect(answeredMs).toBeLessThan(15_000)
    expect(screen.getByRole('status')).toHaveTextContent('확인 중')
    expect(screen.getByRole('button', { name: /1\./ })).toBeDisabled()
  })

  it('제한시간이 끝나면 -1 을 제출한다', async () => {
    const onSubmit = vi.fn()
    render(<QuizModal quiz={quiz} result={null} onSubmit={onSubmit} onClose={() => {}} />)
    expect(screen.getByRole('timer')).toHaveTextContent('15초')

    await act(async () => {
      vi.advanceTimersByTime(15_100)
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(-1, 15_000)
  })

  it('결과가 오면 정답·해설·코인을 보여 주고 3초 뒤 닫는다', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <QuizModal quiz={quiz} result={null} onSubmit={() => {}} onClose={onClose} />,
    )
    rerender(<QuizModal quiz={quiz} result={result} onSubmit={() => {}} onClose={onClose} />)

    expect(screen.getByRole('status')).toHaveTextContent('정답이에요! +40 코인')
    expect(screen.getByRole('status')).toHaveTextContent(result.explanation)
    expect(screen.getByRole('button', { name: /2\./ })).toHaveTextContent('✅')
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(3_000)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('오답이면 아쉬움 문구와 함께 정답을 표시한다', () => {
    render(
      <QuizModal
        quiz={quiz}
        result={{ ...result, correct: false, coins: 0 }}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('아쉬워요')
    expect(screen.getByRole('button', { name: /2\./ })).toHaveTextContent('✅')
  })
})
