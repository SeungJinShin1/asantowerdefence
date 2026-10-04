"""4.3 — 관리자 엔드포인트: X-Admin-Token, 재생성 202, 상태 JSON (docs/03 admin/variants)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from tests.conftest import TEST_ADMIN_TOKEN

from app.core.config import Settings
from app.main import create_app
from app.services.gemini_client import FakeGeminiClient
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore

API = "/api/v1"
GOOD = {
    "stem": "'끓는 우물'이라는 뜻의 백제 때 온양 이름은?",
    "options": ["탕정(湯井)", "신창", "아산", "도고"],
}


@pytest.fixture
def fake() -> FakeGeminiClient:
    return FakeGeminiClient([{"variants": [GOOD]}])


@pytest.fixture
def admin_client(
    settings: Settings,
    question_bank: QuestionBank,
    session_store: InMemorySessionStore,
    fake: FakeGeminiClient,
) -> Iterator[TestClient]:
    app = create_app(
        settings,
        question_bank=question_bank,
        session_store=session_store,
        gemini_client=fake,
        build_variants_on_startup=False,
    )
    with TestClient(app) as client:
        yield client


ADMIN = {"X-Admin-Token": TEST_ADMIN_TOKEN}


def test_admin_requires_token(admin_client: TestClient) -> None:
    assert admin_client.get(f"{API}/admin/variants/status").status_code == 401
    wrong = admin_client.get(f"{API}/admin/variants/status", headers={"X-Admin-Token": "nope"})
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "UNAUTHORIZED"


def test_status_shape_and_rebuild_flow(admin_client: TestClient) -> None:
    before = admin_client.get(f"{API}/admin/variants/status", headers=ADMIN)
    assert before.status_code == 200
    assert set(before.json()) == {"total", "withVariants", "perTopic", "lastBuiltAt", "building"}
    assert before.json()["total"] == 75
    assert before.json()["withVariants"] == 0
    assert admin_client.get("/healthz").json()["variantsReady"] is False

    queued = admin_client.post(f"{API}/admin/variants/rebuild", headers=ADMIN)
    assert queued.status_code == 202
    assert queued.json() == {"queued": True}

    admin_client.app.state.variation.wait(timeout=10)  # type: ignore[attr-defined]
    after = admin_client.get(f"{API}/admin/variants/status", headers=ADMIN).json()
    assert after["withVariants"] == 1  # 가짜 응답은 하나뿐
    assert after["perTopic"]["onyang"] == 1
    assert after["lastBuiltAt"] is not None
    assert after["building"] is False
    assert admin_client.get("/healthz").json()["variantsReady"] is True


def test_rebuild_without_gemini_is_503(client: TestClient) -> None:
    response = client.post(f"{API}/admin/variants/rebuild", headers=ADMIN)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_UNAVAILABLE"
    assert client.get(f"{API}/admin/variants/status", headers=ADMIN).status_code == 200
