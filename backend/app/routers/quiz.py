"""추가 출제 · 채점 (docs/03 `GET quiz/more`, `POST quiz/answer`).

보안 5항목:
- 라우트 보호: 두 엔드포인트 모두 require_session(HMAC 토큰 + 경로 session_id 일치), 기본 120/분.
- DB 보안: SessionStore 를 통해서만 세션을 읽고 쓴다.
- ENV 노출 방지: 설정값을 쓰지 않는다.
- 서버 측 검증: 정답 위치는 세션에만 있고 QuizItem 에는 없다. 채점·코인·콤보는 QuizService 가 계산.
  quizId 는 세션 소유분만, 같은 quizId 재답변은 409.
- 에러 로그: 공통 미들웨어·핸들러.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.security import require_session
from app.domain.models import QuizKind, Session
from app.domain.scoring import QUIZ_MORE_DEFAULT, QUIZ_MORE_MAX
from app.routers.deps import get_quiz_service
from app.routers.schemas import AnswerRequest, AnswerResponse, QuizMoreResponse
from app.services.quiz_service import QuizService

router = APIRouter(tags=["quiz"])


@router.get("/sessions/{session_id}/quiz/more", response_model=QuizMoreResponse)
async def quiz_more(
    session_id: str,
    stage: int = Query(..., ge=1),
    count: int = Query(QUIZ_MORE_DEFAULT, ge=1, le=QUIZ_MORE_MAX),
    kind: QuizKind = "normal",
    wave: int | None = Query(None, ge=1),
    session: Session = Depends(require_session),
    service: QuizService = Depends(get_quiz_service),
) -> QuizMoreResponse:
    return service.more(session.session_id, stage_order=stage, count=count, kind=kind, wave=wave)


@router.post("/sessions/{session_id}/quiz/answer", response_model=AnswerResponse)
async def quiz_answer(
    session_id: str,
    body: AnswerRequest,
    session: Session = Depends(require_session),
    service: QuizService = Depends(get_quiz_service),
) -> AnswerResponse:
    return service.answer(session.session_id, body)
