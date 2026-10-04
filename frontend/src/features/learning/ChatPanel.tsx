/**
 * AI 선생님 챗봇 패널 UI. 백엔드 POST /chat 연결은 Phase 4 — 지금은 안내 문구와 비활성 입력만 보여 준다.
 * 보안: chatbotContext(근거 자료)는 서버에만 있고 프론트는 질문·답변 텍스트만 다룬다.
 */
import type { Topic } from '@/shared/api'
import { Button } from '@/shared/ui/Button'

export function ChatPanel({ topic }: { topic: Topic }) {
  return (
    <aside
      aria-label="AI 선생님"
      className="flex flex-col gap-3 rounded-3xl border-2 border-sky-200 bg-sky-50 p-4"
    >
      <h2 className="text-xl font-black text-sky-800">AI 선생님에게 물어보기</h2>
      <div className="min-h-32 rounded-2xl bg-white p-3 text-base">
        <p className="font-semibold">안녕! 나는 {topic.title} 이야기를 잘 아는 AI 선생님이야.</p>
        <p className="mt-2 text-sky-900/80">
          궁금한 걸 물어보면 카드 속 내용을 바탕으로 쉽게 설명해 줄게. (곧 열려요!)
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {topic.keywords.slice(0, 4).map((keyword) => (
          <span
            key={keyword}
            className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-sky-800"
          >
            #{keyword}
          </span>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <input
          aria-label="질문 입력"
          disabled
          placeholder="AI 선생님은 곧 연결돼요"
          className="flex-1 rounded-2xl border-2 border-sky-200 bg-white px-3 py-2 disabled:bg-stone-100"
        />
        <Button type="submit" variant="secondary" disabled>
          보내기
        </Button>
      </form>
    </aside>
  )
}
