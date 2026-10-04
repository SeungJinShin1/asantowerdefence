import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { Route, Routes, renderAt } from '@/test/render'

import { HIDDEN_MENU_TAPS, TitlePage } from './TitlePage'

function renderTitle() {
  return renderAt(
    '/',
    <Routes>
      <Route path="/" element={<TitlePage />} />
      <Route path="/nickname" element={<p>닉네임 화면</p>} />
    </Routes>,
  )
}

beforeEach(() => {
  useSessionStore.getState().clear()
  useProgressStore.getState().reset()
})

describe('TitlePage', () => {
  it('개인정보 안내 문구와 시작 버튼이 있고, 시작하면 닉네임 화면으로 간다', async () => {
    renderTitle()
    expect(screen.getByText(/닉네임과 점수만 기록됩니다/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '운영자 메뉴' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/nickname')
  })

  it('로고를 5번 탭하면 운영자 메뉴가 열리고 초기화가 동작한다', async () => {
    useProgressStore.getState().markCleared(1)
    renderTitle()
    const logo = screen.getByRole('button', { name: '아산 역사 지킴이 로고' })
    for (let i = 0; i < HIDDEN_MENU_TAPS - 1; i += 1) await userEvent.click(logo)
    expect(screen.queryByRole('region', { name: '운영자 메뉴' })).not.toBeInTheDocument()

    await userEvent.click(logo)
    expect(screen.getByRole('region', { name: '운영자 메뉴' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '세션·진행도 초기화' }))
    expect(useProgressStore.getState().clearedStages).toEqual([])
    expect(screen.queryByRole('region', { name: '운영자 메뉴' })).not.toBeInTheDocument()
  })
})
