/** Phase 3(타워디펜스 엔진) 전까지의 Play 자리. 퀴즈 흐름은 연습 페이지로 체험할 수 있다. */
import { Link, useParams } from 'react-router'

export function PlayPlaceholderPage() {
  const { stage } = useParams()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-black text-amber-700">{stage}단계 타워디펜스</h1>
      <p className="max-w-md text-lg">
        게임 화면은 다음 단계(Phase 3)에서 열려요. 지금은 퀴즈 출제·채점 흐름을 먼저 체험할 수
        있어요.
      </p>
      <div className="flex gap-3">
        <Link
          to={`/practice?stage=${stage ?? 1}`}
          className="rounded-2xl bg-amber-500 px-8 py-3 text-xl font-bold text-white shadow"
        >
          퀴즈 연습으로 체험하기
        </Link>
        <Link
          to="/stages"
          className="rounded-2xl px-6 py-3 text-lg font-bold text-amber-800 underline"
        >
          스테이지 선택
        </Link>
      </div>
    </main>
  )
}
