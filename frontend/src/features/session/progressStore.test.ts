import { beforeEach, describe, expect, it } from 'vitest'

import { PROGRESS_STORAGE_KEY, useProgressStore } from './progressStore'

beforeEach(() => {
  useProgressStore.getState().reset()
  window.sessionStorage.clear()
})

describe('progressStore', () => {
  it('처음에는 1단계만 열려 있다', () => {
    const s = useProgressStore.getState()
    expect(s.isUnlocked(1)).toBe(true)
    expect([2, 3, 4, 5].map(s.isUnlocked)).toEqual([false, false, false, false])
    expect(s.isUnlocked(0)).toBe(false)
    expect(s.isUnlocked(6)).toBe(false)
  })

  it('N단계를 클리어하면 N+1 이 열리고 저장된다', () => {
    useProgressStore.getState().markCleared(1)
    useProgressStore.getState().markCleared(1) // 중복 무시
    const s = useProgressStore.getState()
    expect(s.clearedStages).toEqual([1])
    expect(s.isCleared(1)).toBe(true)
    expect(s.isUnlocked(2)).toBe(true)
    expect(s.isUnlocked(3)).toBe(false)
    expect(window.sessionStorage.getItem(PROGRESS_STORAGE_KEY)).toContain('"clearedStages":[1]')
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBeNull()
  })

  it('학습 완료 스테이지·현재 스테이지를 기억하고 reset 으로 비운다', () => {
    const s = useProgressStore.getState()
    s.markLearned(2)
    s.setCurrentStage(2)
    expect(useProgressStore.getState().learnedStages).toEqual([2])
    expect(useProgressStore.getState().currentStage).toBe(2)
    s.reset()
    expect(useProgressStore.getState()).toMatchObject({
      clearedStages: [],
      learnedStages: [],
      currentStage: null,
    })
  })
})
