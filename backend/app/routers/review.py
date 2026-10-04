"""POST /sessions/{session_id}/review — 오답 정리 (docs/03, finished 세션만).

보안 5항목:
- 라우트 보호: require_session(토큰 ↔ 경로 세션 일치), IP 5/분.
- DB 보안: 세션 저장소에서 틀린 문제 기록만 읽는다.
- ENV 노출 방지: 없음.
- 서버 측 검증: finished 가 아니면 409. 정답 위치(retryCorrectIndex)는 게임이 끝난 뒤에만 내려간다.
- 에러 로그: Gemini 실패는 빈 aiNote/summary 로 200 유지(로그에만 기록).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.security import limiter, require_session
from app.domain.models import Session
from app.routers.deps import get_review_service
from app.routers.schemas import ReviewResponse
from app.services.review import ReviewService

router = APIRouter(tags=["review"])


@router.post("/sessions/{session_id}/review", response_model=ReviewResponse)
@limiter.limit("5/minute")
async def review_session(
    request: Request,
    session_id: str,
    session: Session = Depends(require_session),
    service: ReviewService = Depends(get_review_service),
) -> ReviewResponse:
    return service.review(session)
