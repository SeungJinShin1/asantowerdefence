import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRunStore } from '@/features/game/runStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { api, type ReviewResponse } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { ReviewPage } from './ReviewPage'

const review: ReviewResponse = {
  items: [
    {
      quizId: 'q_1',
      stem: '백제 시대에 온양을 부르던 이름은?',
      yourAnswer: '온수(溫水)',
      correctAnswer: '탕정(湯井)',
      explanation: '탕정 → 온수 → 온양 순서예요.',
      aiNote: '끓는 우물이라는 뜻을 떠올려 봐요.',
      retryOptions: ['온수(溫水)', '탕정(湯井)', '온창(溫昌)', '온양(溫陽)'],
      retryCorrectIndex: 1,
    },
    {
      quizId: 'q_2',
      stem: '세종이 지은 것은?',
      yourAnswer: '시간 초과',
      correctAnswer: '온양행궁',
      explanation: '세종이 1432년에 짓게 했어요.',
      aiNote: '',
      retryOptions: ['온양행궁', '신정비', '영괴대', '어의정'],
      retryCorrectIndex: 0,
    },
  ],
  summary: '온양의 이름 변화를 다시 보면 좋아요.',
}

beforeEach(() => {
  window.sessionStorage.clear()
  useRunStore.getState().reset()
  useSessionStore.setState({
    status: 'ready',
    session: { sessionId: 's_1', token: 't', expiresAt: '', boothMode: true, nickname: '테스터' },
  })
  vi.spyOn(api, 'review').mockResolvedValue(review)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function renderReview() {
  return renderAt(
    '/review',
    <Routes>
      <Route path="/review" element={<ReviewPage />} />
      <Route path="/result" element={<p>결과 화면</p>} />
      <Route path="/nickname" element={<p>닉네임 화면</p>} />
    </Routes>,
  )
}

describe('ReviewPage', () => {
  it('틀린 문제·해설·AI 노트·요약을 보여 주고 결과를 캐시한다', async () => {
    renderReview()
    expect(await screen.findByText(review.summary)).toBeInTheDocument()
    expect(api.review).toHaveBeenCalledWith({ sessionId: 's_1', token: 't' })
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText(/끓는 우물이라는 뜻을/)).toBeInTheDocument()
    expect(screen.getByText('시간 초과')).toBeInTheDocument()
    expect(useRunStore.getState().review).toEqual(review)
  })

  it('"다시 풀기"는 로컬에서 채점하고 정답을 알려 준다', async () => {
    renderReview()
    const first = (await screen.findAllByRole('article'))[0]!
    await userEvent.click(within(first).getByRole('button', { name: '다시 풀기' }))
    await userEvent.click(within(first).getByRole('button', { name: /3\./ }))
    expect(within(first).getByRole('status')).toHaveTextContent('아쉬워요. 정답은 2번')

    await userEvent.click(within(first).getByRole('button', { name: '한 번 더' }))
    await userEvent.click(within(first).getByRole('button', { name: /2\./ }))
    expect(within(first).getByRole('status')).toHaveTextContent('정답이에요')
  })

  it('틀린 문제가 없으면 완벽 카드, 캐시가 있으면 API 를 다시 부르지 않는다', async () => {
    useRunStore.getState().setReview({ items: [], summary: '틀린 문제가 없어요! 완벽해요.' })
    renderReview()
    expect(await screen.findByText(/완벽해요! 틀린 문제가 하나도/)).toBeInTheDocument()
    expect(api.review).not.toHaveBeenCalled()
  })

  it('결과 화면으로 돌아갈 수 있다', async () => {
    renderReview()
    await screen.findByText(review.summary)
    await userEvent.click(screen.getByRole('button', { name: '결과 화면으로' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/result'))
  })
})
