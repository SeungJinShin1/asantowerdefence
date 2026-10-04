"""리더보드 — POST /leaderboard(세션 토큰, finished 만, 세션당 1회) · GET /leaderboard?limit=20 (docs/03).

보안 5항목:
- 라우트 보호: 등록은 X-Session-Token(토큰의 세션) + IP 5/분. 조회는 공개(읽기 전용, 기본 120/분).
- DB 보안: LeaderboardStore(메모리/Firestore Admin SDK)만 통해 접근.
- ENV 노출 방지: 없음.
- 서버 측 검증: 점수는 세션의 서버 finish 결과만 사용, 닉네임은 domain/nickname 으로 검증, 중복 등록 409.
- 에러 로그: 닉네임 거부 사유는 detail(로그)에만, 응답은 NICKNAME_REJECTED.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.core.security import limiter
from app.domain.models import Session
from app.routers.deps import get_leaderboard_service, get_session_from_token
from app.routers.schemas import (
    LeaderboardRow,
    RegisterLeaderboardRequest,
    RegisterLeaderboardResponse,
)
from app.services.leaderboard import DEFAULT_LIMIT, MAX_LIMIT, LeaderboardService

router = APIRouter(tags=["leaderboard"])


@router.post("/leaderboard", response_model=RegisterLeaderboardResponse, status_code=201)
@limiter.limit("5/minute")
async def register(
    request: Request,
    body: RegisterLeaderboardRequest,
    session: Session = Depends(get_session_from_token),
    service: LeaderboardService = Depends(get_leaderboard_service),
) -> RegisterLeaderboardResponse:
    return service.register(session, body.nickname)


@router.get("/leaderboard", response_model=list[LeaderboardRow])
async def top(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    service: LeaderboardService = Depends(get_leaderboard_service),
) -> list[LeaderboardRow]:
    return service.list_top(limit)
