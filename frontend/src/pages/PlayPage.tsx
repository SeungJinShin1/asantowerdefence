/**
 * Play 화면 (docs/02 §1·§6·§7·§8): 타워디펜스 + 실시간 퀴즈 팝업 + 서버 이벤트 보고 + 승패 처리.
 * 보안(서버 측 검증): 퀴즈 정답·코인·콤보는 서버 응답으로만 반영한다. 클라이언트 보고(웨이브·보스·실패)는 서버가 상한 검사.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import { BuildMenu } from '@/features/game/components/BuildMenu'
import { EventToast } from '@/features/game/components/EventToast'
import { GameCanvas } from '@/features/game/components/GameCanvas'
import { Hud } from '@/features/game/components/Hud'
import { EVENT_DEFS } from '@/features/game/config/events'
import { type GameController, useHud } from '@/features/game/controller'
import type { EngineEvent, QuizTriggerKind } from '@/features/game/engine/state'
import { useRunStore } from '@/features/game/runStore'
import { type PlaySession, usePlaySession } from '@/features/game/usePlaySession'
import { useToasts } from '@/features/game/useToasts'
import { useTopicsStore } from '@/features/learning/topicsStore'
import { QuizModal } from '@/features/quiz/QuizModal'
import { useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'
import type { AnswerResponse, QuizItem } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

interface QuizPlan {
  kind: QuizTriggerKind
  remaining: number
}

export interface PlayPageProps {
  /** 테스트·디버그용: 컨트롤러가 준비되면 알려 준다 */
  onReady?: (controller: GameController) => void
}

export function PlayPage({ onReady }: PlayPageProps) {
  const navigate = useNavigate()
  const params = useParams()
  const stage = Number(params.stage)
  const session = useSessionStore((s) => s.session)
  const handleApiError = useSessionStore((s) => s.handleApiError)
  const isUnlocked = useProgressStore((s) => s.isUnlocked)
  const learnedStages = useProgressStore((s) => s.learnedStages)
  const markCleared = useProgressStore((s) => s.markCleared)
  const recordStageEnd = useRunStore((s) => s.recordStageEnd)
  const byOrder = useTopicsStore((s) => s.byOrder)
  const loadTopics = useTopicsStore((s) => s.load)
  const { toasts, push } = useToasts()

  const [plan, setPlan] = useState<QuizPlan | null>(null)
  const [quiz, setQuiz] = useState<QuizItem | null>(null)
  const [result, setResult] = useState<AnswerResponse | null>(null)
  const [combo, setCombo] = useState(0)
  const [ended, setEnded] = useState<'won' | 'lost' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // 이벤트 핸들러는 play 보다 먼저 만들어지므로 report 는 ref 로 연결한다
  const reportRef = useRef<PlaySession['report']>(() => {})

  const auth = useMemo(
    () => (session ? { sessionId: session.sessionId, token: session.token } : null),
    [session],
  )
  const topicId = byOrder(stage)?.id ?? ''

  useEffect(() => {
    void loadTopics()
  }, [loadTopics])

  const onError = useCallback(
    (error: unknown) => {
      if (handleApiError(error)) navigate('/', { replace: true })
      else setMessage('서버와 연결이 잠시 끊겼어요. 게임은 계속할 수 있어요.')
    },
    [handleApiError, navigate],
  )

  const onEngineEvent = useCallback(
    (event: EngineEvent, controller: GameController) => {
      switch (event.type) {
        case 'quiz_requested':
          setPlan({ kind: event.kind, remaining: event.count })
          break
        case 'wave_cleared':
          reportRef.current('WAVE_CLEARED', stage, event.wave)
          push({
            title: EVENT_DEFS.WAVE_CLEAR_BONUS.title,
            description: `+${event.bonus} 코인`,
            tone: 'green',
          })
          break
        case 'boss_defeated':
          reportRef.current(
            event.boss === 'mid' ? 'MIDBOSS_DEFEATED' : 'FINALBOSS_DEFEATED',
            stage,
            controller.state.wave,
          )
          break
        case 'game_event':
          if (event.id === 'WAVE_CLEAR_BONUS') break
          push({
            title: EVENT_DEFS[event.id].title,
            description: event.coins ? `+${event.coins} 코인` : EVENT_DEFS[event.id].description,
            tone: event.id === 'EMERGENCY_QUIZ' ? 'red' : 'gold',
          })
          break
        case 'stage_failed':
          reportRef.current('STAGE_FAILED', stage, controller.state.wave)
          recordStageEnd(stageRecord(controller, stage, false))
          setEnded('lost')
          break
        case 'stage_won':
          markCleared(stage)
          recordStageEnd(stageRecord(controller, stage, true))
          setEnded('won')
          break
        default:
          break
      }
    },
    [markCleared, push, recordStageEnd, stage],
  )

  const play = usePlaySession({
    auth,
    stage,
    topicId,
    learnBonus: learnedStages.includes(stage),
    onEngineEvent,
    onError,
  })
  const controller = play.controller
  const takeQuiz = play.takeQuiz
  useEffect(() => {
    reportRef.current = play.report
  }, [play.report])

  useEffect(() => {
    if (controller && onReady) onReady(controller)
  }, [controller, onReady])

  // 퀴즈 계획이 생기면 큐에서 문항을 꺼내 모달을 연다
  useEffect(() => {
    if (!plan || quiz || !controller) return
    let cancelled = false
    takeQuiz(plan.kind, Math.max(controller.state.wave, 1)).then((item) => {
      if (cancelled) return
      if (item) setQuiz(item)
      else {
        setPlan(null)
        controller.resumeQuiz()
      }
    })
    return () => {
      cancelled = true
    }
  }, [controller, plan, quiz, takeQuiz])

  if (!Number.isInteger(stage) || !isUnlocked(stage)) return <Navigate to="/stages" replace />

  const submitQuiz = async (choiceIndex: number, answeredMs: number) => {
    if (!quiz || !controller || !plan) return
    const res = await play.answer(quiz, choiceIndex, answeredMs, Math.max(controller.state.wave, 1))
    if (!res) {
      // 네트워크 실패: 문제 무효 처리(코인 0, 콤보 유지) 후 재개 (docs/02 §6)
      closeQuiz()
      return
    }
    setResult(res)
    setCombo(res.combo)
    controller.applyQuiz({
      kind: plan.kind,
      correct: res.correct,
      coins: res.coins,
      combo: res.combo,
    })
  }

  const closeQuiz = () => {
    setQuiz(null)
    setResult(null)
    setPlan((current) => {
      if (!current) return null
      if (current.remaining > 1) return { ...current, remaining: current.remaining - 1 }
      controller?.resumeQuiz()
      return null
    })
  }

  const retryStage = async () => {
    setEnded(null)
    setCombo(0)
    await play.start(true)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <EventToast toasts={toasts} />
      {controller ? (
        <PlayBoard
          controller={controller}
          stage={stage}
          combo={combo}
          onTileClick={(tile) => {
            const r = controller.handleTileClick(tile)
            if (!r.ok) setMessage(r.reason)
          }}
        />
      ) : (
        <p className="p-8 text-center text-xl">게임을 불러오는 중…</p>
      )}
      {message && (
        <p role="status" className="rounded-2xl bg-amber-100 px-4 py-2 text-amber-900">
          {message}{' '}
          <button type="button" className="underline" onClick={() => setMessage(null)}>
            닫기
          </button>
        </p>
      )}
      {quiz && (
        <QuizModal
          quiz={quiz}
          result={result}
          onSubmit={(c, ms) => void submitQuiz(c, ms)}
          onClose={closeQuiz}
        />
      )}
      {ended && controller && (
        <EndOverlay
          ended={ended}
          stage={stage}
          coins={controller.state.coins}
          lives={controller.state.lives}
          onRetry={() => void retryStage()}
          onNext={() => navigate(`/learn/${stage + 1}`)}
          onResult={() => navigate('/result')}
        />
      )}
    </main>
  )
}

