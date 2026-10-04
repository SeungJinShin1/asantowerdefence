/**
 * 퀴즈 배치 큐 (docs/02 §6, docs/03 stages/start): kind(normal/emergency/rush)별로 순서대로 꺼내 쓴다.
 * 순수 자료구조 — React·네트워크 의존 없음. 서버에서 받은 quizId 가 같은 문제는 한 번만 넣는다.
 */
import type { QuizItem, QuizKind } from '@/shared/api'

export const QUIZ_KINDS: readonly QuizKind[] = ['normal', 'emergency', 'rush'] as const

/** 이 개수 이하로 남으면 quiz/more 로 미리 채운다 */
export const REFILL_THRESHOLD: Record<QuizKind, number> = { normal: 2, emergency: 1, rush: 1 }
export const REFILL_COUNT: Record<QuizKind, number> = { normal: 5, emergency: 2, rush: 3 }

export type QueueSizes = Record<QuizKind, number>

export class QuizQueue {
  private readonly queues: Record<QuizKind, QuizItem[]> = { normal: [], emergency: [], rush: [] }
  private readonly seen = new Set<string>()

  constructor(batch: readonly QuizItem[] = []) {
    this.enqueue(batch)
  }

  /** 새 문항을 뒤에 붙인다. 이미 본 quizId 는 건너뛴다. 추가된 개수를 돌려준다 */
  enqueue(items: readonly QuizItem[]): number {
    let added = 0
    for (const item of items) {
      if (this.seen.has(item.quizId)) continue
      this.seen.add(item.quizId)
      this.queues[item.kind].push(item)
      added += 1
    }
    return added
  }

  /** kind 의 다음 문항. 없으면 null */
  next(kind: QuizKind): QuizItem | null {
    return this.queues[kind].shift() ?? null
  }

  size(kind: QuizKind): number {
    return this.queues[kind].length
  }

  sizes(): QueueSizes {
    return {
      normal: this.size('normal'),
      emergency: this.size('emergency'),
      rush: this.size('rush'),
    }
  }

  total(): number {
    return QUIZ_KINDS.reduce((sum, kind) => sum + this.size(kind), 0)
  }

  needsRefill(kind: QuizKind): boolean {
    return this.size(kind) <= REFILL_THRESHOLD[kind]
  }

  hasSeen(quizId: string): boolean {
    return this.seen.has(quizId)
  }
}
