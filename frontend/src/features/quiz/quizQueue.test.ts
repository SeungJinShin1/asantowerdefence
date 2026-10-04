import { describe, expect, it } from 'vitest'

import type { QuizItem, QuizKind } from '@/shared/api'

import { QuizQueue, REFILL_THRESHOLD } from './quizQueue'

function item(id: string, kind: QuizKind = 'normal'): QuizItem {
  return {
    quizId: id,
    difficulty: 1,
    kind,
    stem: id,
    options: ['a', 'b', 'c', 'd'],
    timeLimitSec: 15,
  }
}

describe('QuizQueue', () => {
  it('kind 별로 들어온 순서대로 꺼낸다', () => {
    const q = new QuizQueue([item('n1'), item('e1', 'emergency'), item('n2'), item('r1', 'rush')])
    expect(q.sizes()).toEqual({ normal: 2, emergency: 1, rush: 1 })
    expect(q.next('normal')?.quizId).toBe('n1')
    expect(q.next('normal')?.quizId).toBe('n2')
    expect(q.next('normal')).toBeNull()
    expect(q.next('emergency')?.quizId).toBe('e1')
    expect(q.next('rush')?.quizId).toBe('r1')
    expect(q.total()).toBe(0)
  })

  it('같은 quizId 는 한 번만 넣는다 (꺼낸 뒤에도 다시 들어오지 않음)', () => {
    const q = new QuizQueue([item('n1')])
    expect(q.enqueue([item('n1'), item('n2')])).toBe(1)
    q.next('normal')
    expect(q.enqueue([item('n1')])).toBe(0)
    expect(q.hasSeen('n1')).toBe(true)
    expect(q.size('normal')).toBe(1)
  })

  it('needsRefill 은 종류별 문턱값 이하일 때 true', () => {
    const q = new QuizQueue([item('n1'), item('n2'), item('n3'), item('e1', 'emergency')])
    expect(REFILL_THRESHOLD.normal).toBe(2)
    expect(q.needsRefill('normal')).toBe(false)
    q.next('normal')
    expect(q.needsRefill('normal')).toBe(true)
    expect(q.needsRefill('emergency')).toBe(true)
    expect(q.needsRefill('rush')).toBe(true)
  })
})
