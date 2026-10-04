/** 학습 카드 넘기기 (docs/02 §1): 마지막 카드까지 읽으면 학습 보너스 +50 코인(감점 없음). */
import { useState } from 'react'

import type { Topic } from '@/shared/api'
import { Button } from '@/shared/ui/Button'
import { ProgressBar } from '@/shared/ui/ProgressBar'

export const LEARN_BONUS_COINS = 50

export interface LearnCardsProps {
  topic: Topic
  /** 이미 보너스를 받은 스테이지면 true (다시 눌러도 중복 지급 없음) */
  completed: boolean
  onComplete: () => void
}

export function LearnCards({ topic, completed, onComplete }: LearnCardsProps) {
  const [index, setIndex] = useState(0)
  const total = topic.cards.length
  const card = topic.cards[index]
  const isLast = index >= total - 1

  if (!card) {
    return <p className="text-center">이 주제에는 아직 학습 카드가 없어요.</p>
  }

  return (
    <section aria-label="학습 카드" className="flex flex-col gap-4">
      <ProgressBar value={index + 1} max={total} label="학습 진행" />
      <article className="min-h-56 rounded-3xl border-2 border-amber-300 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-2xl font-black text-amber-800">{card.title}</h2>
        <p className="text-xl leading-relaxed">{card.body}</p>
      </article>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          ← 이전
        </Button>
        <span className="text-sm text-amber-900/70">
          {index + 1} / {total}
        </span>
        {isLast ? (
          <Button onClick={onComplete} disabled={completed}>
            {completed ? '학습 보너스를 받았어요 ✅' : `학습 완료! +${LEARN_BONUS_COINS} 코인 받기`}
          </Button>
        ) : (
          <Button onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>다음 →</Button>
        )}
      </div>
    </section>
  )
}
