"""공통 픽스처. 테스트는 .env를 읽지 않고(_env_file=None) 명시적 Settings로 앱을 만든다."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.question_bank import QuestionBank
from app.services.session_store import InMemorySessionStore

TEST_SESSION_SECRET = "test-secret-" + "x" * 40
TEST_ADMIN_TOKEN = "test-admin-token"
CONTENT_DIR = Path(__file__).resolve().parents[1] / "app" / "content"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        session_secret=TEST_SESSION_SECRET,
        admin_token=TEST_ADMIN_TOKEN,
        rate_limit_enabled=False,
        allowed_origins="http://localhost:5173,https://example.vercel.app",
    )


@pytest.fixture(scope="session")
def question_bank() -> QuestionBank:
    """실제 콘텐츠(75문항·5주제). 읽기 전용이므로 세션 범위로 한 번만 로드한다."""
    return QuestionBank.load(CONTENT_DIR)


@pytest.fixture
def session_store() -> InMemorySessionStore:
    return InMemorySessionStore()


@pytest.fixture
def app(settings: Settings, question_bank: QuestionBank, session_store: InMemorySessionStore):
    return create_app(settings, question_bank=question_bank, session_store=session_store)


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
