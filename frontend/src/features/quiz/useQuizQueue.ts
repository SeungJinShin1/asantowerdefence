/** 큐 + 서버 보충(quiz/more) 훅. 배치가 바닥나기 전에 미리 채우고, 비어 있으면 즉시 요청한다. */
import { useCallback, useRef, useState } from 'react'

import { api, type QuizItem, type QuizKind, type SessionAuth } from '@/shared/api'

import { QuizQueue, REFILL_COUNT, type QueueSizes } from './quizQueue'

export interface UseQuizQueueResult {
  sizes: QueueSizes
  /** 스테이지 시작 응답의 quizBatch 로 큐를 새로 만든다 */
  load: (batch: QuizItem[]) => void
  /** kind 의 다음 문항. 비어 있으면 서버에서 보충한 뒤 돌려준다(그래도 없으면 null) */
  take: (kind: QuizKind, wave?: number) => Promise<QuizItem | null>
}

const EMPTY: QueueSizes = { normal: 0, emergency: 0, rush: 0 }

export function useQuizQueue(auth: SessionAuth | null, stage: number): UseQuizQueueResult {
  const queueRef = useRef<QuizQueue>(new QuizQueue())
  const [sizes, setSizes] = useState<QueueSizes>(EMPTY)
  const refilling = useRef<Partial<Record<QuizKind, Promise<void>>>>({})

  const refill = useCallback(
    (kind: QuizKind, wave?: number): Promise<void> => {
      if (!auth) return Promise.resolve()
      const inflight = refilling.current[kind]
      if (inflight) return inflight
      const request = api
        .quizMore(auth, { stage, count: REFILL_COUNT[kind], kind, wave })
        .then((res) => {
          queueRef.current.enqueue(res.quizBatch)
          setSizes(queueRef.current.sizes())
        })
        .catch(() => {
          // 보충 실패는 치명적이지 않다 — 다음 take 에서 다시 시도
        })
        .finally(() => {
          delete refilling.current[kind]
        })
      refilling.current[kind] = request
      return request
    },
    [auth, stage],
  )

  const load = useCallback((batch: QuizItem[]) => {
    queueRef.current = new QuizQueue(batch)
    setSizes(queueRef.current.sizes())
  }, [])

  const take = useCallback(
    async (kind: QuizKind, wave?: number) => {
      let item = queueRef.current.next(kind)
      if (!item) {
        await refill(kind, wave)
        item = queueRef.current.next(kind)
      } else if (queueRef.current.needsRefill(kind)) {
        void refill(kind, wave) // 미리 채우기 — 기다리지 않음
      }
      setSizes(queueRef.current.sizes())
      return item
    },
    [refill],
  )

  return { sizes, load, take }
}
