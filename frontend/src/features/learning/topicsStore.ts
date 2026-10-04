/** 주제(학습 카드·메타) 캐시. GET /topics 는 세션 동안 한 번만 부른다. chatbotContext 는 서버가 내려주지 않는다. */
import { create } from 'zustand'

import { api as defaultApi, type Api, type Topic } from '@/shared/api'

export type TopicsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TopicsState {
  topics: Topic[]
  status: TopicsStatus
  load: () => Promise<void>
  byOrder: (order: number) => Topic | undefined
}

export function createTopicsStore(apiImpl: Pick<Api, 'getTopics'>) {
  let inflight: Promise<void> | null = null
  return create<TopicsState>()((set, get) => ({
    topics: [],
    status: 'idle',

    load() {
      if (get().status === 'ready') return Promise.resolve()
      if (inflight) return inflight
      set({ status: 'loading' })
      inflight = apiImpl
        .getTopics()
        .then((topics) => {
          set({ topics: [...topics].sort((a, b) => a.order - b.order), status: 'ready' })
        })
        .catch(() => {
          set({ status: 'error' })
        })
        .finally(() => {
          inflight = null
        })
      return inflight
    },

    byOrder: (order) => get().topics.find((t) => t.order === order),
  }))
}

export const useTopicsStore = createTopicsStore(defaultApi)
