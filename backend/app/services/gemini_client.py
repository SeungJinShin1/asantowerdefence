"""Gemini 래퍼 (google-genai) — docs/04 §6: 타임아웃 12초, 재시도 1회(지수 백오프), JSON 응답 파싱, 목 주입 가능.

보안(ENV 노출 방지·에러 로그): API 키는 Settings 에서만 받아 SDK 에 넘기고 로그·예외 메시지에 넣지 않는다.
모델명은 GEMINI_MODEL 환경변수(하드코딩 금지). 프롬프트·응답 원문은 로그에 남기지 않는다(길이·종류만).
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

logger = logging.getLogger("app.gemini")

DEFAULT_TIMEOUT_SEC = 12.0
DEFAULT_RETRIES = 1
DEFAULT_BACKOFF_SEC = 0.8

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


class GeminiError(Exception):
    """호출 실패(타임아웃·오류 응답·빈 응답·JSON 파싱 실패). 메시지에 프롬프트 원문을 넣지 않는다."""


@dataclass(frozen=True)
class ChatTurn:
    role: Literal["user", "assistant"]
    content: str


class GeminiClient(Protocol):
    @property
    def model(self) -> str: ...

    def generate_text(
        self, system: str, turns: Sequence[ChatTurn], *, temperature: float = 0.7
    ) -> str: ...

    def generate_json(self, system: str, prompt: str, *, temperature: float = 0.8) -> Any: ...


def parse_json(text: str) -> Any:
    """코드 펜스(```json … ```)를 벗기고 JSON 으로 파싱한다. 실패하면 GeminiError(원문 미포함)."""
    cleaned = _FENCE.sub("", text.strip()).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise GeminiError(f"JSON 파싱 실패: {exc.msg}") from None


class GoogleGeminiClient:
    """실제 Gemini 호출. SDK 클라이언트는 첫 호출 때 만든다(테스트는 models_api 를 주입)."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        timeout_sec: float = DEFAULT_TIMEOUT_SEC,
        retries: int = DEFAULT_RETRIES,
        backoff_sec: float = DEFAULT_BACKOFF_SEC,
        sleep: Callable[[float], None] = time.sleep,
        models_api: Any | None = None,
    ) -> None:
        if not model:
            raise ValueError("GEMINI_MODEL 환경변수가 비어 있어요.")
        if not api_key and models_api is None:
            raise ValueError("GEMINI_API_KEY 환경변수가 비어 있어요.")
        self._api_key = api_key
        self._model = model
        self._timeout_ms = int(timeout_sec * 1000)
        self._retries = retries
        self._backoff = backoff_sec
        self._sleep = sleep
        self._models = models_api

    @property
    def model(self) -> str:
        return self._model

    def _api(self) -> Any:
        if self._models is None:
            from google import genai
            from google.genai import types

            client = genai.Client(
                api_key=self._api_key, http_options=types.HttpOptions(timeout=self._timeout_ms)
            )
            self._models = client.models
        return self._models

    def generate_text(
        self, system: str, turns: Sequence[ChatTurn], *, temperature: float = 0.7
    ) -> str:
        from google.genai import types

        contents = [
            types.Content(
                role="user" if turn.role == "user" else "model",
                parts=[types.Part.from_text(text=turn.content)],
            )
            for turn in turns
        ]
        config = types.GenerateContentConfig(system_instruction=system, temperature=temperature)
        response = self._call(
            lambda: self._api().generate_content(
                model=self._model, contents=contents, config=config
            )
        )
        text = getattr(response, "text", None)
        if not text or not text.strip():
            raise GeminiError("빈 응답")
        logger.info("gemini_text", extra={"detail": f"turns={len(turns)} reply_len={len(text)}"})
        return text

    def generate_json(self, system: str, prompt: str, *, temperature: float = 0.8) -> Any:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
        )
        response = self._call(
            lambda: self._api().generate_content(model=self._model, contents=prompt, config=config)
        )
        text = getattr(response, "text", None) or ""
        if not text.strip():
            raise GeminiError("빈 응답")
        return parse_json(text)

    def _call(self, fn: Callable[[], Any]) -> Any:
        last: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                return fn()
            except Exception as exc:  # SDK 예외 종류가 다양하므로 넓게 잡아 GeminiError 로 바꾼다
                last = exc
                if attempt < self._retries:
                    self._sleep(self._backoff * (2**attempt))
        name = type(last).__name__ if last else "Unknown"
        logger.warning("gemini_call_failed", extra={"code": name})
        raise GeminiError(f"Gemini 호출 실패: {name}") from None


class FakeGeminiClient:
    """테스트·오프라인용. 미리 넣어 둔 응답을 순서대로 돌려주고, 받은 프롬프트를 기록한다."""

    def __init__(self, responses: Sequence[Any] = (), *, model: str = "fake-model") -> None:
        self._queue: list[Any] = list(responses)
        self._model = model
        self.calls: list[dict[str, Any]] = []

    @property
    def model(self) -> str:
        return self._model

    def push(self, *responses: Any) -> None:
        self._queue.extend(responses)

    def generate_text(
        self, system: str, turns: Sequence[ChatTurn], *, temperature: float = 0.7
    ) -> str:
        self.calls.append({"kind": "text", "system": system, "turns": list(turns)})
        result = self._next()
        return str(result)

    def generate_json(self, system: str, prompt: str, *, temperature: float = 0.8) -> Any:
        self.calls.append({"kind": "json", "system": system, "prompt": prompt})
        result = self._next()
        return parse_json(result) if isinstance(result, str) else result

    def _next(self) -> Any:
        if not self._queue:
            raise GeminiError("fake: 준비된 응답이 없어요")
        item = self._queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
