"""도메인 모델 (pydantic v2). 외부 의존 없음.

이름 규칙: 파이썬 필드는 snake_case, JSON(콘텐츠 파일·API·Firestore)은 camelCase(alias_generator).

보안(정답·서버 전용 필드 노출 방지): Question.answer_index / Question.fact / Topic.chatbot_context /
QuizRecord.correct_index 는 서버 전용이다. 프론트로 나가는 데이터는 반드시 routers/schemas.py의
응답 스키마(TopicOut, QuizItem 등)를 거치며, 그 스키마에는 이 필드들이 존재하지 않는다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

TOPIC_IDS: tuple[str, ...] = ("onyang", "maengsaseong", "yisunsin", "gongseri", "seonjang")
STAGE_COUNT = len(TOPIC_IDS)

QuizKind = Literal["normal", "emergency", "rush"]
EventType = Literal[
    "MIDBOSS_DEFEATED", "FINALBOSS_DEFEATED", "WAVE_CLEARED", "STAGE_FAILED", "LEARN_COMPLETED"
]
SessionStatus = Literal["active", "finished"]
Difficulty = Literal[1, 2, 3]


class CamelModel(BaseModel):
    """camelCase alias를 쓰는 공통 베이스. 필드 이름·alias 어느 쪽으로도 입력할 수 있다."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ---------- 콘텐츠 (content/*.json) ----------


class Card(CamelModel):
    id: str
    title: str
    body: str


class Topic(CamelModel):
    id: str
    order: int
    title: str
    subtitle: str = ""
    era: str = ""
    keywords: list[str] = Field(default_factory=list)
    cards: list[Card] = Field(default_factory=list)
    chatbot_context: str = ""  # 서버 전용 — TopicOut에 없음


class Question(CamelModel):
    id: str
    topic_id: str
    difficulty: Difficulty
    stem: str
    options: list[str]  # 원본은 options[answer_index]가 정답(현재 모두 0). 출제 시 서버가 섞는다
    answer_index: int  # 서버 전용
    fact: str  # 서버 전용 — Gemini 변형의 고정 앵커
    explanation: str
    source: str = ""


class Variant(CamelModel):
    """Gemini 변형 문제 (Phase 4). options[0]이 정답(원본 규칙과 동일)."""

    variant_id: str
    question_id: str
    topic_id: str
    stem: str
    options: list[str]
    correct_index: int = 0
    model: str = ""
    created_at: datetime | None = None
    valid: bool = True


# ---------- 세션 ----------


class QuizRecord(CamelModel):
    """세션에 실제로 출제된 문제 1건. 섞인 보기와 정답 위치(correct_index)는 여기에만 존재한다."""

    quiz_id: str
    question_id: str
    variant_id: str | None = None
    topic_id: str
    stage_order: int
    kind: QuizKind
    difficulty: int
    stem: str
    options: list[str]
    correct_index: int
    explanation: str
    served_at: datetime
    answered_at: datetime | None = None
    wave: int | None = None
    choice_index: int | None = None
    correct: bool | None = None
    coins: int = 0

    @property
    def answered(self) -> bool:
        return self.answered_at is not None


class SessionStats(CamelModel):
    correct_count: int = 0
    answered_count: int = 0
    combo: int = 0
    combo_max: int = 0
    coins_from_quiz: int = 0


class GameEventRecord(CamelModel):
    type: EventType
    stage_order: int
    wave: int
    at: datetime
    until: datetime | None = None  # DOUBLE_COIN_TIME 등 지속 효과의 종료 시각


class StageState(CamelModel):
    """스테이지별 진행 상태. 재도전(retry)이면 event_counts만 초기화한다 (docs/02 §8)."""

    attempts: int = 0
    event_counts: dict[str, int] = Field(default_factory=dict)


class FinishReport(CamelModel):
    stages_cleared: int
    waves_cleared: int
    lives_left_at_end: int
    coins_left_at_end: int
    client_score: int


class ScoreBreakdown(CamelModel):
    correct: int
    combo: int
    waves: int
    stages: int
    lives: int
    coins: int


class FinishResult(CamelModel):
    score: int
    breakdown: ScoreBreakdown
    reported: FinishReport
    finished_at: datetime


class LeaderboardEntry(CamelModel):
    """docs/04 §1 `defence_leaderboard` 문서. 닉네임 외 개인정보 없음."""

    nickname: str
    score: int
    stage_reached: int
    correct_count: int
    combo_max: int
    booth_mode: bool
    session_id: str
    created_at: datetime


class Session(CamelModel):
    """한 명의 한 판. docs/04 §1 `defence_sessions` 문서와 같은 모양."""

    session_id: str
    nickname: str | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    status: SessionStatus = "active"
    booth_mode: bool = True
    waves_per_stage: int
    stages_started: list[int] = Field(default_factory=list)
    stage_states: dict[int, StageState] = Field(default_factory=dict)
    quizzes: dict[str, QuizRecord] = Field(default_factory=dict)
    served_question_ids: list[str] = Field(default_factory=list)
    stats: SessionStats = Field(default_factory=SessionStats)
    events: list[GameEventRecord] = Field(default_factory=list)
    result: FinishResult | None = None
    leaderboard_id: str | None = None
    chat_count: int = 0  # 세션당 챗봇 호출 횟수(docs/04 §4: 40회/판)

    @property
    def is_finished(self) -> bool:
        return self.status == "finished"

    @property
    def stage_reached(self) -> int:
        return max(self.stages_started, default=0)

    def wrong_quiz_ids(self) -> list[str]:
        """틀린 문제의 quizId를 출제 순서대로."""
        wrong = [q for q in self.quizzes.values() if q.correct is False]
        return [q.quiz_id for q in sorted(wrong, key=lambda q: q.served_at)]
