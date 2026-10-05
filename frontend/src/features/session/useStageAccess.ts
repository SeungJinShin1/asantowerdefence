/**
 * 단계 입장 가능 여부 — 학생은 진행도(이전 단계 클리어)에 따르고, 교사 세션은 모든 단계가 열린다.
 * 교사 여부를 진행도에 저장하지 않고 세션에서 바로 읽는다 → 다음 학생이 새 세션을 시작하면 자동으로 다시 잠긴다.
 * (보안: 여기 값은 화면용이다. 서버는 교사 세션의 기록을 리더보드에서 제외한다.)
 */
import { useCallback } from 'react'

import { STAGE_COUNT, useProgressStore } from './progressStore'
import { useSessionStore } from './sessionStore'

export interface StageAccess {
  isTeacher: boolean
  canEnter: (stage: number) => boolean
}

export function useStageAccess(): StageAccess {
  const isTeacher = useSessionStore((s) => s.session?.teacher === true)
  const isUnlocked = useProgressStore((s) => s.isUnlocked)
  // 진행도가 바뀌면 다시 계산되도록 구독한다
  const clearedCount = useProgressStore((s) => s.clearedStages.length)

  const canEnter = useCallback(
    (stage: number) => {
      void clearedCount
      if (!Number.isInteger(stage) || stage < 1 || stage > STAGE_COUNT) return false
      return isTeacher || isUnlocked(stage)
    },
    [clearedCount, isTeacher, isUnlocked],
  )

  return { isTeacher, canEnter }
}
