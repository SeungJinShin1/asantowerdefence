"""JSON 구조화 로그 + 요청 로그 미들웨어 (docs/01_architecture.md §6).

보안(프로덕션 에러 로그 처리): 로그는 stdout에 JSON 한 줄씩 남기고 Render가 수집한다.
필드: time, level, request_id, path, status, duration_ms, session_id(있으면), message.
채팅 원문·세션 토큰·비밀값은 절대 로그에 넣지 않는다(Phase 4의 chat 라우터는 길이·토픽·소요시간만 기록).
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import UTC, datetime
from typing import IO, Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# LogRecord의 extra로 붙는 키 중 JSON에 실을 것들
LOG_EXTRA_KEYS = (
    "request_id",
    "method",
    "path",
    "status",
    "duration_ms",
    "session_id",
    "code",
    "detail",
)
_HANDLER_MARK = "_defence_json_handler"

request_logger = logging.getLogger("app.request")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in LOG_EXTRA_KEYS:
            value = record.__dict__.get(key)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO", stream: IO[str] | None = None) -> None:
    """루트 로거에 JSON 핸들러를 (한 번만) 단다. 다른 핸들러(pytest caplog 등)는 건드리지 않는다."""
    root = logging.getLogger()
    root.handlers = [h for h in root.handlers if not getattr(h, _HANDLER_MARK, False)]
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonFormatter())
    setattr(handler, _HANDLER_MARK, True)
    root.addHandler(handler)
    root.setLevel(level.upper())
    # uvicorn 로그도 루트 JSON 핸들러로 보낸다. 요청 로그는 미들웨어가 남기므로 access 로그는 끈다.
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = []
        uv_logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True


class RequestLogMiddleware:
    """요청마다 request_id를 만들고, 응답 헤더 X-Request-ID와 JSON 로그 한 줄을 남기는 순수 ASGI 미들웨어."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex[:16]
        state: dict[str, Any] = scope.setdefault("state", {})
        state["request_id"] = request_id
        started = time.perf_counter()
        status = {"code": 500}  # 예외로 응답이 시작되지 않으면 500으로 기록

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                message.setdefault("headers", [])
                # 예외 핸들러가 이미 붙였으면 중복 추가하지 않는다
                MutableHeaders(scope=message).setdefault("X-Request-ID", request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            request_logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status["code"],
                    "duration_ms": duration_ms,
                    "session_id": state.get("session_id"),
                },
            )
