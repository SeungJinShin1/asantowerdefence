import { Navigate, Route, Routes } from 'react-router'

import { RequireSession } from '@/app/RequireSession'
import { LearnPage } from '@/pages/LearnPage'
import { NicknamePage } from '@/pages/NicknamePage'
import { PlayPlaceholderPage } from '@/pages/PlayPlaceholderPage'
import { QuizPracticePage } from '@/pages/QuizPracticePage'
import { StageSelectPage } from '@/pages/StageSelectPage'
import { TitlePage } from '@/pages/TitlePage'

const guarded = (element: React.ReactNode) => <RequireSession>{element}</RequireSession>

/** 화면 흐름(docs/02 §1). Play(Phase 3)·Result·Review·Leaderboard(Phase 4~5)는 이후 태스크에서 채운다. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<TitlePage />} />
      <Route path="/nickname" element={<NicknamePage />} />
      <Route path="/stages" element={guarded(<StageSelectPage />)} />
      <Route path="/learn/:stage" element={guarded(<LearnPage />)} />
      <Route path="/play/:stage" element={guarded(<PlayPlaceholderPage />)} />
      <Route path="/practice" element={guarded(<QuizPracticePage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
