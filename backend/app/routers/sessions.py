"""세션 생성 · 스테이지 시작 · 이벤트 · 종료 (docs/03 `POST /sessions`, `stages/{n}/start`, `events`, `finish`).

보안 5항목:
- 라우트 보호: POST /sessions 는 IP당 30/분. 나머지는 require_session(HMAC 토큰 + 경로 session_id 일치).
  POST /sessions/teacher 는 교사 코드(TEACHER_CODE)가 맞아야 하고 IP당 5/분(무차별 대입 방지), 코드가 없으면 404.
- DB 보안: SessionStore(Phase 1 메모리, Phase 5 Firestore Admin SDK)만 통해 접근.
- ENV 노출 방지: 토큰 비밀키는 security 모듈 안에서만 쓰이고 응답에는 토큰 문자열만 나간다.
- 서버 측 검증: 이벤트 상한·finish 상한·점수 계산은 SessionService/QuizService 가 수행. 클라이언트 점수는 무시.
- 에러 로그: SCORE_REJECTED 사유는 로그에만, 응답에는 code·message 만.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.security import limiter, require_session
from app.domain.models import Session
from app.routers.deps import get_quiz_service, get_session_service
from app.routers.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EventRequest,
    EventResponse,
    FinishRequest,
    FinishResponse,
    StageStartRequest,
    StageStartResponse,
    TeacherSessionRequest,
)
from app.services.quiz_service import QuizService
from app.services.session_service import SessionService

router = APIRouter(tags=["sessions"])


@router.post("/sessions", response_model=CreateSessionResponse, status_code=201)
@limiter.limit("30/minute")
async def create_session(
    request: Request,
    body: CreateSessionRequest | None = None,
    service: SessionService = Depends(get_session_service),
) -> CreateSessionResponse:
    session, token = service.create(body.nickname if body else None)
    return CreateSessionResponse(
        session_id=session.session_id,
        token=token,
        expires_at=session.expires_at,
        booth_mode=session.booth_mode,
        teacher=session.is_teacher,
    )


@router.post("/sessions/teacher", response_model=CreateSessionResponse, status_code=201)
@limiter.limit("5/minute")
async def create_teacher_session(
    request: Request,
    body: TeacherSessionRequest,
    service: SessionService = Depends(get_session_service),
) -> CreateSessionResponse:
    """교사 코드가 맞으면 교사 세션을 만든다(모든 단계 열림·리더보드 제외). 코드는 응답·로그에 남기지 않는다."""
    session, token = service.create_teacher(body.code)
    return CreateSessionResponse(
        session_id=session.session_id,
        token=token,
        expires_at=session.expires_at,
        booth_mode=session.booth_mode,
        teacher=session.is_teacher,
    )


@router.post("/sessions/{session_id}/stages/{stage_order}/start", response_model=StageStartResponse)
async def start_stage(
    session_id: str,
    stage_order: int,
    body: StageStartRequest | None = None,
    session: Session = Depends(require_session),
    service: QuizService = Depends(get_quiz_service),
) -> StageStartResponse:
    return service.start_stage(session.session_id, stage_order, retry=bool(body and body.retry))


@router.post("/sessions/{session_id}/events", response_model=EventResponse)
async def report_event(
    session_id: str,
    body: EventRequest,
    session: Session = Depends(require_session),
    service: SessionService = Depends(get_session_service),
) -> EventResponse:
    return service.record_event(session.session_id, body)


@router.post("/sessions/{session_id}/finish", response_model=FinishResponse)
async def finish_session(
    session_id: str,
    body: FinishRequest,
    session: Session = Depends(require_session),
    service: SessionService = Depends(get_session_service),
) -> FinishResponse:
    return service.finish(session.session_id, body)
