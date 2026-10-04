"""1.8 — 오류 형식·전역 예외 핸들러·JSON 로그."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import (
    AiUnavailableError,
    ConflictError,
    NicknameRejectedError,
    NotFoundError,
    RateLimitedError,
    ScoreRejectedError,
    SessionExpiredError,
    UnauthorizedError,
    ValidationFailedError,
)
from app.core.logging import JsonFormatter
from app.main import create_app


class _Body(BaseModel):
    n: int


def _app_with_failing_routes(settings: Settings):
    app = create_app(settings)

    @app.get("/boom/app-error")
    async def _app_error() -> None:
        raise NotFoundError("없어요")

    @app.get("/boom/conflict")
    async def _conflict() -> None:
        raise ConflictError(detail={"quizId": "q_1"})

    @app.get("/boom/unhandled")
    async def _unhandled() -> None:
        raise RuntimeError("secret internal detail")

    @app.post("/boom/validate")
    async def _validate(body: _Body) -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest.fixture
def eclient(settings: Settings) -> Iterator[TestClient]:
    app = _app_with_failing_routes(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def test_app_error_uses_contract_format(eclient: TestClient) -> None:
    response = eclient.get("/boom/app-error")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "NOT_FOUND", "message": "없어요"}}
    assert response.headers["x-request-id"]


def test_conflict_is_409_with_validation_error_code(eclient: TestClient) -> None:
    response = eclient.get("/boom/conflict")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "q_1" not in response.text  # detail은 로그 전용


def test_request_validation_error_hides_details(eclient: TestClient) -> None:
    response = eclient.post("/boom/validate", json={"n": "abc"})
    assert response.status_code == 422
    body = response.json()
    assert body == {"error": {"code": "VALIDATION_ERROR", "message": "입력값이 올바르지 않아요."}}


def test_unhandled_exception_is_masked_and_logged(
    eclient: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        response = eclient.get("/boom/unhandled")
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL", "message": "잠시 문제가 생겼어요. 다시 시도해 주세요."}
    }
    assert "secret internal detail" not in response.text
    logged = [r for r in caplog.records if r.name == "app.errors" and r.exc_info]
    assert logged and "secret internal detail" in caplog.text


def test_unknown_route_404_json(eclient: TestClient) -> None:
    response = eclient.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "NOT_FOUND", "message": "찾을 수 없어요."}}


def test_method_not_allowed_is_json(eclient: TestClient) -> None:
    response = eclient.post("/healthz")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("error_cls", "status", "code"),
    [
        (ValidationFailedError, 422, "VALIDATION_ERROR"),
        (UnauthorizedError, 401, "UNAUTHORIZED"),
        (SessionExpiredError, 401, "SESSION_EXPIRED"),
        (NotFoundError, 404, "NOT_FOUND"),
        (ConflictError, 409, "VALIDATION_ERROR"),
        (RateLimitedError, 429, "RATE_LIMITED"),
        (ScoreRejectedError, 400, "SCORE_REJECTED"),
        (NicknameRejectedError, 400, "NICKNAME_REJECTED"),
        (AiUnavailableError, 503, "AI_UNAVAILABLE"),
    ],
)
def test_error_classes_match_contract(error_cls, status: int, code: str) -> None:
    error = error_cls()
    assert (error.status_code, error.code) == (status, code)
    assert error.message  # 한국어 기본 메시지


def test_json_formatter_fields() -> None:
    record = logging.LogRecord("app.request", logging.INFO, __file__, 1, "request", None, None)
    record.request_id = "abc123"
    record.path = "/healthz"
    record.status = 200
    record.duration_ms = 1.5
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "INFO"
    assert payload["message"] == "request"
    assert payload["request_id"] == "abc123"
    assert payload["path"] == "/healthz"
    assert payload["status"] == 200
    assert payload["duration_ms"] == 1.5
    assert payload["time"].endswith("Z")
    assert "session_id" not in payload  # None인 필드는 생략


def test_request_log_line_emitted(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = client.get("/healthz")
    records = [r for r in caplog.records if r.name == "app.request"]
    assert records
    last = records[-1]
    assert last.path == "/healthz"
    assert last.status == 200
    assert last.method == "GET"
    assert last.request_id == response.headers["x-request-id"]
    assert isinstance(last.duration_ms, float)
