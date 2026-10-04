import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicsStore } from '@/features/learning/topicsStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { api, type Topic } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { StageSelectPage } from './StageSelectPage'

const TOPICS: Topic[] = [
  ['onyang', '온양온천', '왕들이 사랑한 휴양지', '백제 ~ 현재'],
  ['maengsaseong', '고불 맹사성', '청백리의 표상', '조선 전기'],
  ['yisunsin', '충무공 이순신', '바다를 지킨 영웅', '조선 중기'],
  ['gongseri', '공세리 성당', '언덕 위 붉은 성당', '근대'],
  ['seonjang', '선장 4·4 만세운동', '태극기 물결', '일제강점기'],
].map(([id, title, subtitle, era], i) => ({
  id: id!,
  order: i + 1,
  title: title!,
  subtitle: subtitle!,
  era: era!,
  keywords: [],
  cards: [{ id: `${id}-c1`, title: '카드', body: '본문' }],
}))

beforeEach(() => {
  useProgressStore.getState().reset()
  useTopicsStore.setState({ topics: [], status: 'idle' })
  useSessionStore.setState({
    status: 'ready',
    session: { sessionId: 's_1', token: 't', expiresAt: '', boothMode: true, nickname: '탐험가' },
  })
  vi.spyOn(api, 'getTopics').mockResolvedValue(TOPICS)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderStages() {
  return renderAt(
    '/stages',
    <Routes>
      <Route path="/stages" element={<StageSelectPage />} />
      <Route path="/learn/:stage" element={<p>학습 화면</p>} />
    </Routes>,
  )
}

describe('StageSelectPage', () => {
  it('주제 5개를 순서대로 보여 주고 1단계만 열려 있다', async () => {
    renderStages()
    const first = await screen.findByRole('button', { name: /1단계 온양온천/ })
    expect(first).toBeEnabled()
    const second = screen.getByRole('button', { name: /2단계 고불 맹사성 \(잠김\)/ })
    expect(second).toBeDisabled()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText(/탐험가 님/)).toBeInTheDocument()
  })

  it('열린 스테이지를 고르면 현재 스테이지를 기록하고 학습 화면으로 간다', async () => {
    useProgressStore.getState().markCleared(1)
    renderStages()
    const second = await screen.findByRole('button', { name: /2단계 고불 맹사성$/ })
    expect(screen.getByRole('button', { name: /1단계 온양온천/ })).toHaveTextContent('클리어')
    await userEvent.click(second)

    expect(useProgressStore.getState().currentStage).toBe(2)
    expect(screen.getByTestId('location')).toHaveTextContent('/learn/2')
  })
})
