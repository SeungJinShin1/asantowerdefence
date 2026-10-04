"""4.1 — Gemini 래퍼: JSON 파싱, 재시도·타임아웃 변환, 목 클라이언트."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.services.gemini_client import (
    ChatTurn,
    FakeGeminiClient,
    GeminiError,
    GoogleGeminiClient,
    parse_json,
)


class FakeModelsApi:
    """SDK 의 client.models 흉내: 미리 정한 결과(또는 예외)를 순서대로 돌려준다."""

    def __init__(self, results: list[Any]) -> None:
        self.results = results
        self.calls: list[dict[str, Any]] = []

    def generate_content(self, *, model: str, contents: Any, config: Any) -> Any:
        self.calls.append({"model": model, "contents": contents, "config": config})
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return SimpleNamespace(text=result)


def make_client(api: FakeModelsApi, sleeps: list[float] | None = None) -> GoogleGeminiClient:
    return GoogleGeminiClient(
        "secret-key",
        "test-model",
        sleep=(sleeps.append if sleeps is not None else lambda _s: None),
        models_api=api,
    )


def test_parse_json_plain_and_fenced() -> None:
    assert parse_json('{"a": 1}') == {"a": 1}
    assert parse_json('```json\n{"a": [1, 2]}\n```') == {"a": [1, 2]}
    assert parse_json("```\n[1]\n```") == [1]


def test_parse_json_invalid_raises_without_echoing_text() -> None:
    with pytest.raises(GeminiError) as info:
        parse_json("정답은 탕정입니다 {not json")
    assert "탕정" not in str(info.value)


def test_generate_text_builds_contents_and_returns_text() -> None:
    api = FakeModelsApi(["안녕! 온양은 백제 때 탕정이라고 불렸어요."])
    client = make_client(api)
    reply = client.generate_text(
        "시스템 규칙",
        [ChatTurn("user", "온양 이름은?"), ChatTurn("assistant", "음"), ChatTurn("user", "다시")],
        temperature=0.3,
    )
    assert reply.startswith("안녕!")
    call = api.calls[0]
    assert call["model"] == "test-model"
    assert call["config"].system_instruction == "시스템 규칙"
    assert call["config"].temperature == 0.3
    roles = [c.role for c in call["contents"]]
    assert roles == ["user", "model", "user"]


def test_generate_json_requests_json_mime_and_parses() -> None:
    api = FakeModelsApi(['```json\n{"variants": []}\n```'])
    client = make_client(api)
    assert client.generate_json("sys", "프롬프트") == {"variants": []}
    assert api.calls[0]["config"].response_mime_type == "application/json"
    assert api.calls[0]["contents"] == "프롬프트"


def test_retries_once_with_backoff_then_succeeds() -> None:
    api = FakeModelsApi([TimeoutError("slow"), "ok"])
    sleeps: list[float] = []
    client = make_client(api, sleeps)
    assert client.generate_text("s", [ChatTurn("user", "q")]) == "ok"
    assert sleeps == [0.8]
    assert len(api.calls) == 2


def test_gives_up_after_retries_with_safe_message() -> None:
    api = FakeModelsApi([RuntimeError("boom 비밀키=abc"), RuntimeError("boom again")])
    sleeps: list[float] = []
    client = make_client(api, sleeps)
    with pytest.raises(GeminiError) as info:
        client.generate_text("s", [ChatTurn("user", "비밀 질문")])
    assert "RuntimeError" in str(info.value)
    assert "비밀" not in str(info.value)
    assert sleeps == [0.8]


def test_empty_response_is_error() -> None:
    api = FakeModelsApi(["   "])
    with pytest.raises(GeminiError):
        make_client(api).generate_text("s", [ChatTurn("user", "q")])


def test_constructor_requires_model_and_key() -> None:
    with pytest.raises(ValueError):
        GoogleGeminiClient("key", "")
    with pytest.raises(ValueError):
        GoogleGeminiClient("", "model")
    assert make_client(FakeModelsApi([])).model == "test-model"


def test_fake_client_queue_and_recording() -> None:
    fake = FakeGeminiClient(["첫 답", {"variants": [1]}])
    assert fake.generate_text("sys", [ChatTurn("user", "q")]) == "첫 답"
    assert fake.generate_json("sys", "p") == {"variants": [1]}
    assert [c["kind"] for c in fake.calls] == ["text", "json"]
    assert fake.calls[0]["turns"] == [ChatTurn("user", "q")]
    with pytest.raises(GeminiError):
        fake.generate_text("sys", [])
    fake.push(GeminiError("down"), '{"ok": true}')
    with pytest.raises(GeminiError):
        fake.generate_text("sys", [])
    assert fake.generate_json("sys", "p") == {"ok": True}
