/**
 * AI 선생님 챗봇 패널 — 백엔드 POST /chat (docs/03). 보안: chatbotContext 는 서버에만 있고 프론트는
 * 질문·답변 텍스트만 다룬다. 최근 6턴만 보내며, 세션 토큰은 api 가 헤더로만 전달한다.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError, api, type ChatMessage, type SessionAuth, type Topic } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export const MAX_TURNS = 6
export const MAX_QUESTION_CHARS = 500

export interface ChatPanelProps {
  topic: Topic
  auth: SessionAuth | null
}

function initialSuggestions(topic: Topic): string[] {
  return topic.keywords.slice(0, 3).map((kw) => `${kw}이(가) 뭐예요?`)
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'AI_UNAVAILABLE')
      return 'AI 선생님이 잠시 쉬고 있어요. 조금 뒤에 다시 물어봐 주세요.'
    return error.message
  }
  return '잠시 문제가 생겼어요. 다시 시도해 주세요.'
}

export function ChatPanel({ topic, auth }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [suggested, setSuggested] = useState<string[]>(() => initialSuggestions(topic))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    // jsdom 등 scrollTo 가 없는 환경 대비
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight })
  }, [messages, loading])

  const send = async (raw: string) => {
    const content = raw.trim().slice(0, MAX_QUESTION_CHARS)
    if (!auth || loading || !content) return
    const next: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setError(null)
    setLoading(true)
    try {
      const res = await api.chat(auth, { topicId: topic.id, messages: next.slice(-MAX_TURNS) })
      setMessages([...next, { role: 'assistant', content: res.reply }])
      if (res.suggested.length > 0) setSuggested(res.suggested)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void send(input)
  }

  return (
    <aside
      aria-label="AI 선생님"
      className="flex flex-col gap-3 rounded-3xl border-2 border-sky-200 bg-sky-50 p-4"
    >
      <h2 className="text-xl font-black text-sky-800">AI 선생님에게 물어보기</h2>
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        className="flex max-h-72 min-h-32 flex-col gap-2 overflow-y-auto rounded-2xl bg-white p-3 text-base"
      >
        <p className="rounded-2xl bg-sky-100 px-3 py-2 text-sky-900">
          안녕! 나는 {topic.title} 이야기를 잘 아는 AI 선생님이에요. 카드 속 내용을 바탕으로 쉽게
          설명해 줄게요.
        </p>
        {messages.map((m, i) => (
          <p
            key={`${i}-${m.role}`}
            className={
              m.role === 'user'
                ? 'self-end rounded-2xl bg-amber-100 px-3 py-2 text-amber-950'
                : 'rounded-2xl bg-sky-100 px-3 py-2 text-sky-900'
            }
          >
            {m.content}
          </p>
        ))}
        {loading && <p className="text-sky-700">AI 선생님이 생각하는 중…</p>}
        {error && (
          <p role="alert" className="text-rose-600">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {suggested.map((text) => (
          <button
            key={text}
            type="button"
            disabled={!auth || loading}
            onClick={() => void send(text)}
            className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <input
          aria-label="질문 입력"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          disabled={!auth || loading}
          placeholder={auth ? '궁금한 걸 물어보세요' : '게임을 시작하면 물어볼 수 있어요'}
          className="flex-1 rounded-2xl border-2 border-sky-200 bg-white px-3 py-2 disabled:bg-stone-100"
        />
        <Button type="submit" variant="secondary" disabled={!auth || loading || !input.trim()}>
          보내기
        </Button>
      </form>
    </aside>
  )
}
