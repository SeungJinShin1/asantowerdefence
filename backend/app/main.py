"""FastAPI 앱 팩토리와 `/healthz` (docs/01_architecture.md).

보안 5항목 (Phase 1 기준):
- 라우트 보호·접근 제어: 세션 필수 엔드포인트는 core/security.require_session, 관리자는 require_admin.
  CORS는 ALLOWED_ORIGINS 화이트리스트만, 자격 증명(credentials) 없음, GET/POST만 허용.
- DB 보안 규칙: Firestore는 서버(Admin SDK)만 접근(Phase 5). Phase 1은 InMemorySessionStore.
- ENV 프론트 노출 방지: 설정은 Settings로만 읽고 어떤 응답에도 넣지 않는다. production은 /docs·/openapi.json을 닫는다.
- 중요 로직 서버 측 검증: 출제·채점·코인·콤보·점수는 domain/·services/에서만 계산한다.
- 프로덕션 에러 로그 처리: core/errors 전역 핸들러(내부 정보 비노출) + core/logging JSON 로그(request_id).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import RequestLogMiddleware, configure_logging
from app.core.security import setup_rate_limiting
from app.routers import api_router
from app.routers.schemas import HealthResponse
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore, SessionStore

API_PREFIX = "/api/v1"


def create_app(
    settings: Settings | None = None,
    *,
    question_bank: QuestionBank | None = None,
    session_store: SessionStore | None = None,
) -> FastAPI:
    """조립 지점(composition root). 테스트는 settings·문제 은행·저장소를 직접 주입한다.

    기본값: 문제 은행은 settings.content_dir 에서 로드(깨진 콘텐츠면 기동 실패 — 의도된 fail-fast),
    저장소는 InMemorySessionStore(Phase 5에서 Firestore 설정이 있으면 FirestoreSessionStore 로 교체).
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="아산 향토사 타워디펜스 API",
        version=settings.app_version,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.question_bank = (
        question_bank if question_bank is not None else QuestionBank.load(settings.content_dir)
    )
    app.state.session_store = session_store if session_store is not None else InMemorySessionStore()
    app.state.variants_ready = False  # Phase 4: 변형 캐시가 준비되면 True

    # 요청 제한은 CORS·로그 미들웨어보다 먼저 등록한다(나중에 add 한 것이 바깥쪽).
    # 그래야 기본 한도(120/분) 초과 429 응답도 CORS 헤더와 요청 로그를 거친다.
    setup_rate_limiting(app, settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Session-Token", "X-Admin-Token"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestLogMiddleware)
    register_exception_handlers(app)

    @app.get("/healthz", response_model=HealthResponse, tags=["health"])
    async def healthz(request: Request) -> HealthResponse:
        """프론트 첫 화면의 서버 깨우기용. 비밀값·내부 상태는 넣지 않는다."""
        return HealthResponse(
            version=settings.app_version,
            variants_ready=bool(request.app.state.variants_ready),
        )

    app.include_router(api_router, prefix=API_PREFIX)
    return app


app = create_app()
