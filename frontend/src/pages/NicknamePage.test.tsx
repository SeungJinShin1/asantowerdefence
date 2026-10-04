import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from '@/features/session/sessionStore'
import { ApiError, api } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { NicknamePage } from './NicknamePage'

function renderNickname() {
  return renderAt(
    '/nickname',
    <Routes>
      <Route path="/nickname" element={<NicknamePage />} />
      <Route path="/stages" element={<p>스테이지 화면</p>} />
    </Routes>,
  )
}

beforeEach(() => {
  useSessionStore.getState().clear()
  useSessionStore.setState({ serverAwake: false, errorMessage: null })
  vi.spyOn(api, 'healthz').mockResolvedValue({
    status: 'ok',
    version: '0.1.0',
    variantsReady: false,
  })
  vi.spyOn(api, 'createSession').mockResolvedValue({
    sessionId: 's_1',
    token: 's_1.1.sig',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    boothMode: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NicknamePage', () => {
  it('규칙에 맞지 않는 닉네임은 안내 문구를 보여 주고 세션을 만들지 않는다', async () => {
    renderNickname()
    await userEvent.type(screen.getByLabelText('닉네임'), '가')
    await userEvent.click(screen.getByRole('button', { name: '출발!' }))

    expect(screen.getByRole('alert')).toHaveTextContent('2글자 이상')
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('서버를 깨운 뒤 세션을 만들고 스테이지 화면으로 간다', async () => {
    renderNickname()
    await userEvent.type(screen.getByLabelText('닉네임'), ' 역사  탐험가 ')
    await userEvent.click(screen.getByRole('button', { name: '출발!' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/stages'))
    expect(api.healthz).toHaveBeenCalled()
    expect(api.createSession).toHaveBeenCalledWith('역사 탐험가')
    expect(useSessionStore.getState().auth()).toEqual({ sessionId: 's_1', token: 's_1.1.sig' })
  })

  it('세션 생성에 실패하면 오류 문구를 보여 주고 머문다', async () => {
    vi.mocked(api.createSession).mockRejectedValue(
      new ApiError('RATE_LIMITED', '요청이 너무 많아요.', 429),
    )
    renderNickname()
    await userEvent.type(screen.getByLabelText('닉네임'), '탐험가')
    await userEvent.click(screen.getByRole('button', { name: '출발!' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('요청이 너무 많아요.')
    expect(screen.getByTestId('location')).toHaveTextContent('/nickname')
  })
})
