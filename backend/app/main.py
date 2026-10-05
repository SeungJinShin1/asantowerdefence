"""FastAPI 앱 팩토리와 `/healthz` (docs/01_architecture.md).

보안 5항목 (Phase 1 기준):
- 라우트 보호·접근 제어: 세션 필수 엔드포인트는 core/security.require_session, 관리자는 require_admin.
  CORS는 ALLOWED_ORIGINS + FRONTEND_URL 화이트리스트(+ 같은 프로젝트의 Vercel 프리뷰 정규식)만,
  자격 증명(credentials) 없음, GET/POST만 허용.
- DB 보안 규칙: Firestore는 서버(Admin SDK)만 접근(Phase 5). Phase 1은 InMemorySessionStore.
- ENV 프론트 노출 방지: 설정은 Settings로만 읽고 어떤 응답에도 넣지 않는다. production은 /docs·/openapi.json을 닫는다.
- 중요 로직 서버 측 검증: 출제·채점·코인·콤보·점수는 domain/·services/에서만 계산한다.
- 프로덕션 에러 로그 처리: core/errors 전역 핸들러(내부 정보 비노출) + core/logging JSON 로그(request_id).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import RequestLogMiddleware, configure_logging
from app.core.security import setup_rate_limiting
from app.domain.nickname import load_banned_words
from app.routers import api_router
from app.routers.schemas import AiStatus, HealthResponse
from app.services.chat import ChatService
from app.services.firestore_store import (
    FirestoreLeaderboardStore,
    FirestoreSessionStore,
    FirestoreVariantCache,
    create_firestore_client,
)
from app.services.gemini_client import GeminiClient, GoogleGeminiClient
from app.services.leaderboard import InMemoryLeaderboardStore, LeaderboardService, LeaderboardStore
from app.services.question_bank import QuestionBank
from app.services.review import ReviewService
from app.services.session_store import InMemorySessionStore, SessionStore
from app.services.variation import InMemoryVariantCache, VariantCache, VariationService

API_PREFIX = "/api/v1"


def create_app(
    settings: Settings | None = None,
    *,
    question_bank: QuestionBank | None = None,
    session_store: SessionStore | None = None,
    gemini_client: GeminiClient | None = None,
    variant_cache: VariantCache | None = None,
    leaderboard_store: LeaderboardStore | None = None,
    firestore_client: Any | None = None,
    build_variants_on_startup: bool = True,
) -> FastAPI:
    """조립 지점(composition root). 테스트는 settings·문제 은행·저장소·Gemini 목을 직접 주입한다.

    기본값: 문제 은행은 settings.content_dir 에서 로드(깨진 콘텐츠면 기동 실패 — 의도된 fail-fast),
    저장소는 InMemorySessionStore(Phase 5에서 Firestore 설정이 있으면 교체), Gemini 는 키·모델이 있을 때만.
    변형 캐시가 비어 있으면 시작 시 백그라운드 스레드로 생성한다(요청을 막지 않음, docs/01 §5).
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    bank = question_bank if question_bank is not None else QuestionBank.load(settings.content_dir)
    # 저장소 선택: 명시 주입 > Firestore(서비스 계정 있음) > 메모리
    db = firestore_client
    if db is None and settings.firestore_configured:
        db = create_firestore_client(
            settings.firebase_service_account_b64, settings.firebase_service_account_file
        )
    prefix = settings.firestore_collection_prefix
    sessions: SessionStore = (
        session_store
        if session_store is not None
        else (FirestoreSessionStore(db, prefix) if db is not None else InMemorySessionStore())
    )
    lb_store: LeaderboardStore = (
        leaderboard_store
        if leaderboard_store is not None
        else (
            FirestoreLeaderboardStore(db, prefix) if db is not None else InMemoryLeaderboardStore()
        )
    )
    client = gemini_client
    if client is None and settings.gemini_configured:
        client = GoogleGeminiClient(settings.gemini_api_key, settings.gemini_model)
    cache: VariantCache = (
        variant_cache
        if variant_cache is not None
        else (FirestoreVariantCache(db, prefix) if db is not None else InMemoryVariantCache())
    )
    variation = VariationService(
        bank, client, cache, variants_per_question=settings.variants_per_question
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if build_variants_on_startup and not variation.ready():
            variation.start_background_build()
        yield

    app = FastAPI(
        title="아산 향토사 타워디펜스 API",
        version=settings.app_version,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.question_bank = bank
    app.state.session_store = sessions
    app.state.gemini = client
    app.state.variant_cache = cache
    app.state.variation = variation
    app.state.chat = ChatService(bank, client)
    app.state.review = ReviewService(bank, client)
    app.state.leaderboard = LeaderboardService(lb_store, sessions, banned_words=load_banned_words())

    # 요청 제한은 CORS·로그 미들웨어보다 먼저 등록한다(나중에 add 한 것이 바깥쪽).
    # 그래야 기본 한도(120/분) 초과 429 응답도 CORS 헤더와 요청 로그를 거친다.
    setup_rate_limiting(app, settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.allowed_origin_regex or None,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Session-Token", "X-Admin-Token"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestLogMiddleware)
    register_exception_handlers(app)

    @app.get("/", include_in_schema=False)
    async def root() -> Response:
        """API 서버 루트: 사람이 브라우저로 열면 게임(프론트) 주소로 보낸다. 프론트 주소가 없으면 안내 JSON."""
        if settings.public_frontend_url:
            return RedirectResponse(settings.public_frontend_url, status_code=307)
        return JSONResponse(
            {
                "name": "asan-defence-api",
                "status": "ok",
                "hint": "게임 화면은 프론트(Vercel) 주소에서 열어요. 상태 확인은 /healthz",
            }
        )

    @app.get("/healthz", response_model=HealthResponse, tags=["health"])
    async def healthz(request: Request) -> HealthResponse:
        """프론트 첫 화면의 서버 깨우기용 + AI 연결 진단. 비밀값은 넣지 않는다(모델명·오류 코드만)."""
        gemini = request.app.state.gemini
        diag = gemini.diagnostics() if hasattr(gemini, "diagnostics") else {}
        return HealthResponse(
            version=settings.app_version,
            variants_ready=request.app.state.variation.ready(),
            ai=AiStatus(
                configured=gemini is not None,
                model=str(diag.get("model") or getattr(gemini, "model", "") or ""),
                last_error=diag.get("last_error"),
                ok_calls=int(diag.get("ok_calls") or 0),
            ),
        )

    app.include_router(api_router, prefix=API_PREFIX)
    return app


app = create_app()
