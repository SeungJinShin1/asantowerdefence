/** 엔드포인트 함수 — 경로·메서드·본문은 docs/03 과 1:1. 화면은 이 함수들만 호출한다. */
import { type ApiClient, createApiClient, healthUrl, resolveBaseUrl } from './client'
import type {
  AnswerRequest,
  AnswerResponse,
  ChatRequest,
  ChatResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  FinishRequest,
  FinishResponse,
  GameEventRequest,
  GameEventResponse,
  HealthResponse,
  QuizMoreParams,
  LeaderboardEntry,
  QuizMoreResponse,
  RegisterLeaderboardResponse,
  ReviewResponse,
  StageStartResponse,
  Topic,
} from './types'

export interface SessionAuth {
  sessionId: string
  token: string
}

export function createApi(client: ApiClient) {
  const sessionPath = (auth: SessionAuth, suffix: string) =>
    `/sessions/${encodeURIComponent(auth.sessionId)}${suffix}`

  return {
    /** 서버 깨우기용. 베이스 URL 밖(`/healthz`)에 있다. 짧은 타임아웃·재시도 없음 — 호출자가 폴링한다 */
    healthz: (timeoutMs = 4_000) =>
      client.request<HealthResponse>(healthUrl(client.baseUrl), { timeoutMs, retry: false }),

    getTopics: () => client.request<Topic[]>('/topics'),

    createSession: (nickname?: string | null) =>
      client.request<CreateSessionResponse>('/sessions', {
        method: 'POST',
        body: { nickname: nickname ?? null } satisfies CreateSessionRequest,
      }),

    startStage: (auth: SessionAuth, stageOrder: number, retry = false) =>
      client.request<StageStartResponse>(sessionPath(auth, `/stages/${stageOrder}/start`), {
        method: 'POST',
        body: { retry },
        token: auth.token,
      }),

    quizMore: (auth: SessionAuth, params: QuizMoreParams) =>
      client.request<QuizMoreResponse>(sessionPath(auth, '/quiz/more'), {
        token: auth.token,
        query: { stage: params.stage, count: params.count, kind: params.kind, wave: params.wave },
      }),

    answerQuiz: (auth: SessionAuth, body: AnswerRequest) =>
      client.request<AnswerResponse>(sessionPath(auth, '/quiz/answer'), {
        method: 'POST',
        body,
        token: auth.token,
      }),

    reportEvent: (auth: SessionAuth, body: GameEventRequest) =>
      client.request<GameEventResponse>(sessionPath(auth, '/events'), {
        method: 'POST',
        body,
        token: auth.token,
      }),

    finishSession: (auth: SessionAuth, body: FinishRequest) =>
      client.request<FinishResponse>(sessionPath(auth, '/finish'), {
        method: 'POST',
        body,
        token: auth.token,
      }),

    /** 학습 챗봇 — 경로에 세션 id 가 없고 토큰으로만 인증한다 */
    chat: (auth: SessionAuth, body: ChatRequest) =>
      client.request<ChatResponse>('/chat', { method: 'POST', body, token: auth.token }),

    /** 리더보드 등록 — finished 세션만, 세션당 1회 */
    registerLeaderboard: (auth: SessionAuth, nickname: string) =>
      client.request<RegisterLeaderboardResponse>('/leaderboard', {
        method: 'POST',
        body: { nickname },
        token: auth.token,
      }),

    /** 상위 기록(공개) */
    getLeaderboard: (limit = 20) =>
      client.request<LeaderboardEntry[]>('/leaderboard', { query: { limit } }),

    /** 오답 정리 — finished 세션만. Gemini 응답이 느릴 수 있어 타임아웃을 넉넉히 */
    review: (auth: SessionAuth) =>
      client.request<ReviewResponse>(sessionPath(auth, '/review'), {
        method: 'POST',
        body: {},
        token: auth.token,
        timeoutMs: 20_000,
      }),
  }
}

export type Api = ReturnType<typeof createApi>

/** 앱 전역에서 쓰는 기본 인스턴스 */
export const api: Api = createApi(createApiClient({ baseUrl: resolveBaseUrl() }))
