"""라우터 공용 의존성 — app.state 에서 설정·저장소·문제 은행을 꺼내 서비스를 조립한다.

보안(ENV 노출 방지): Settings 객체는 여기서만 꺼내 서비스에 넘기고, 응답에 직렬화되는 일이 없다.
"""

from __future__ import annotations

from fastapi import Request

from app.core.config import Settings
from app.services.question_bank import QuestionBank
from app.services.quiz_service import QuizService
from app.services.session_service import SessionService
from app.services.session_store import SessionStore


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_question_bank(request: Request) -> QuestionBank:
    return request.app.state.question_bank


def get_session_store(request: Request) -> SessionStore:
    return request.app.state.session_store


def get_quiz_service(request: Request) -> QuizService:
    return QuizService(request.app.state.question_bank, request.app.state.session_store)


def get_session_service(request: Request) -> SessionService:
    return SessionService(request.app.state.session_store, request.app.state.settings)
