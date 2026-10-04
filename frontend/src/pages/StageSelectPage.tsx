/** 스테이지 선택 (docs/02 §1·§2): 1단계만 열려 있고, 클리어할 때마다 다음 단계가 해금된다. */
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

import { useTopicsStore } from '@/features/learning/topicsStore'
import { STAGE_COUNT, useProgressStore } from '@/features/session/progressStore'
import { useSessionStore } from '@/features/session/sessionStore'

const TOWER_LABEL: Record<number, string> = {
  1: '온천 타워',
  2: '피리 타워',
  3: '거북선 타워',
  4: '종탑 타워',
  5: '만세 망루',
}

export function StageSelectPage() {
  const navigate = useNavigate()
  const { topics, status, load } = useTopicsStore()
  const isUnlocked = useProgressStore((s) => s.isUnlocked)
  const isCleared = useProgressStore((s) => s.isCleared)
  const clearedStages = useProgressStore((s) => s.clearedStages)
  const setCurrentStage = useProgressStore((s) => s.setCurrentStage)
  const nickname = useSessionStore((s) => s.session?.nickname)

  useEffect(() => {
    void load()
  }, [load])

  const select = (stage: number) => {
    if (!isUnlocked(stage)) return
    setCurrentStage(stage)
    navigate(`/learn/${stage}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-black text-amber-700">스테이지 선택</h1>
        <p className="text-amber-900/80">
          {nickname ? `${nickname} 님, ` : ''}
          클리어한 스테이지: {clearedStages.length} / {STAGE_COUNT}
        </p>
      </header>

      {status === 'loading' && <p className="text-center">주제를 불러오는 중…</p>}
      {status === 'error' && (
        <p role="alert" className="text-center text-rose-600">
          주제를 불러오지 못했어요.{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            다시 시도
          </button>
        </p>
      )}

      <ol className="grid gap-4 sm:grid-cols-2">
        {topics.map((topic) => {
          const unlocked = isUnlocked(topic.order)
          const cleared = isCleared(topic.order)
          return (
            <li key={topic.id}>
              <button
                type="button"
                onClick={() => select(topic.order)}
                disabled={!unlocked}
                aria-disabled={!unlocked}
                aria-label={`${topic.order}단계 ${topic.title}${unlocked ? '' : ' (잠김)'}`}
                className={`flex w-full flex-col items-start gap-1 rounded-2xl border-2 p-4 text-left transition ${
                  unlocked
                    ? 'border-amber-400 bg-white hover:bg-amber-50'
                    : 'cursor-not-allowed border-stone-300 bg-stone-100 text-stone-500'
                }`}
              >
                <span className="text-sm font-semibold">
                  {topic.order}단계 · {topic.era}
                  {cleared && ' · ✅ 클리어'}
                  {!unlocked && ' · 🔒 잠김'}
                </span>
                <span className="text-2xl font-black">{topic.title}</span>
                <span className="text-base">{topic.subtitle}</span>
                <span className="text-sm text-amber-800">
                  해금 타워: {TOWER_LABEL[topic.order] ?? '-'}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </main>
  )
}
