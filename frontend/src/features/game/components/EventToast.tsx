/** 이벤트 토스트(docs/02 §7 '표시'): 보너스 사건을 2초 정도 보여 준다. */
export interface Toast {
  id: number
  title: string
  description?: string
  tone?: 'gold' | 'red' | 'green' | 'blue'
}

const TONE: Record<NonNullable<Toast['tone']>, string> = {
  gold: 'bg-yellow-300 text-yellow-950',
  red: 'bg-rose-500 text-white',
  green: 'bg-emerald-400 text-emerald-950',
  blue: 'bg-sky-400 text-sky-950',
}

export function EventToast({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-4 z-40 flex -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rounded-2xl px-5 py-2 text-center shadow-lg ${TONE[t.tone ?? 'gold']}`}
        >
          <p className="text-lg font-black">{t.title}</p>
          {t.description && <p className="text-sm">{t.description}</p>}
        </div>
      ))}
    </div>
  )
}
