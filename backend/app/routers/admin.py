"""관리자 — 변형 문제 캐시 재생성·상태 (docs/03 admin/variants).

보안 5항목:
- 라우트 보호: X-Admin-Token(require_admin, compare_digest). 비어 있는 ADMIN_TOKEN 이면 항상 401.
- DB 보안: 변형 캐시(메모리/Phase 5 Firestore)만 다룬다.
- ENV 노출 방지: 상태 응답에 모델명·키를 넣지 않는다.
- 서버 측 검증: 재생성은 백그라운드 스레드로 1회만(이미 진행 중이면 그대로 202).
- 에러 로그: Gemini 미설정이면 503 AI_UNAVAILABLE.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.errors import AiUnavailableError
from app.core.security import require_admin
from app.routers.deps import get_variation_service
from app.routers.schemas import QueuedResponse, VariantStatusResponse
from app.services.variation import VariationService

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/variants/rebuild", response_model=QueuedResponse, status_code=202)
async def rebuild_variants(
    service: VariationService = Depends(get_variation_service),
) -> QueuedResponse:
    if service.client is None:
        raise AiUnavailableError("Gemini 가 설정되어 있지 않아 변형을 만들 수 없어요.")
    service.start_background_build()
    return QueuedResponse(queued=True)


@router.get("/variants/status", response_model=VariantStatusResponse)
async def variants_status(
    service: VariationService = Depends(get_variation_service),
) -> VariantStatusResponse:
    return VariantStatusResponse(**service.status())
