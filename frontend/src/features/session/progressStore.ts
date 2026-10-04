/**
 * 스테이지 진행도(해금·클리어) — docs/02 §1·§2. 스테이지 N 클리어 시 N+1 해금.
 * 점수에 영향을 주는 값은 서버가 따로 계산하므로 여기는 화면용이다. 공용 PC 대비 sessionStorage 에만 둔다.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const STAGE_COUNT = 5
export const PROGRESS_STORAGE_KEY = 'defence.progress.v1'

export interface ProgressState {
  clearedStages: number[]
  currentStage: number | null
  /** 학습 보너스를 이미 받은(LEARN_COMPLETED 보고한) 스테이지 */
  learnedStages: number[]
  isUnlocked: (stage: number) => boolean
  isCleared: (stage: number) => boolean
  markCleared: (stage: number) => void
  markLearned: (stage: number) => void
  setCurrentStage: (stage: number | null) => void
  reset: () => void
}

function uniqSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function safeSessionStorage(): Storage {
  try {
    return window.sessionStorage
  } catch {
    // 저장소를 못 쓰는 환경에서는 메모리만 쓰는 더미 저장소
    const memory = new Map<string, string>()
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
      clear: () => memory.clear(),
      key: () => null,
      length: 0,
    } as Storage
  }
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      clearedStages: [],
      currentStage: null,
      learnedStages: [],

      isUnlocked: (stage) =>
        stage >= 1 &&
        stage <= STAGE_COUNT &&
        (stage === 1 || get().clearedStages.includes(stage - 1)),
      isCleared: (stage) => get().clearedStages.includes(stage),
      markCleared: (stage) => set({ clearedStages: uniqSorted([...get().clearedStages, stage]) }),
      markLearned: (stage) => set({ learnedStages: uniqSorted([...get().learnedStages, stage]) }),
      setCurrentStage: (stage) => set({ currentStage: stage }),
      reset: () => set({ clearedStages: [], currentStage: null, learnedStages: [] }),
    }),
    {
      name: PROGRESS_STORAGE_KEY,
      storage: createJSONStorage(safeSessionStorage),
      partialize: (s) => ({
        clearedStages: s.clearedStages,
        currentStage: s.currentStage,
        learnedStages: s.learnedStages,
      }),
    },
  ),
)
