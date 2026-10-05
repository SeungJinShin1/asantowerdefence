/** 교사 모드 입장: 타이틀 운영자 메뉴 → 교사 코드 → 서버 확인 → 모든 단계가 열린 단계 선택 화면. */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRunStore } from '@/features/game/runStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { HIDDEN_MENU_TAPS, TitlePage } from '@/pages/TitlePage'
import { ApiError, api } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

beforeEach(() => {
  window.sessionStorage.clear()
  useRunStore.getState().reset()
  useProgressStore.getState().reset()
  useSessionStore.setState({ status: 'idle', session: null, errorMessage: null })
  vi.spyOn(api, 'healthz').mockResolvedValue({
    status: 'ok',
    version: '0.1.0',
    variantsReady: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function openOperatorMenu() {
  renderAt(
    '/',
    <Routes>
      <Route path="/" element={<TitlePage />} />
      <Route path="/stages" element={<p>단계 선택 화면</p>} />
    </Routes>,
  )
  const logo = screen.getByRole('button', { name: '아산 역사 지킴이 로고' })
  for (let i = 0; i < HIDDEN_MENU_TAPS; i += 1) await userEvent.click(logo)
  return screen.getByRole('region', { name: '운영자 메뉴' })
}

describe('교사 모드 입장', () => {
  it('운영자 메뉴를 열기 전에는 교사 코드 칸이 보이지 않는다', () => {
    renderAt(
      '/',
      <Routes>
        <Route path="/" element={<TitlePage />} />
      </Routes>,
    )
    expect(screen.queryByLabelText('교사 코드')).not.toBeInTheDocument()
  })

  it('맞는 코드: 교사 세션이 만들어지고 단계 선택으로 이동한다(코드는 저장하지 않는다)', async () => {
    const create = vi.spyOn(api, 'createTeacherSession').mockResolvedValue({
      sessionId: 's_teacher',
      token: 'tok',
      expiresAt: '2099-01-01T00:00:00Z',
      boothMode: true,
      teacher: true,
    })
    useProgressStore.getState().markCleared(1) // 이전 학생의 진행도가 남아 있던 상황
    await openOperatorMenu()

    await userEvent.type(screen.getByLabelText('교사 코드'), '  asan-2026 ')
    await userEvent.click(screen.getByRole('button', { name: '교사 모드로 시작' }))

    expect(await screen.findByText('단계 선택 화면')).toBeInTheDocument()
    expect(create).toHaveBeenCalledWith('asan-2026')
    const session = useSessionStore.getState().session
    expect(session).toMatchObject({ sessionId: 's_teacher', teacher: true, nickname: '선생님' })
    expect(useProgressStore.getState().clearedStages).toEqual([])
    expect(JSON.stringify(window.sessionStorage)).not.toContain('asan-2026')
  })

  it('틀린 코드: 서버 메시지를 보여 주고 머문다. 진행 중이던 세션은 지워지지 않는다', async () => {
    const existing = {
      sessionId: 's_student',
      token: 't',
      expiresAt: '2099-01-01T00:00:00Z',
      boothMode: true,
      nickname: '학생',
    }
    useSessionStore.setState({ status: 'ready', session: existing })
    vi.spyOn(api, 'createTeacherSession').mockRejectedValue(
      new ApiError('UNAUTHORIZED', '교사 코드가 맞지 않아요.', 401),
    )
    await openOperatorMenu()

    await userEvent.type(screen.getByLabelText('교사 코드'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '교사 모드로 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('교사 코드가 맞지 않아요.')
    expect(screen.queryByText('단계 선택 화면')).not.toBeInTheDocument()
    expect(useSessionStore.getState().session).toEqual(existing)
    await waitFor(() => expect(screen.getByLabelText('교사 코드')).toHaveValue(''))
  })

  it('코드가 비어 있으면 버튼이 눌리지 않는다', async () => {
    const create = vi.spyOn(api, 'createTeacherSession')
    await openOperatorMenu()
    expect(screen.getByRole('button', { name: '교사 모드로 시작' })).toBeDisabled()
    expect(create).not.toHaveBeenCalled()
  })
})
