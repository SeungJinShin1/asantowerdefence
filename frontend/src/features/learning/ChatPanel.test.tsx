import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type Topic } from '@/shared/api'

import { ChatPanel } from './ChatPanel'

const topic: Topic = {
  id: 'onyang',
  order: 1,
  title: '온양온천',
  subtitle: '',
  era: '',
  keywords: ['탕정', '온수', '온양행궁', '세종'],
  cards: [{ id: 'c1', title: '카드', body: '본문' }],
}
const auth = { sessionId: 's_1', token: 't' }

beforeEach(() => {
  vi.spyOn(api, 'chat').mockResolvedValue({
    reply: '탕정은 끓는 우물이라는 뜻이에요.',
    suggested: ['온양행궁은 누가 지었어?', '신정비가 뭐야?', '어의정은?'],
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatPanel', () => {
  it('추천 질문을 누르면 서버에 보내고 답변과 새 추천 질문을 보여 준다', async () => {
    render(<ChatPanel topic={topic} auth={auth} />)
    expect(screen.getByRole('button', { name: '탕정이(가) 뭐예요?' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '탕정이(가) 뭐예요?' }))

    await waitFor(() => expect(screen.getByText(/끓는 우물/)).toBeInTheDocument())
    expect(api.chat).toHaveBeenCalledWith(auth, {
      topicId: 'onyang',
      messages: [{ role: 'user', content: '탕정이(가) 뭐예요?' }],
    })
    expect(screen.getByRole('button', { name: '신정비가 뭐야?' })).toBeInTheDocument()
  })

  it('직접 입력해 보내면 최근 6턴만 전송한다', async () => {
    render(<ChatPanel topic={topic} auth={auth} />)
    for (let i = 1; i <= 4; i += 1) {
      await userEvent.type(screen.getByLabelText('질문 입력'), `질문${i}`)
      await userEvent.click(screen.getByRole('button', { name: '보내기' }))
      await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(i))
    }
    const last = vi.mocked(api.chat).mock.calls.at(-1)![1]
    expect(last.messages).toHaveLength(6)
    expect(last.messages.at(-1)).toEqual({ role: 'user', content: '질문4' })
  })

  it('AI 가 쉬는 중이면 친절한 오류 문구를 보여 주고 질문은 남긴다', async () => {
    vi.mocked(api.chat).mockRejectedValue(new ApiError('AI_UNAVAILABLE', 'x', 503))
    render(<ChatPanel topic={topic} auth={auth} />)
    await userEvent.type(screen.getByLabelText('질문 입력'), '안녕')
    await userEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 선생님이 잠시 쉬고 있어요')
    expect(screen.getByText('안녕')).toBeInTheDocument()
  })

  it('세션이 없으면 입력이 비활성화된다', () => {
    render(<ChatPanel topic={topic} auth={null} />)
    expect(screen.getByLabelText('질문 입력')).toBeDisabled()
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
  })
})
