"""라우터 공용 의존성 — app.state 에서 설정·저장소·문제 은행·AI 서비스를 꺼내 조립한다.

보안(ENV 노출 방지): Settings 객체는 여기서만 꺼내 서비스에 넘기고, 응답에 직렬화되는 일이 없다.
보안(라우트 보호): get_session_from_token 은 경로에 세션 id 가 없는 엔드포인트(/chat)용 — 토큰의 세션을 쓴다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Header, Request

from app.core.config import Settings
from app.core.errors import SessionExpiredError, UnauthorizedError
from app.core.security import verify_session_token
from app.domain.models import Session
from app.services.chat import ChatService
from app.services.leaderboard import LeaderboardService
from app.services.question_bank import QuestionBank
from app.services.quiz_service import QuizService
from app.services.review import ReviewService
from app.services.session_service import SessionService
from app.services.session_store import SessionStore
from app.services.variation import VariationService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_question_bank(request: Request) -> QuestionBank:
    return request.app.state.question_bank


def get_session_store(request: Request) -> SessionStore:
    return request.app.state.session_store


def get_quiz_service(request: Request) -> QuizService:
    return QuizService(
        request.app.state.question_bank,
        request.app.state.session_store,
        variant_cache=request.app.state.variant_cache,
    )


def get_session_service(request: Request) -> SessionService:
    return SessionService(request.app.state.session_store, request.app.state.settings)


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat


def get_review_service(request: Request) -> ReviewService:
    return request.app.state.review


def get_variation_service(request: Request) -> VariationService:
    return request.app.state.variation


def get_leaderboard_service(request: Request) -> LeaderboardService:
    return request.app.state.leaderboard


def get_session_from_token(
    request: Request,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
) -> Session:
    """토큰만으로 세션을 찾는다(/chat). 검사 순서·오류 코드는 require_session 과 같다."""
    if not x_session_token:
        raise UnauthorizedError(detail="token_missing")
    now = datetime.now(UTC)
    settings: Settings = request.app.state.settings
    payload = verify_session_token(x_session_token, settings.session_secret, now=now)
    store: SessionStore = request.app.state.session_store
    session = store.get(payload.session_id)
    if session is None or session.expires_at <= now:
        raise SessionExpiredError(detail="session_not_found_or_expired")
    request.state.session_id = session.session_id
    return session
