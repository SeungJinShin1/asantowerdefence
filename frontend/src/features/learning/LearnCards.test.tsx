import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Topic } from '@/shared/api'

import { LearnCards } from './LearnCards'

const topic: Topic = {
  id: 'onyang',
  order: 1,
  title: '온양온천',
  subtitle: '',
  era: '',
  keywords: [],
  cards: [
    { id: 'c1', title: '첫 카드', body: '첫 내용' },
    { id: 'c2', title: '둘째 카드', body: '둘째 내용' },
    { id: 'c3', title: '셋째 카드', body: '셋째 내용' },
  ],
}

describe('LearnCards', () => {
  it('첫 카드부터 보여 주고 진행률을 표시하며 이전 버튼은 비활성', () => {
    render(<LearnCards topic={topic} completed={false} onComplete={() => {}} />)
    expect(screen.getByText('첫 카드')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('button', { name: '← 이전' })).toBeDisabled()
  })

  it('마지막 카드에서 보너스 버튼이 나타나고 한 번만 onComplete 를 부른다', async () => {
    const onComplete = vi.fn()
    const { rerender } = render(
      <LearnCards topic={topic} completed={false} onComplete={onComplete} />,
    )

    await userEvent.click(screen.getByRole('button', { name: '다음 →' }))
    expect(screen.getByText('둘째 카드')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다음 →' }))
    expect(screen.getByText('셋째 카드')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')

    const bonus = screen.getByRole('button', { name: /\+50 코인/ })
    await userEvent.click(bonus)
    expect(onComplete).toHaveBeenCalledTimes(1)

    rerender(<LearnCards topic={topic} completed onComplete={onComplete} />)
    const done = screen.getByRole('button', { name: /받았어요/ })
    expect(done).toBeDisabled()
  })

  it('카드가 없으면 안내 문구', () => {
    render(<LearnCards topic={{ ...topic, cards: [] }} completed={false} onComplete={() => {}} />)
    expect(screen.getByText(/학습 카드가 없어요/)).toBeInTheDocument()
  })
})
