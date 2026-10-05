"""1.1 — 앱 뼈대: /healthz, CORS 화이트리스트, production 안전장치."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app
from app.services.gemini_client import ChatTurn, GeminiError, GoogleGeminiClient
from app.services.question_bank import QuestionBank


def test_healthz_matches_contract(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": "0.1.0",
        "variantsReady": False,
        "ai": {
            "configured": False,
            "apiKeySet": False,
            "model": "gemini-3.6-flash",
            "lastError": None,
            "okCalls": 0,
        },
    }
    assert response.headers["x-request-id"]


def test_healthz_reports_ai_diagnostics_without_secrets(
    settings: Settings, question_bank: QuestionBank
) -> None:
    """운영 진단: 모델명·마지막 오류 코드·성공 횟수만 노출하고 키는 절대 노출하지 않는다."""

    class NotFoundModelError(Exception):
        code = 404
        status = "NOT_FOUND"

    class FailingModels:
        def generate_content(self, **_kw: object) -> None:
            raise NotFoundModelError("models/x is not found; key=secret-key")

    gemini = GoogleGeminiClient(
        "secret-key", "gemini-3.6-flash", sleep=lambda _s: None, models_api=FailingModels()
    )
    app = create_app(
        settings, question_bank=question_bank, gemini_client=gemini, build_variants_on_startup=False
    )
    with TestClient(app) as client:
        before = client.get("/healthz").json()["ai"]
        assert before == {
            "configured": True,
            "apiKeySet": False,
            "model": "gemini-3.6-flash",
            "lastError": None,
            "okCalls": 0,
        }
        with pytest.raises(GeminiError):
            gemini.generate_text("sys", [ChatTurn("user", "hi")])
        after = client.get("/healthz").json()
        assert after["ai"]["lastError"] == "NotFoundModelError 404 NOT_FOUND"
        assert "secret" not in str(after)


def test_cors_allows_whitelisted_origin(client: TestClient) -> None:
    response = client.options(
        "/healthz",
        headers={
            "Origin": "https://example.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Session-Token",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://example.vercel.app"
    assert "x-session-token" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


def test_cors_rejects_unknown_origin(client: TestClient) -> None:
    response = client.get("/healthz", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def _preflight(client: TestClient, origin: str) -> httpx.Response:
    return client.options(
        "/api/v1/sessions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_cors_allows_frontend_url_even_without_allowed_origins(settings: Settings) -> None:
    """운영 실수 방지: Render 에 ALLOWED_ORIGINS 를 안 넣어도 배포된 Vercel 프론트는 붙어야 한다."""
    local_only = settings.model_copy(update={"allowed_origins": "http://localhost:5173"})
    with TestClient(create_app(local_only)) as client:
        response = _preflight(client, "https://asantowerdefence.vercel.app")
        assert response.status_code == 200
        assert (
            response.headers["access-control-allow-origin"] == "https://asantowerdefence.vercel.app"
        )


def test_cors_allows_same_project_vercel_preview(client: TestClient) -> None:
    response = _preflight(client, "https://asantowerdefence-git-main-abc123.vercel.app")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"].endswith(".vercel.app")


@pytest.mark.parametrize(
    "origin",
    [
        "https://other-project.vercel.app",
        "http://asantowerdefence.vercel.app",  # https 만
        "https://asantowerdefence.vercel.app.evil.example",
    ],
)
def test_cors_rejects_other_vercel_like_origins(client: TestClient, origin: str) -> None:
    response = _preflight(client, origin)
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_merge_and_dedupe() -> None:
    settings = Settings(
        _env_file=None,
        allowed_origins="http://localhost:5173,https://asantowerdefence.vercel.app",
        frontend_url="https://asantowerdefence.vercel.app/",
    )
    assert settings.cors_origins == ["http://localhost:5173", "https://asantowerdefence.vercel.app"]
    assert settings.public_frontend_url == "https://asantowerdefence.vercel.app"


def test_unknown_api_route_returns_json_404(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_docs_disabled_in_production() -> None:
    production = Settings(
        _env_file=None,
        app_env="production",
        session_secret="p" * 40,
        admin_token="real-admin-token",
        rate_limit_enabled=False,
    )
    with TestClient(create_app(production)) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_docs_enabled_in_development(client: TestClient) -> None:
    assert client.get("/openapi.json").status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {},  # 자리표시자 SESSION_SECRET + 빈 ADMIN_TOKEN
        {"session_secret": "short", "admin_token": "x"},
        {"session_secret": "s" * 40, "admin_token": "change-me-admin-token"},
    ],
)
def test_production_rejects_placeholder_secrets(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", **overrides)


def test_allowed_origins_parsing() -> None:
    settings = Settings(_env_file=None, allowed_origins=" http://a.test , https://b.test,,")
    assert settings.allowed_origins_list == ["http://a.test", "https://b.test"]


def test_root_redirects_to_frontend_or_explains(client: TestClient, settings: Settings) -> None:
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "https://example.vercel.app"

    # ALLOWED_ORIGINS 가 로컬뿐이어도 FRONTEND_URL 기본값(Vercel)으로 보낸다
    local_only = settings.model_copy(update={"allowed_origins": "http://localhost:5173"})
    with TestClient(create_app(local_only)) as local_client:
        response = local_client.get("/", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "https://asantowerdefence.vercel.app"

    # 공개 프론트 주소가 아예 없으면 안내 JSON
    no_front = settings.model_copy(
        update={"allowed_origins": "http://localhost:5173", "frontend_url": ""}
    )
    with TestClient(create_app(no_front)) as local_client:
        body = local_client.get("/").json()
        assert body["status"] == "ok" and "healthz" in body["hint"]