function stageRecord(controller: GameController, stage: number, won: boolean) {
  const s = controller.state
  return {
    stage,
    won,
    wavesCleared: s.wavesCleared,
    livesLeft: s.lives,
    coinsLeft: s.coins,
    kills: s.kills,
  }
}

function PlayBoard({
  controller,
  stage,
  combo,
  onTileClick,
}: {
  controller: GameController
  stage: number
  combo: number
  onTileClick: (tile: { x: number; y: number }) => void
}) {
  const hud = useHud(controller)
  const selectedTower = controller.state.towers.find((t) => t.id === hud.selectedTowerId) ?? null
  return (
    <>
      <Hud
        hud={hud}
        combo={combo}
        stage={stage}
        onSkipPrep={() => controller.skipPrep()}
        onTogglePause={() => controller.togglePause()}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <GameCanvas controller={controller} onTileClick={onTileClick} />
        <BuildMenu
          hud={hud}
          stage={stage}
          selectedTower={selectedTower}
          onPick={(type) => controller.setBuildType(type)}
          onUpgrade={() => controller.upgradeSelected()}
          onSell={() => controller.sellSelected()}
          onDeselect={() => controller.select(null)}
        />
      </div>
    </>
  )
}

function EndOverlay({
  ended,
  stage,
  coins,
  lives,
  onRetry,
  onNext,
  onResult,
}: {
  ended: 'won' | 'lost'
  stage: number
  coins: number
  lives: number
  onRetry: () => void
  onNext: () => void
  onResult: () => void
}) {
  const won = ended === 'won'
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={won ? '스테이지 클리어' : '스테이지 실패'}
        className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl"
      >
        <p className="text-3xl font-black text-amber-700">
          {won ? `${stage}단계 클리어! 🎉` : '성이 무너졌어요…'}
        </p>
        <p className="mt-2 text-lg">
          {won
            ? `남은 코인 ${coins} · 남은 체력 ${lives}`
            : '괜찮아요! 타워를 다시 세우고 도전해 봐요.'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {won && stage < 5 && (
            <Button size="lg" onClick={onNext}>
              다음 스테이지
            </Button>
          )}
          {!won && (
            <Button size="lg" onClick={onRetry}>
              다시 도전
            </Button>
          )}
          <Button variant="secondary" size="lg" onClick={onResult}>
            결과 보기
          </Button>
        </div>
      </div>
    </div>
  )
}
