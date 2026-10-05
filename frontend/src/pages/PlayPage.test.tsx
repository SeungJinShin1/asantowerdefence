/** 3.9 통합 테스트: 웨이브 1 클리어 시나리오(렌더는 목, 엔진은 컨트롤러 tick 으로 결정적으로 진행). */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GameController } from '@/features/game/controller'
import { damageEnemy } from '@/features/game/engine/enemy'
import { handleKill } from '@/features/game/engine/loop'
import { useRunStore } from '@/features/game/runStore'
import { useTopicsStore } from '@/features/learning/topicsStore'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import { api, type QuizItem } from '@/shared/api'
import { Route, Routes, renderAt } from '@/test/render'

import { PlayPage } from './PlayPage'

const quizBatch: QuizItem[] = Array.from({ length: 6 }, (_, i) => ({
  quizId: `q_${i}`,
  difficulty: 1,
  kind: i < 4 ? 'normal' : i === 4 ? 'emergency' : 'rush',
  stem: `문제 ${i}`,
  options: ['가', '나', '다', '라'],
  timeLimitSec: 15,
}))

let controller: GameController | null = null

beforeEach(() => {
  controller = null
  window.sessionStorage.clear()
  useProgressStore.getState().reset()
  useRunStore.getState().reset()
  useTopicsStore.setState({
    status: 'ready',
    topics: [
      { id: 'onyang', order: 1, title: '온양온천', subtitle: '', era: '', keywords: [], cards: [] },
    ],
  })
  useSessionStore.setState({
    status: 'ready',
    session: { sessionId: 's_1', token: 't', expiresAt: '', boothMode: true, nickname: '테스터' },
  })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  vi.spyOn(api, 'startStage').mockResolvedValue({
    stageOrder: 1,
    topicId: 'onyang',
    wavesPerStage: 3,
    quizBatch,
  })
  vi.spyOn(api, 'reportEvent').mockResolvedValue({ accepted: true, activeEvents: [] })
  vi.spyOn(api, 'quizMore').mockResolvedValue({ quizBatch: [] })
  vi.spyOn(api, 'answerQuiz').mockResolvedValue({
    correct: true,
    correctIndex: 1,
    explanation: '해설',
    coins: 40,
    breakdown: { base: 30, comboMult: 1, fastBonus: 10, eventMult: 1 },
    combo: 1,
    comboMax: 1,
    coinsFromQuiz: 40,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderPlay() {
  renderAt(
    '/play/1',
    <Routes>
      <Route path="/play/:stage" element={<PlayPage onReady={(c) => (controller = c)} />} />
      <Route path="/learn/:stage" element={<p>학습 화면</p>} />
      <Route path="/result" element={<p>결과 화면</p>} />
    </Routes>,
  )
  await waitFor(() => expect(controller).not.toBeNull())
  return controller!
}

function tick(c: GameController, seconds: number) {
  act(() => {
    for (let t = 0; t < seconds; t += 0.05) c.tick(0.05)
  })
}

describe('PlayPage — 웨이브 1 클리어 시나리오', () => {
  it('스테이지를 시작하면 HUD 가 보이고, 준비 시간 뒤 웨이브 1 이 시작된다', async () => {
    const c = await renderPlay()
    expect(api.startStage).toHaveBeenCalledWith({ sessionId: 's_1', token: 't' }, 1, false)
    expect(screen.getByLabelText(/코인 100/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '타워디펜스 게임 화면' })).toBeInTheDocument()

    tick(c, 3.2)
    expect(c.state.wave).toBe(1)
    expect(screen.getByText(/웨이브 1\/3/)).toBeInTheDocument()
  })

  it('게임 속도 버튼: 기본 ×2, 누르면 배속이 바뀌고 tick 이 그만큼 빨리 흐른다', async () => {
    const c = await renderPlay()
    expect(screen.getByRole('button', { name: '2배 속도' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '8배 속도' }))
    expect(c.speed).toBe(8)
    tick(c, 0.4) // 실시간 0.4초 × 8 = 준비 시간 3초를 넘긴다
    expect(c.state.wave).toBe(1)
  })

  it('세운 타워를 누르면 업그레이드 옵션이 보이고, 옵션을 사면 코인이 줄고 단계가 오른다', async () => {
    const c = await renderPlay()
    await userEvent.click(screen.getByRole('button', { name: /온천 타워 50코인/ }))
    act(() => {
      c.handleTileClick({ x: 5, y: 5 })
      c.setBuildType(null)
      c.handleTileClick({ x: 5, y: 5 })
    })
    expect(screen.getByRole('region', { name: '타워 업그레이드' })).toHaveTextContent(
      '업그레이드 0/6',
    )
    await userEvent.click(screen.getByRole('button', { name: '위력 업그레이드 30코인' }))
    expect(c.state.coins).toBe(20)
    expect(c.state.towers[0]!.upgrades.power).toBe(1)
    expect(screen.getByRole('region', { name: '타워 업그레이드' })).toHaveTextContent(
      '업그레이드 1/6',
    )
    expect(screen.getByRole('button', { name: '위력 업그레이드 45코인' })).toBeDisabled()
  })

  it('타워를 고르고 타일을 클릭하면 코인이 줄고, 웨이브를 모두 처치하면 WAVE_CLEARED 를 보고한다', async () => {
    const c = await renderPlay()
    await userEvent.click(screen.getByRole('button', { name: /온천 타워 50코인/ }))
    act(() => {
      c.handleTileClick({ x: 5, y: 5 })
    })
    expect(c.state.coins).toBe(50)
    expect(screen.getByLabelText(/코인 50/)).toBeInTheDocument()

    tick(c, 3.2) // 웨이브 1 시작 → 시작 퀴즈로 멈춤
    expect(c.state.pendingQuiz).toBe('normal')
    act(() => {
      c.state.quizMarks = [] // 이 시나리오는 퀴즈 없이 웨이브만 본다
      c.resumeQuiz()
    })
    tick(c, 6) // ×2 배속: 시뮬 12초 → 13마리 모두 스폰(마지막 11.2초)
    expect(c.state.wavePhase).toBe('fighting')
    act(() => {
      for (const e of c.state.enemies) {
        if (!e.alive) continue
        damageEnemy(e, e.hp)
        handleKill(c.state, c.game.ctx, e)
      }
      c.tick(0.05)
    })
    expect(c.state.wavesCleared).toBe(1)
    await waitFor(() =>
      expect(api.reportEvent).toHaveBeenCalledWith(
        { sessionId: 's_1', token: 't' },
        expect.objectContaining({ type: 'WAVE_CLEARED', stageOrder: 1, wave: 1 }),
      ),
    )
    expect(await screen.findByText('웨이브 클리어!')).toBeInTheDocument()
  })

  it('웨이브가 시작되면 바로 퀴즈 모달이 열리고, 답하면 서버 채점 결과와 코인이 반영된다', async () => {
    const c = await renderPlay()
    tick(c, 3.2)
    expect(c.state.paused).toBe(true)
    expect(c.state.enemies).toHaveLength(0) // 문제 푸는 동안 몬스터는 나오지 않는다
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('문제 0')

    const coinsBefore = c.state.coins
    await userEvent.click(screen.getByRole('button', { name: /2\./ }))
    await waitFor(() =>
      expect(api.answerQuiz).toHaveBeenCalledWith(
        { sessionId: 's_1', token: 't' },
        expect.objectContaining({ quizId: 'q_0', choiceIndex: 1, wave: 1 }),
      ),
    )
    await waitFor(() => expect(c.state.coins).toBe(coinsBefore + 40))
    expect(within(dialog).getByRole('status')).toHaveTextContent('정답이에요! +40 코인')
  })

  it('체력이 0 이 되면 실패 오버레이와 STAGE_FAILED 보고', async () => {
    const c = await renderPlay()
    tick(c, 3.2)
    act(() => {
      c.resumeQuiz()
    })
    tick(c, 0.1)
    act(() => {
      c.state.lives = 1
      c.state.enemies[0]!.dist = c.game.ctx.path.totalLength
      c.tick(0.05)
    })
    expect(await screen.findByRole('dialog', { name: '스테이지 실패' })).toBeInTheDocument()
    expect(api.reportEvent).toHaveBeenCalledWith(
      { sessionId: 's_1', token: 't' },
      expect.objectContaining({ type: 'STAGE_FAILED', stageOrder: 1 }),
    )
    expect(useRunStore.getState().history[0]).toMatchObject({ stage: 1, won: false })
  })
})
