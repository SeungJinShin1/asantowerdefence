/**
 * 백엔드 API 계약 타입 — docs/03_api_contract.md 및 backend/app/routers/schemas.py 와 1:1.
 * 필드 이름·형식이 달라지면 03 문서를 먼저 고치고 양쪽을 맞춘다.
 *
 * 보안: 이 타입들에는 answerIndex / fact / chatbotContext 가 존재하지 않는다 — 서버가 내려주지 않는다.
 */

export type QuizKind = 'normal' | 'emergency' | 'rush'

export type GameEventType =
  'MIDBOSS_DEFEATED' | 'FINALBOSS_DEFEATED' | 'WAVE_CLEARED' | 'STAGE_FAILED' | 'LEARN_COMPLETED'

/** 서버 오류 코드(03 공통) + 클라이언트가 만드는 코드(NETWORK_ERROR, TIMEOUT) */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SCORE_REJECTED'
  | 'NICKNAME_REJECTED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'

export interface ApiErrorBody {
  error: { code: string; message: string }
}

// ---------- GET /healthz ----------

export interface HealthResponse {
  status: string
  version: string
  variantsReady: boolean
}

// ---------- GET /topics ----------

export interface Card {
  id: string
  title: string
  body: string
}

export interface Topic {
  id: string
  order: number
  title: string
  subtitle: string
  era: string
  keywords: string[]
  cards: Card[]
}

// ---------- POST /sessions ----------

export interface CreateSessionRequest {
  nickname?: string | null
}

export interface CreateSessionResponse {
  sessionId: string
  token: string
  expiresAt: string
  boothMode: boolean
  /** 교사 모드 세션이면 true (화면 표시용 — 권한은 서버 세션이 판단) */
  teacher?: boolean
}

// ---------- stages/{n}/start · quiz/more ----------

export interface StageStartRequest {
  retry: boolean
}

export interface QuizItem {
  quizId: string
  difficulty: number
  kind: QuizKind
  stem: string
  options: string[]
  timeLimitSec: number
}

export interface StageStartResponse {
  stageOrder: number
  topicId: string
  wavesPerStage: number
  quizBatch: QuizItem[]
}

export interface QuizMoreParams {
  stage: number
  count?: number
  kind?: QuizKind
  wave?: number
}

export interface QuizMoreResponse {
  quizBatch: QuizItem[]
}

// ---------- quiz/answer ----------

export interface AnswerRequest {
  quizId: string
  /** -1 = 시간 초과 */
  choiceIndex: number
  answeredMs: number
  wave: number
}

export interface CoinBreakdown {
  base: number
  comboMult: number
  fastBonus: number
  eventMult: number
}

export interface AnswerResponse {
  correct: boolean
  correctIndex: number
  explanation: string
  coins: number
  breakdown: CoinBreakdown
  combo: number
  comboMax: number
  coinsFromQuiz: number
}

// ---------- events ----------

export interface GameEventRequest {
  type: GameEventType
  stageOrder: number
  wave: number
  /** ISO 8601 UTC */
  at: string
}

export interface ActiveEvent {
  type: string
  until: string
}

export interface GameEventResponse {
  accepted: boolean
  activeEvents: ActiveEvent[]
}

// ---------- finish ----------

export interface FinishRequest {
  stagesCleared: number
  wavesCleared: number
  livesLeftAtEnd: number
  coinsLeftAtEnd: number
  clientScore: number
}

export interface ScoreBreakdown {
  correct: number
  combo: number
  waves: number
  stages: number
  lives: number
  coins: number
}

export interface FinishResponse {
  score: number
  breakdown: ScoreBreakdown
  correctCount: number
  answeredCount: number
  comboMax: number
  stageReached: number
  wrongQuizIds: string[]
}

// ---------- Phase 4·5 (계약만 미리) ----------

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  topicId: string
  messages: ChatMessage[]
}

export interface ChatResponse {
  reply: string
  suggested: string[]
}

export interface ReviewItem {
  quizId: string
  stem: string
  yourAnswer: string
  correctAnswer: string
  explanation: string
  aiNote: string
  retryOptions: string[]
  retryCorrectIndex: number
}

export interface ReviewResponse {
  items: ReviewItem[]
  summary: string
}

export interface LeaderboardEntry {
  rank: number
  nickname: string
  score: number
  stageReached: number
  createdAt: string
}

export interface RegisterLeaderboardResponse {
  rank: number
  score: number
  nickname: string
}
