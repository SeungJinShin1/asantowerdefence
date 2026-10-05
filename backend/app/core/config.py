"""환경변수 설정 (pydantic-settings). docs/01_architecture.md §3과 1:1.

보안(ENV 프론트 노출 방지): 비밀값(SESSION_SECRET, ADMIN_TOKEN, GEMINI_API_KEY, 서비스 계정)은
이 모듈을 통해서만 읽고, 어떤 응답·로그·프론트 번들에도 넣지 않는다.
production에서 자리표시자(change-me…) 비밀값이 남아 있으면 기동 자체를 거부한다(fail-fast).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_PREFIX = "change-me"
MIN_SESSION_SECRET_LEN = 32
DEFAULT_CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    app_version: str = "0.1.0"
    allowed_origins: str = "http://localhost:5173"
    # 배포된 프론트(Vercel) 주소. CORS 에 항상 포함되고 루트(/)가 이 주소로 보낸다.
    # ALLOWED_ORIGINS 를 따로 안 넣어도 Vercel 프론트가 Render 백엔드에 붙도록 하는 기본값.
    frontend_url: str = "https://asantowerdefence.vercel.app"
    # Vercel 프리뷰 배포(asantowerdefence-xxxx.vercel.app)만 추가로 허용. 다른 프로젝트 도메인은 불허.
    allowed_origin_regex: str = r"^https://asantowerdefence(-[a-z0-9-]+)?\.vercel\.app$"

    session_secret: str = "change-me-to-a-random-string-at-least-32-chars"
    session_ttl_hours: int = 3
    admin_token: str = ""

    gemini_api_key: str = ""
    gemini_model: str = ""  # 하드코딩 금지 — 반드시 환경변수로

    firebase_service_account_b64: str = ""
    # Render 'Secret Files' 등으로 JSON 파일을 올렸을 때의 경로(예: /etc/secrets/firebase.json). b64 와 둘 중 하나만 있으면 된다
    firebase_service_account_file: str = ""
    firestore_collection_prefix: str = "defence_"

    variants_per_question: int = 2
    booth_mode: bool = True
    sentry_dsn: str = ""

    log_level: str = "INFO"
    rate_limit_enabled: bool = True
    content_dir: Path = DEFAULT_CONTENT_DIR

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def cors_origins(self) -> list[str]:
        """CORS 화이트리스트 = ALLOWED_ORIGINS + FRONTEND_URL (중복 제거, 순서 유지)."""
        merged = [*self.allowed_origins_list, self.frontend_url.strip().rstrip("/")]
        return [o for i, o in enumerate(merged) if o and o not in merged[:i]]

    @property
    def public_frontend_url(self) -> str:
        """사람이 브라우저로 API 루트를 열었을 때 보낼 게임 주소(로컬 주소는 제외)."""
        for origin in self.cors_origins:
            if "localhost" not in origin and "127.0.0.1" not in origin:
                return origin
        return ""

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_model)

    @property
    def firestore_configured(self) -> bool:
        return bool(self.firebase_service_account_b64 or self.firebase_service_account_file)

    @model_validator(mode="after")
    def _reject_placeholder_secrets_in_production(self) -> Settings:
        if not self.is_production:
            return self
        problems: list[str] = []
        if len(self.session_secret) < MIN_SESSION_SECRET_LEN or self.session_secret.startswith(
            PLACEHOLDER_PREFIX
        ):
            problems.append(
                f"SESSION_SECRET은 {MIN_SESSION_SECRET_LEN}자 이상의 무작위 문자열이어야 합니다"
            )
        if not self.admin_token or self.admin_token.startswith(PLACEHOLDER_PREFIX):
            problems.append("ADMIN_TOKEN을 설정해야 합니다")
        if problems:
            raise ValueError("production 설정 오류: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    """프로세스당 한 번만 읽는다. 테스트는 Settings(_env_file=None, ...)를 직접 만들어 create_app에 넘긴다."""
    return Settings()
