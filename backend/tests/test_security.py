"""1.6 — 세션 토큰(HMAC), require_session / require_admin 의존성, slowapi 요청 제한.

세션 저장소는 다른 태스크(1.5)가 만드는 중이므로 get(session_id)만 있는 작은 가짜 저장소를 쓴다.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from tests.conftest import TEST_ADMIN_TOKEN, TEST_SESSION_SECRET

from app.core.config import Settings
from app.core.errors import SessionExpiredError, UnauthorizedError
from app.core.security import (
    TokenPayload,
    issue_session_token,
    limiter,
    new_quiz_id,
    new_session_id,
    require_admin,
    require_session,
    setup_rate_limiting,
    verify_session_token,
)
from app.domain.models import Session
from app.main import create_app

SECRET = TEST_SESSION_SECRET
OTHER_SECRET = "another-secret-" + "y" * 40
NOW = datetime(2026, 10, 1, 9, 0, 0, tzinfo=UTC)
EXPIRES = NOW + timedelta(hours=3)
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class FakeStore:
    """get(session_id)만 흉내 내는 세션 저장소."""

    def __init__(self, *sessions: Session) -> None:
        self._sessions = {s.session_id: s for s in sessions}

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)


def make_session(session_id: str, *, expires_at: datetime = EXPIRES) -> Session:
    now = datetime.now(UTC)
    return Session(
        session_id=session_id,
        created_at=now,
        updated_at=now,
        expires_at=expires_at,
        waves_per_stage=3,
    )


def protected_app(settings: Settings, store: FakeStore) -> FastAPI:
    app = create_app(settings, session_store=store)

    @app.get("/t/{session_id}")
    async def _protected(
        request: Request, session: Session = Depends(require_session)
    ) -> dict[str, str | None]:
        return {
            "session_id": session.session_id,
            "state_session_id": getattr(request.state, "session_id", None),
        }

    @app.get("/admin", dependencies=[Depends(require_admin)])
    async def _admin_only() -> dict[str, bool]:
        return {"ok": True}

    return app


def _flip_last_char(text: str) -> str:
    return text[:-1] + ("0" if text[-1] != "0" else "1")


# ---------- 토큰 ----------


def test_token_round_trip() -> None:
    token = issue_session_token("s_abc-DEF_123", EXPIRES, SECRET)
    payload = verify_session_token(token, SECRET, now=NOW)
    assert isinstance(payload, TokenPayload)
    assert payload.session_id == "s_abc-DEF_123"
    assert payload.expires_at == EXPIRES.replace(microsecond=0)
    assert payload.expires_at.tzinfo is not None


def test_token_format_uses_full_hex_signature() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    session_id, exp, signature = token.split(".")
    assert session_id == "s_abc"
    assert exp == str(int(EXPIRES.timestamp()))
    assert re.fullmatch(r"[0-9a-f]{64}", signature)  # SHA-256 hex 전체, 절단 금지


def test_token_sub_second_expiry_rounds_down_to_seconds() -> None:
    token = issue_session_token("s_abc", EXPIRES + timedelta(microseconds=999_999), SECRET)
    payload = verify_session_token(token, SECRET, now=NOW)
    assert payload.expires_at == EXPIRES.replace(microsecond=0)


def test_tampered_signature_rejected() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    with pytest.raises(UnauthorizedError):
        verify_session_token(_flip_last_char(token), SECRET, now=NOW)


def test_swapped_session_id_rejected() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    _, exp, sig = token.split(".")
    with pytest.raises(UnauthorizedError):
        verify_session_token(f"s_other.{exp}.{sig}", SECRET, now=NOW)


def test_swapped_expiry_rejected() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    sid, exp, sig = token.split(".")
    with pytest.raises(UnauthorizedError):
        verify_session_token(f"{sid}.{int(exp) + 3600}.{sig}", SECRET, now=NOW)


def test_wrong_secret_rejected() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    with pytest.raises(UnauthorizedError):
        verify_session_token(token, OTHER_SECRET, now=NOW)


@pytest.mark.parametrize("delta", [timedelta(0), timedelta(microseconds=1), timedelta(days=1)])
def test_expired_token_raises_session_expired(delta: timedelta) -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    with pytest.raises(SessionExpiredError):
        verify_session_token(token, SECRET, now=EXPIRES + delta)


def test_token_valid_just_before_expiry() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    payload = verify_session_token(token, SECRET, now=EXPIRES - timedelta(seconds=1))
    assert payload.session_id == "s_abc"


def test_forged_expired_token_is_unauthorized_not_expired() -> None:
    """서명이 틀리면 만료 여부와 무관하게 UNAUTHORIZED — 만료 정보를 먼저 흘리지 않는다."""
    token = issue_session_token("s_abc", EXPIRES, OTHER_SECRET)
    with pytest.raises(UnauthorizedError):
        verify_session_token(token, SECRET, now=EXPIRES + timedelta(days=1))


@pytest.mark.parametrize(
    "token",
    ["abc", "a.b", "a.notint.sig", "", "a.b.c.d", "s_abc.123.nothex", "s.abc.123.sig", "a..b"],
)
def test_malformed_tokens_rejected(token: str) -> None:
    with pytest.raises(UnauthorizedError):
        verify_session_token(token, SECRET, now=NOW)


def test_issue_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError, match="tz-aware"):
        issue_session_token("s_abc", EXPIRES.replace(tzinfo=None), SECRET)


def test_verify_rejects_naive_now() -> None:
    token = issue_session_token("s_abc", EXPIRES, SECRET)
    with pytest.raises(ValueError, match="tz-aware"):
        verify_session_token(token, SECRET, now=NOW.replace(tzinfo=None))


@pytest.mark.parametrize("bad_id", ["has.dot", "", "한글", "a b", "s_abc/x"])
def test_issue_rejects_bad_session_id(bad_id: str) -> None:
    with pytest.raises(ValueError):
        issue_session_token(bad_id, EXPIRES, SECRET)


def test_new_ids_prefix_charset_and_uniqueness() -> None:
    session_ids = {new_session_id() for _ in range(200)}
    quiz_ids = {new_quiz_id() for _ in range(200)}
    assert len(session_ids) == 200
    assert len(quiz_ids) == 200
    for sid in session_ids:
        assert sid.startswith("s_") and ID_PATTERN.fullmatch(sid) and "." not in sid
    for qid in quiz_ids:
        assert qid.startswith("q_") and ID_PATTERN.fullmatch(qid) and "." not in qid


# ---------- require_session ----------


@pytest.fixture
def store() -> FakeStore:
    # 살아 있는 세션은 실제 현재 시각 기준으로 만료를 잡는다(고정 날짜를 쓰면 날짜가 지나며 깨진다).
    live_until = datetime.now(UTC) + timedelta(hours=3)
    return FakeStore(
        make_session("s_live", expires_at=live_until),
        make_session("s_dead", expires_at=NOW),  # 고정 과거 → 항상 만료
    )


@pytest.fixture
def pclient(settings: Settings, store: FakeStore) -> Iterator[TestClient]:
    with TestClient(protected_app(settings, store)) as client:
        yield client


def _token(session_id: str, expires_at: datetime = EXPIRES, secret: str = SECRET) -> str:
    return issue_session_token(session_id, expires_at, secret)


def test_require_session_missing_header_401(pclient: TestClient) -> None:
    response = pclient.get("/t/s_live")
    assert response.status_code == 401
    body = response.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == "UNAUTHORIZED"


def test_require_session_ok(pclient: TestClient) -> None:
    far_future = datetime.now(UTC) + timedelta(hours=1)
    response = pclient.get("/t/s_live", headers={"X-Session-Token": _token("s_live", far_future)})
    assert response.status_code == 200
    assert response.json() == {"session_id": "s_live", "state_session_id": "s_live"}


def test_require_session_path_mismatch_401(pclient: TestClient) -> None:
    far_future = datetime.now(UTC) + timedelta(hours=1)
    response = pclient.get("/t/s_dead", headers={"X-Session-Token": _token("s_live", far_future)})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_require_session_garbage_token_401(pclient: TestClient) -> None:
    response = pclient.get("/t/s_live", headers={"X-Session-Token": "not.a.token"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_require_session_unknown_session_is_expired(pclient: TestClient) -> None:
    far_future = datetime.now(UTC) + timedelta(hours=1)
    response = pclient.get("/t/s_gone", headers={"X-Session-Token": _token("s_gone", far_future)})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


def test_require_session_expired_token(pclient: TestClient) -> None:
    past = datetime.now(UTC) - timedelta(seconds=1)
    response = pclient.get("/t/s_live", headers={"X-Session-Token": _token("s_live", past)})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


def test_require_session_record_expired(pclient: TestClient) -> None:
    far_future = datetime.now(UTC) + timedelta(hours=1)
    response = pclient.get("/t/s_dead", headers={"X-Session-Token": _token("s_dead", far_future)})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


# ---------- require_admin ----------


def test_require_admin_ok(pclient: TestClient) -> None:
    response = pclient.get("/admin", headers={"X-Admin-Token": TEST_ADMIN_TOKEN})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.parametrize("headers", [{}, {"X-Admin-Token": "wrong"}, {"X-Admin-Token": ""}])
def test_require_admin_missing_or_wrong_401(pclient: TestClient, headers: dict[str, str]) -> None:
    response = pclient.get("/admin", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_require_admin_empty_setting_always_401(settings: Settings) -> None:
    no_admin = settings.model_copy(update={"admin_token": ""})
    with TestClient(protected_app(no_admin, FakeStore())) as client:
        assert client.get("/admin", headers={"X-Admin-Token": ""}).status_code == 401
        assert client.get("/admin", headers={"X-Admin-Token": "anything"}).status_code == 401
        assert client.get("/admin").status_code == 401


# ---------- 요청 제한 ----------


@pytest.fixture
def limiter_state() -> Iterator[None]:
    """모듈 전역 limiter의 enabled 플래그와 카운터를 테스트 뒤 원래대로 되돌린다."""
    original = limiter.enabled
    limiter.reset()
    try:
        yield
    finally:
        limiter.enabled = original
        limiter.reset()


def _rate_settings(settings: Settings, enabled: bool) -> Settings:
    return settings.model_copy(update={"rate_limit_enabled": enabled})


def test_rate_limit_enabled_third_request_429(settings: Settings, limiter_state: None) -> None:
    rate_settings = _rate_settings(settings, True)
    app = create_app(rate_settings)
    setup_rate_limiting(app, rate_settings)

    @app.get("/limited-on")
    @limiter.limit("2/minute")
    async def _limited_on(request: Request) -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/limited-on").status_code == 200
        assert client.get("/limited-on").status_code == 200
        response = client.get("/limited-on")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


def test_rate_limit_disabled_all_200(settings: Settings, limiter_state: None) -> None:
    rate_settings = _rate_settings(settings, False)
    app = create_app(rate_settings)
    setup_rate_limiting(app, rate_settings)

    @app.get("/limited-off")
    @limiter.limit("2/minute")
    async def _limited_off(request: Request) -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as client:
        statuses = [client.get("/limited-off").status_code for _ in range(5)]
    assert statuses == [200] * 5


def test_default_limit_via_middleware_uses_contract_json(
    settings: Settings, limiter_state: None
) -> None:
    """데코레이터 없는 라우트는 기본 120/분이 미들웨어에서 걸리고, 429 본문도 계약 형식이어야 한다."""
    rate_settings = _rate_settings(settings, True)
    app = create_app(rate_settings)
    setup_rate_limiting(app, rate_settings)
    with TestClient(app) as client:
        statuses = [client.get("/healthz").status_code for _ in range(120)]
        response = client.get("/healthz")
    assert statuses == [200] * 120
    assert response.status_code == 429
    assert response.json() == {
        "error": {
            "code": "RATE_LIMITED",
            "message": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
        }
    }


def test_setup_rate_limiting_is_idempotent(settings: Settings, limiter_state: None) -> None:
    rate_settings = _rate_settings(settings, True)
    app = create_app(rate_settings)  # create_app 이 이미 setup_rate_limiting 을 한 번 호출한다
    before = len(app.user_middleware)
    assert any(m.cls.__name__ == "SlowAPIASGIMiddleware" for m in app.user_middleware)
    setup_rate_limiting(app, rate_settings)
    setup_rate_limiting(app, rate_settings)
    assert len(app.user_middleware) == before  # 추가 호출은 미들웨어를 더 쌓지 않는다
    assert app.state.limiter is limiter
    assert limiter.enabled is True
