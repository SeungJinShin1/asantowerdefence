"""1.1 — 앱 뼈대: /healthz, CORS 화이트리스트, production 안전장치."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app


def test_healthz_matches_contract(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0", "variantsReady": False}
    assert response.headers["x-request-id"]


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

    local_only = settings.model_copy(update={"allowed_origins": "http://localhost:5173"})
    with TestClient(create_app(local_only)) as local_client:
        body = local_client.get("/").json()
        assert body["status"] == "ok" and "healthz" in body["hint"]
