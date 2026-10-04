"""관리자 — 변형 문제 캐시 재생성·상태 (docs/03 admin/variants).

보안 5항목:
- 라우트 보호: X-Admin-Token(require_admin, compare_digest). 비어 있는 ADMIN_TOKEN 이면 항상 401.
- DB 보안: 변형 캐시(메모리/Phase 5 Firestore)만 다룬다.
- ENV 노출 방지: 상태 응답에 모델명·키를 넣지 않는다.
- 서버 측 검증: 재생성은 백그라운드 스레드로 1회만(이미 진행 중이면 그대로 202).
- 에러 로그: Gemini 미설정이면 503 AI_UNAVAILABLE.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.core.errors import AiUnavailableError
from app.core.security import require_admin
from app.routers.deps import get_leaderboard_service, get_variation_service
from app.routers.schemas import LeaderboardResetResponse, QueuedResponse, VariantStatusResponse
from app.services.leaderboard import LeaderboardService
from app.services.variation import VariationService

logger = logging.getLogger("app.admin")

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/variants/rebuild", response_model=QueuedResponse, status_code=202)
async def rebuild_variants(
    service: VariationService = Depends(get_variation_service),
) -> QueuedResponse:
    if service.client is None:
        raise AiUnavailableError("Gemini 가 설정되어 있지 않아 변형을 만들 수 없어요.")
    service.start_background_build()
    return QueuedResponse(queued=True)


@router.post("/leaderboard/reset", response_model=LeaderboardResetResponse)
async def reset_leaderboard(
    service: LeaderboardService = Depends(get_leaderboard_service),
) -> LeaderboardResetResponse:
    """부스 시작 전·테스트 기록 정리용. 되돌릴 수 없으므로 관리자 토큰으로만, 실행은 로그에 남긴다."""
    removed = service.reset()
    logger.warning("leaderboard_reset", extra={"detail": f"removed={removed}"})
    return LeaderboardResetResponse(removed=removed)


@router.get("/variants/status", response_model=VariantStatusResponse)
async def variants_status(
    service: VariationService = Depends(get_variation_service),
) -> VariantStatusResponse:
    return VariantStatusResponse(**service.status())
