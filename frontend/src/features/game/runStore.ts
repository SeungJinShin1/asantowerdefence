/**
 * 한 판(run) 누적 기록 — finish 보고값(docs/03 POST /finish)의 재료. 점수는 서버가 계산하므로 여기 값은 보고용이다.
 * 공용 PC 대비 sessionStorage 에만 둔다.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { FinishResponse } from '@/shared/api'

export const RUN_STORAGE_KEY = 'defence.run.v1'

export interface StageEndRecord {
  stage: number
  won: boolean
  wavesCleared: number
  livesLeft: number
  coinsLeft: number
  kills: number
}

export interface RunState {
  stagesCleared: number
  wavesCleared: number
  livesLeftAtEnd: number
  coinsLeftAtEnd: number
  killsTotal: number
  lastStage: number | null
  history: StageEndRecord[]
  finish: FinishResponse | null
  recordStageEnd: (record: StageEndRecord) => void
  setFinish: (result: FinishResponse) => void
  reset: () => void
}

const EMPTY = {
  stagesCleared: 0,
  wavesCleared: 0,
  livesLeftAtEnd: 10,
  coinsLeftAtEnd: 0,
  killsTotal: 0,
  lastStage: null,
  history: [] as StageEndRecord[],
  finish: null,
}

export const useRunStore = create<RunState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      recordStageEnd: (record) => {
        // 같은 스테이지 재도전은 마지막 시도만 집계에 남긴다(실패한 시도의 웨이브는 서버 상한 검증과 어긋날 수 있음)
        const history = [...get().history.filter((h) => h.stage !== record.stage), record]
        set({
          history,
          stagesCleared: history.filter((h) => h.won).length,
          wavesCleared: history.reduce((n, h) => n + h.wavesCleared, 0),
          livesLeftAtEnd: record.livesLeft,
          coinsLeftAtEnd: record.coinsLeft,
          killsTotal: history.reduce((n, h) => n + h.kills, 0),
          lastStage: record.stage,
        })
      },
      setFinish: (finish) => set({ finish }),
      reset: () => set({ ...EMPTY, history: [] }),
    }),
    { name: RUN_STORAGE_KEY, storage: createJSONStorage(() => window.sessionStorage) },
  ),
)
