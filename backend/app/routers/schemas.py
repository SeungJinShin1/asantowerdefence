"""API 요청/응답 스키마 — docs/03_api_contract.md와 1:1 (camelCase 직렬화).

보안(정답·ENV 노출 방지): 응답 스키마에는 answerIndex / fact / chatbotContext / correctIndex(출제 시점)가
존재하지 않는다. 정답 위치는 채점 응답(AnswerResponse.correctIndex)에서, 답변한 뒤에만 내려간다.
계약과 코드가 달라지면 03 문서를 먼저 고치고 여기와 프론트 types.ts를 맞춘다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.domain.models import CamelModel, EventType, QuizKind


class AiStatus(CamelModel):
    """AI 연결 진단(공개 /healthz 용). 키·프롬프트·응답 원문은 절대 포함하지 않는다."""

    configured: bool
    api_key_set: bool = False
    model: str = ""
    last_error: str | None = None
    ok_calls: int = 0


class HealthResponse(CamelModel):
    status: str = "ok"
    version: str
    variants_ready: bool
    ai: AiStatus


class ErrorBody(CamelModel):
    code: str
    message: str


class ErrorResponse(CamelModel):
    error: ErrorBody


# ---------- GET /topics ----------


class CardOut(CamelModel):
    id: str
    title: str
    body: str


class TopicOut(CamelModel):
    id: str
    order: int
    title: str
    subtitle: str = ""
    era: str = ""
    keywords: list[str] = Field(default_factory=list)
    cards: list[CardOut] = Field(default_factory=list)


# ---------- POST /sessions ----------


class CreateSessionRequest(CamelModel):
    nickname: str | None = Field(default=None, max_length=20)


class CreateSessionResponse(CamelModel):
    session_id: str
    token: str
    expires_at: datetime
    booth_mode: bool


# ---------- POST /sessions/{id}/stages/{n}/start · GET quiz/more ----------


class StageStartRequest(CamelModel):
    retry: bool = False


class QuizItem(CamelModel):
    quiz_id: str
    difficulty: int
    kind: QuizKind
    stem: str
    options: list[str]
    time_limit_sec: int


class StageStartResponse(CamelModel):
    stage_order: int
    topic_id: str
    waves_per_stage: int
    quiz_batch: list[QuizItem]


class QuizMoreResponse(CamelModel):
    quiz_batch: list[QuizItem]


# ---------- POST /sessions/{id}/quiz/answer ----------


class AnswerRequest(CamelModel):
    quiz_id: str
    choice_index: int = Field(ge=-1, le=3)  # -1 = 시간 초과
    answered_ms: int = Field(ge=0, le=60_000)
    wave: int = Field(ge=1)


class CoinBreakdown(CamelModel):
    base: int
    combo_mult: int
    fast_bonus: int
    event_mult: int


class AnswerResponse(CamelModel):
    correct: bool
    correct_index: int
    explanation: str
    coins: int
    breakdown: CoinBreakdown
    combo: int
    combo_max: int
    coins_from_quiz: int


# ---------- POST /sessions/{id}/events ----------


class EventRequest(CamelModel):
    type: EventType
    stage_order: int = Field(ge=1)
    wave: int = Field(ge=0)  # LEARN_COMPLETED 등 웨이브와 무관한 이벤트는 0
    at: datetime


class ActiveEvent(CamelModel):
    type: str
    until: datetime


class EventResponse(CamelModel):
    accepted: bool
    active_events: list[ActiveEvent]


# ---------- POST /sessions/{id}/finish ----------


class FinishRequest(CamelModel):
    stages_cleared: int = Field(ge=0)
    waves_cleared: int = Field(ge=0)
    lives_left_at_end: int = Field(ge=0)
    coins_left_at_end: int = Field(ge=0)
    client_score: int = Field(ge=0)


class ScoreBreakdownOut(CamelModel):
    correct: int
    combo: int
    waves: int
    stages: int
    lives: int
    coins: int


class FinishResponse(CamelModel):
    score: int
    breakdown: ScoreBreakdownOut
    correct_count: int
    answered_count: int
    combo_max: int
    stage_reached: int
    wrong_quiz_ids: list[str]


# ---------- POST /chat ----------


class ChatMessage(CamelModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)


class ChatRequest(CamelModel):
    topic_id: str
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class ChatResponse(CamelModel):
    reply: str
    suggested: list[str]


# ---------- POST /sessions/{id}/review ----------


class ReviewItem(CamelModel):
    quiz_id: str
    stem: str
    your_answer: str
    correct_answer: str
    explanation: str
    ai_note: str
    retry_options: list[str]
    retry_correct_index: int


class ReviewResponse(CamelModel):
    items: list[ReviewItem]
    summary: str


# ---------- leaderboard ----------


class RegisterLeaderboardRequest(CamelModel):
    nickname: str = Field(min_length=1, max_length=20)


class RegisterLeaderboardResponse(CamelModel):
    rank: int
    score: int
    nickname: str


class LeaderboardRow(CamelModel):
    rank: int
    nickname: str
    score: int
    stage_reached: int
    created_at: datetime


# ---------- admin ----------


class QueuedResponse(CamelModel):
    queued: bool = True


class LeaderboardResetResponse(CamelModel):
    removed: int


class VariantStatusResponse(CamelModel):
    total: int
    with_variants: int
    per_topic: dict[str, int]
    last_built_at: datetime | None = None
    building: bool = False
