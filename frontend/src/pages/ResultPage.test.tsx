import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { api, type FinishResponse } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { ResultPage } from './ResultPage'

const finish: FinishResponse = {
  score: 1650,
  breakdown: { correct: 200, combo: 100, waves: 450, stages: 500, lives: 300, coins: 100 },
  correctCount: 2,
  answeredCount: 4,
  comboMax: 2,
  stageReached: 1,
  wrongQuizIds: ['q_3', 'q_4'],
}

beforeEach(() => {
  window.sessionStorage.clear()
  useRunStore.getState().reset()
  useProgressStore.getState().reset()
  useSessionStore.setState({
    status: 'ready',
    session: { sessionId: 's_1', token: 't', expiresAt: '', boothMode: true, nickname: '테스터' },
  })
  vi.spyOn(api, 'finishSession').mockResolvedValue(finish)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderResult() {
  return renderAt(
    '/result',
    <Routes>
      <Route path="/result" element={<ResultPage />} />
      <Route path="/nickname" element={<p>닉네임 화면</p>} />
    </Routes>,
  )
}

describe('ResultPage', () => {
  it('누적 기록으로 finish 를 한 번 호출하고 서버 점수를 보여 준다', async () => {
    useRunStore.getState().recordStageEnd({
      stage: 1,
      won: true,
      wavesCleared: 3,
      livesLeft: 10,
      coinsLeft: 100,
      kills: 6,
    })
    renderResult()

    expect(await screen.findByLabelText('점수 1650')).toBeInTheDocument()
    expect(api.finishSession).toHaveBeenCalledTimes(1)
    expect(api.finishSession).toHaveBeenCalledWith(
      { sessionId: 's_1', token: 't' },
      {
        stagesCleared: 1,
        wavesCleared: 3,
        livesLeftAtEnd: 10,
        coinsLeftAtEnd: 100,
        clientScore: 0,
      },
    )
    expect(screen.getByText('2 / 4 (50%)')).toBeInTheDocument()
    expect(screen.getByText(/틀린 문제 2개/)).toBeInTheDocument()
    expect(useRunStore.getState().finish).toEqual(finish)
  })

  it('이미 점수가 있으면 다시 호출하지 않는다', async () => {
    useRunStore.getState().setFinish(finish)
    renderResult()
    expect(await screen.findByLabelText('점수 1650')).toBeInTheDocument()
    expect(api.finishSession).not.toHaveBeenCalled()
  })

  it('"다시 도전"은 세션·진행도·기록을 지우고 닉네임 화면으로 간다', async () => {
    useRunStore.getState().setFinish(finish)
    useProgressStore.getState().markCleared(1)
    renderResult()
    await screen.findByLabelText('점수 1650')

    await userEvent.click(screen.getByRole('button', { name: '다시 도전' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/nickname'))
    expect(useSessionStore.getState().status).toBe('idle')
    expect(useProgressStore.getState().clearedStages).toEqual([])
    expect(useRunStore.getState().finish).toBeNull()
  })
})
