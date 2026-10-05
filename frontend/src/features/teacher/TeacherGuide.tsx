/**
 * 교사용 안내 — 교사 모드에서만 보이는 "이 게임은 이렇게 동작해요" 패널과 배지.
 * 부스에 들른 선생님이 원리를 한눈에 이해하도록 화면 흐름 순서대로 적는다. 정적인 설명만 있고 비밀값은 없다.
 */

export function TeacherBadge() {
  return (
    <span className="inline-block rounded-full bg-indigo-600 px-3 py-1 text-sm font-black text-white">
      👩‍🏫 교사 모드
    </span>
  )
}

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: '① 배우기',
    body: '단계마다 학습 카드를 읽고 AI 선생님(Gemini)에게 질문합니다. AI는 그 단계의 카드 내용 안에서만 답하도록 제한되어 있어요.',
  },
  {
    title: '② 문제',
    body: '원본은 교사가 검수한 75문항입니다. AI는 정답의 근거가 되는 사실은 그대로 두고 문장과 오답 보기만 바꾼 변형 문제를 미리 만들어 둡니다. 그래서 답 번호를 외워서는 맞히기 어렵습니다.',
  },
  {
    title: '③ 채점과 코인',
    body: '정답과 채점은 서버에만 있습니다. 맞히면 코인을 받고 연속 정답이면 2~3배가 됩니다. 틀려도 감점은 없어요.',
  },
  {
    title: '④ 타워디펜스',
    body: '코인으로 타워를 세우고 업그레이드해 성을 지킵니다. 문제는 몬스터가 나오는 수에 맞춰 나오고, 단계를 깰 때마다 새 타워가 열립니다.',
  },
  {
    title: '⑤ 오답 정리',
    body: '게임이 끝나면 틀린 문제를 AI가 한꺼번에 풀이해 줍니다. 다시 도전하거나 닉네임과 점수를 기록할 수 있어요.',
  },
  {
    title: '개인정보',
    body: '닉네임과 점수만 저장합니다. 이름·학교·연락처는 묻지도 저장하지도 않습니다.',
  },
]

export function TeacherGuide() {
  return (
    <details
      open
      className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4 text-indigo-950"
    >
      <summary className="cursor-pointer text-lg font-black">
        이 게임은 이렇게 동작해요 (선생님용 안내)
      </summary>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => (
          <li key={step.title} className="rounded-xl bg-white/80 p-3">
            <p className="font-bold">{step.title}</p>
            <p className="text-sm">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm">
        교사 모드에서는 모든 단계가 열려 있고, 플레이 화면 오른쪽의 검수 도구로 코인을 받거나
        웨이브를 건너뛸 수 있습니다. 이 기록은 순위에 올라가지 않습니다.
      </p>
    </details>
  )
}
