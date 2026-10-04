/**
 * Play 화면의 서버 연동 묶음: 스테이지 시작(배치 수신) → 컨트롤러 생성, 이벤트 보고, 채점.
 * 보안(서버 측 검증): 코인·콤보는 서버 응답을 그대로 쓰고, 이벤트는 서버가 상한을 검사한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useQuizQueue } from '@/features/quiz/useQuizQueue'
import {
  ApiError,
  api,
  type AnswerResponse,
  type GameEventType,
  type QuizItem,
  type SessionAuth,
  type StageStartResponse,
} from '@/shared/api'

import { type ControllerHooks, GameController } from './controller'
import type { EngineEvent } from './engine/state'

export interface PlaySessionOptions {
  auth: SessionAuth | null
  stage: number
  topicId: string
  learnBonus: boolean
  onEngineEvent: (event: EngineEvent, controller: GameController) => void
  onError: (error: unknown) => void
}

export interface PlaySession {
  controller: GameController | null
  wavesPerStage: number | null
  /** 재도전 등 사용자 요청으로 스테이지를 다시 시작한다 */
  start: (retry: boolean) => Promise<void>
  takeQuiz: (kind: QuizItem['kind'], wave?: number) => Promise<QuizItem | null>
  answer: (
    quiz: QuizItem,
    choiceIndex: number,
    answeredMs: number,
    wave: number,
  ) => Promise<AnswerResponse | null>
  report: (type: GameEventType, stageOrder: number, wave: number) => void
}

export function usePlaySession(options: PlaySessionOptions): PlaySession {
  const { auth, stage, topicId, learnBonus, onEngineEvent, onError } = options
  const [controller, setController] = useState<GameController | null>(null)
  const [wavesPerStage, setWavesPerStage] = useState<number | null>(null)
  const queue = useQuizQueue(auth, stage)
  const loadQueue = queue.load
  const takeQuiz = queue.take

  // 최신 이벤트 핸들러를 ref 로 들고 있어 컨트롤러를 다시 만들지 않아도 된다
  const eventHandler = useRef(onEngineEvent)
  useEffect(() => {
    eventHandler.current = onEngineEvent
  }, [onEngineEvent])

  const applyStart = useCallback(
    (res: StageStartResponse) => {
      const hooks: ControllerHooks = {
        onEvent: (event) => eventHandler.current(event, next),
      }
      const next = new GameController(
        { stage, topicId: res.topicId || topicId, wavesPerStage: res.wavesPerStage, learnBonus },
        hooks,
      )
      loadQueue(res.quizBatch)
      setWavesPerStage(res.wavesPerStage)
      setController(next)
    },
    [learnBonus, loadQueue, stage, topicId],
  )

  // 처음 들어오면 시작(언마운트·세션 변경 뒤 도착한 응답은 버린다)
  useEffect(() => {
    if (!auth) return
    let cancelled = false
    api
      .startStage(auth, stage, false)
      .then((res) => {
        if (!cancelled) applyStart(res)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error)
      })
    return () => {
      cancelled = true
    }
  }, [auth, stage, applyStart, onError])

  const start = useCallback(
    async (retry: boolean) => {
      if (!auth) return
      try {
        applyStart(await api.startStage(auth, stage, retry))
      } catch (error) {
        onError(error)
      }
    },
    [applyStart, auth, onError, stage],
  )

  const answer = useCallback(
    async (quiz: QuizItem, choiceIndex: number, answeredMs: number, wave: number) => {
      if (!auth) return null
      try {
        return await api.answerQuiz(auth, { quizId: quiz.quizId, choiceIndex, answeredMs, wave })
      } catch (error) {
        onError(error)
        return null
      }
    },
    [auth, onError],
  )

  const report = useCallback(
    (type: GameEventType, stageOrder: number, wave: number) => {
      if (!auth) return
      api
        .reportEvent(auth, { type, stageOrder, wave, at: new Date().toISOString() })
        .catch((error: unknown) => {
          // 세션 만료만 화면에 알리고, 그 밖의 보고 실패는 게임을 막지 않는다(서버가 상한으로 보호)
          if (error instanceof ApiError && error.isSessionExpired) onError(error)
        })
    },
    [auth, onError],
  )

  return useMemo(
    () => ({ controller, wavesPerStage, start, takeQuiz, answer, report }),
    [answer, controller, report, start, takeQuiz, wavesPerStage],
  )
}
