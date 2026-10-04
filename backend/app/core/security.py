"""세션 토큰(HMAC-SHA256)·인증 의존성·관리자 토큰·slowapi 요청 제한 (docs/03 공통, docs/04 §3·§4).

보안 5항목:
- 라우트 보호·접근 제어: 세션 엔드포인트는 Depends(require_session) — 서명·만료·세션 존재·경로 session_id
  일치를 모두 검사한다. 관리자 엔드포인트는 Depends(require_admin). IP 기준 요청 제한은 slowapi(기본 120/분).
- ENV 프론트 노출 방지: SESSION_SECRET·ADMIN_TOKEN은 request.app.state.settings에서만 읽고 응답·로그에 넣지 않는다.
- 프로덕션 에러 로그 처리: 실패 사유는 AppError.detail(로그 전용)에 짧은 식별자만 남기고 토큰 원문은 남기지 않는다.

토큰 형식: "{session_id}.{exp_unix}.{hmac_sha256_hex(secret, '{session_id}.{exp_unix}')}" — hex 64자 전체(절단 금지).
session_id는 [A-Za-z0-9_-]+ (점 없음) 이어야 토큰을 점으로 나눌 수 있다.

요청 제한 사용법 (라우터):
    @router.post("/sessions")
    @limiter.limit("10/minute")
    async def create_session(request: Request, ...): ...
  · @limiter.limit 을 붙인 엔드포인트는 반드시 `request: Request` 인자를 받아야 한다(없으면 데코레이트 시점에 예외).
  · 데코레이터가 없는 라우트는 미들웨어가 기본 한도(120/분)를 적용한다.
  · setup_rate_limiting(app, settings)는 create_app 안(첫 요청 전)에서 호출한다 — Starlette는 기동 뒤 미들웨어 추가를 거부한다.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime
from typing import NamedTuple

from fastapi import FastAPI, Header, Request
from slowapi import Limiter
from slowapi.middleware import SlowAPIASGIMiddleware
from slowapi.util import get_remote_address

from app.core.config import Settings
from app.core.errors import SessionExpiredError, UnauthorizedError
from app.domain.models import Session

DEFAULT_RATE_LIMIT = "120/minute"  # docs/03 공통 — IP 기준 기본 한도
_ID_RANDOM_BYTES = 12  # token_urlsafe(12) → 16자, [A-Za-z0-9_-]만 사용(점 없음)
_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
_EXP_PATTERN = re.compile(r"[0-9]{1,12}")  # 유닉스 초. 부호·공백·유니코드 숫자 불허
_SIGNATURE_PATTERN = re.compile(r"[0-9a-f]{64}")  # SHA-256 hex 전체


# ---------- 식별자 ----------


def new_session_id() -> str:
    """세션 id — "s_" + 무작위 16자. 점이 없어 토큰 구분자와 충돌하지 않는다."""
    return "s_" + secrets.token_urlsafe(_ID_RANDOM_BYTES)


def new_quiz_id() -> str:
    """출제(Quiz) id — "q_" + 무작위 16자."""
    return "q_" + secrets.token_urlsafe(_ID_RANDOM_BYTES)


# ---------- 세션 토큰 ----------


class TokenPayload(NamedTuple):
    session_id: str
    expires_at: datetime  # tz-aware UTC, 초 단위


def _require_aware(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError(f"{name}은(는) tz-aware UTC datetime이어야 합니다")


def _sign(secret: str, message: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def _constant_time_equals(given: str, expected: str) -> bool:
    """문자열 길이·내용과 무관하게 일정 시간이 걸리는 비교. 비ASCII 입력도 안전하게 처리한다."""
    return hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))


def issue_session_token(session_id: str, expires_at: datetime, secret: str) -> str:
    """세션 토큰 발급. expires_at은 tz-aware(UTC)여야 하며 초 단위로 내림한다."""
    if not _ID_PATTERN.fullmatch(session_id):
        raise ValueError("session_id는 [A-Za-z0-9_-]+ 형식이어야 합니다")
    _require_aware(expires_at, "expires_at")
    message = f"{session_id}.{int(expires_at.timestamp())}"
    return f"{message}.{_sign(secret, message)}"


def verify_session_token(token: str, secret: str, *, now: datetime) -> TokenPayload:
    """형식 → 서명 → 만료 순으로 검사한다.

    형식 오류·서명 불일치는 UnauthorizedError, 서명은 맞지만 exp <= now 이면 SessionExpiredError.
    서명을 만료보다 먼저 보므로 위조 토큰에는 만료 여부가 드러나지 않는다. detail에는 토큰 원문을 넣지 않는다.
    """
    _require_aware(now, "now")
    parts = token.split(".")
    if len(parts) != 3:
        raise UnauthorizedError(detail="token_format")
    session_id, exp_text, signature = parts
    if not (
        _ID_PATTERN.fullmatch(session_id)
        and _EXP_PATTERN.fullmatch(exp_text)
        and _SIGNATURE_PATTERN.fullmatch(signature)
    ):
        raise UnauthorizedError(detail="token_format")
    expected = _sign(secret, f"{session_id}.{exp_text}")
    if not hmac.compare_digest(expected, signature):
        raise UnauthorizedError(detail="token_signature")
    try:
        expires_at = datetime.fromtimestamp(int(exp_text), UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise UnauthorizedError(detail="token_exp_range") from exc
    if expires_at <= now:
        raise SessionExpiredError(detail="token_expired")
    return TokenPayload(session_id=session_id, expires_at=expires_at)


# ---------- FastAPI 의존성 ----------


def require_session(
    request: Request,
    session_id: str,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
) -> Session:
    """`/sessions/{session_id}/...` 라우트 보호. 경로 변수 이름은 반드시 session_id.

    검사 순서: 헤더 존재 → 토큰 서명·만료 → 토큰의 session_id == 경로 session_id → 저장소에 세션 존재 →
    세션 expires_at 미경과. 통과하면 request.state.session_id를 채워(요청 로그용) Session을 돌려준다.
    동기 함수라 FastAPI가 스레드풀에서 실행한다 — Phase 5 Firestore 저장소의 블로킹 get에도 안전.
    """
    if not x_session_token:
        raise UnauthorizedError(detail="token_missing")
    settings: Settings = request.app.state.settings
    now = datetime.now(UTC)
    payload = verify_session_token(x_session_token, settings.session_secret, now=now)
    if payload.session_id != session_id:
        raise UnauthorizedError(detail="session_mismatch")
    store = request.app.state.session_store
    if store is None:  # 조립 오류 — 500으로 드러나야 한다(인증 우회 금지)
        raise RuntimeError("app.state.session_store가 설정되지 않았습니다")
    session: Session | None = store.get(session_id)
    if session is None:
        raise SessionExpiredError(detail="session_not_found")
    if session.expires_at <= now:
        raise SessionExpiredError(detail="session_expired")
    request.state.session_id = session_id
    return session


def require_admin(
    request: Request,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """관리자 라우트 보호. ADMIN_TOKEN이 비어 있으면 어떤 값으로도 통과할 수 없다."""
    settings: Settings = request.app.state.settings
    expected = settings.admin_token
    if not expected or not x_admin_token or not _constant_time_equals(x_admin_token, expected):
        raise UnauthorizedError(detail="admin_token")


# ---------- 요청 제한 (slowapi) ----------

limiter = Limiter(key_func=get_remote_address, default_limits=[DEFAULT_RATE_LIMIT])


def setup_rate_limiting(app: FastAPI, settings: Settings) -> None:
    """limiter를 앱에 연결한다. 모듈 전역 limiter라 enabled 플래그는 프로세스 전체에 적용된다.

    SlowAPIASGIMiddleware를 쓰는 이유: BaseHTTPMiddleware 기반 SlowAPIMiddleware는 비동기 예외 핸들러를
    호출하지 못해 기본 한도(120/분) 초과 시 평문 429를 돌려주지만, ASGI 변형은 app/core/errors.py의
    RateLimitExceeded 핸들러를 그대로 호출해 계약 형식 {"error": {"code": "RATE_LIMITED", ...}}을 유지한다.
    두 번 호출해도 미들웨어는 한 번만 추가된다.
    """
    limiter.enabled = settings.rate_limit_enabled
    app.state.limiter = limiter
    if not any(m.cls is SlowAPIASGIMiddleware for m in app.user_middleware):
        app.add_middleware(SlowAPIASGIMiddleware)
