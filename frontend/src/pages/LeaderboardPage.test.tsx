import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { ApiError, api, type FinishResponse, type LeaderboardEntry } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { LeaderboardPage } from './LeaderboardPage'

const finish: FinishResponse = {
  score: 1650,
  breakdown: { correct: 200, combo: 100, waves: 450, stages: 500, lives: 300, coins: 100 },
  correctCount: 2,
  answeredCount: 4,
  comboMax: 2,
  stageReached: 1,
  wrongQuizIds: [],
}
const rows: LeaderboardEntry[] = [
  {
    rank: 1,
    nickname: '번개 토끼',
    score: 4520,
    stageReached: 5,
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    rank: 2,
    nickname: '역사탐험가',
    score: 1650,
    stageReached: 1,
    createdAt: '2026-10-01T00:01:00Z',
  },
]

beforeEach(() => {
  window.sessionStorage.clear()
  useRunStore.getState().reset()
  useProgressStore.getState().reset()
  useSessionStore.setState({
    status: 'ready',
    session: {
      sessionId: 's_1',
      token: 't',
      expiresAt: '',
      boothMode: true,
      nickname: '역사탐험가',
    },
  })
  vi.spyOn(api, 'getLeaderboard').mockResolvedValue(rows)
  vi.spyOn(api, 'registerLeaderboard').mockResolvedValue({
    rank: 2,
    score: 1650,
    nickname: '역사탐험가',
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function renderBoard() {
  return renderAt(
    '/leaderboard',
    <Routes>
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/nickname" element={<p>닉네임 화면</p>} />
      <Route path="/" element={<p>타이틀</p>} />
    </Routes>,
  )
}

describe('LeaderboardPage', () => {
  it('끝난 판이 있으면 닉네임을 확인해 기록을 올리고 내 순위를 강조한다', async () => {
    useRunStore.getState().setFinish(finish)
    renderBoard()
    const input = await screen.findByLabelText('닉네임')
    expect(input).toHaveValue('역사탐험가')

    await userEvent.click(screen.getByRole('button', { name: '기록 올리기' }))

    await waitFor(() =>
      expect(api.registerLeaderboard).toHaveBeenCalledWith(
        { sessionId: 's_1', token: 't' },
        '역사탐험가',
      ),
    )
    expect(await screen.findByText(/역사탐험가 님은 2위예요/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '기록 올리기' })).not.toBeInTheDocument()
    const list = screen.getByRole('list')
    const mine = within(list).getAllByRole('listitem')[1]!
    expect(mine).toHaveAttribute('aria-current', 'true')
    expect(mine).toHaveTextContent('1,650점')
    expect(useRunStore.getState().leaderboard?.rank).toBe(2)
  })

  it('규칙에 맞지 않는 닉네임은 보내지 않고, 서버 거부 메시지는 그대로 보여 준다', async () => {
    useRunStore.getState().setFinish(finish)
    renderBoard()
    const input = await screen.findByLabelText('닉네임')
    await userEvent.clear(input)
    await userEvent.type(input, '가')
    await userEvent.click(screen.getByRole('button', { name: '기록 올리기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('2글자 이상')
    expect(api.registerLeaderboard).not.toHaveBeenCalled()

    vi.mocked(api.registerLeaderboard).mockRejectedValue(
      new ApiError('NICKNAME_REJECTED', '사용할 수 없는 말이 들어 있어요.', 400),
    )
    await userEvent.clear(input)
    await userEvent.type(input, '탐험가')
    await userEvent.click(screen.getByRole('button', { name: '기록 올리기' }))
    expect(await screen.findByText('사용할 수 없는 말이 들어 있어요.')).toBeInTheDocument()
  })

  it('끝난 판이 없으면 조회만 하고, "처음으로"는 세션·기록을 지운다', async () => {
    renderBoard()
    expect(await screen.findByText('번개 토끼')).toBeInTheDocument()
    expect(screen.queryByLabelText('닉네임')).not.toBeInTheDocument()
    expect(screen.getByText('🥇')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '처음으로' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'))
    expect(useSessionStore.getState().status).toBe('idle')
  })
})
