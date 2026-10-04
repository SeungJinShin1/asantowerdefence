"""오류 형식과 전역 예외 핸들러 (docs/03_api_contract.md '공통 > 오류 형식').

보안(프로덕션 에러 로그 처리): 클라이언트에는 {"error": {"code", "message"}}만 내려보낸다.
스택·내부 메시지·검증 상세는 request_id와 함께 로그에만 남기고 응답에는 절대 넣지 않는다.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")

GENERIC_MESSAGE = "잠시 문제가 생겼어요. 다시 시도해 주세요."


class AppError(Exception):
    """앱이 의도적으로 던지는 오류. 하위 클래스가 status_code / code / 기본 메시지를 정한다."""

    status_code: int = 500
    code: str = "INTERNAL"
    default_message: str = GENERIC_MESSAGE

    def __init__(self, message: str | None = None, *, detail: Any = None) -> None:
        self.message = message or self.default_message
        self.detail = detail  # 로그 전용 — 응답에 넣지 않는다
        super().__init__(self.message)


class ValidationFailedError(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"
    default_message = "입력값이 올바르지 않아요."


class UnauthorizedError(AppError):
    status_code = 401
    code = "UNAUTHORIZED"
    default_message = "세션 토큰이 올바르지 않아요. 처음부터 다시 시작해 주세요."


class SessionExpiredError(AppError):
    status_code = 401
    code = "SESSION_EXPIRED"
    default_message = "세션이 만료되었어요. 처음부터 다시 시작해 주세요."


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"
    default_message = "찾을 수 없어요."


class ConflictError(AppError):
    """같은 quizId 재답변, finished 세션에 대한 answer/events 등 — 계약상 409 + VALIDATION_ERROR."""

    status_code = 409
    code = "VALIDATION_ERROR"
    default_message = "이미 처리된 요청이에요."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    default_message = "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."


class ScoreRejectedError(AppError):
    status_code = 400
    code = "SCORE_REJECTED"
    default_message = "점수 검증에 실패했어요. 처음부터 다시 시작해 주세요."


class NicknameRejectedError(AppError):
    status_code = 400
    code = "NICKNAME_REJECTED"
    default_message = "사용할 수 없는 닉네임이에요. 다른 닉네임을 골라 주세요."


class AiUnavailableError(AppError):
    status_code = 503
    code = "AI_UNAVAILABLE"
    default_message = "AI 선생님이 잠시 쉬고 있어요. 조금 뒤에 다시 시도해 주세요."


_STATUS_TO_CODE = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "UNAUTHORIZED",
    404: "NOT_FOUND",
    409: "VALIDATION_ERROR",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    503: "AI_UNAVAILABLE",
}
_STATUS_TO_MESSAGE = {
    401: UnauthorizedError.default_message,
    403: UnauthorizedError.default_message,
    404: NotFoundError.default_message,
    422: ValidationFailedError.default_message,
    429: RateLimitedError.default_message,
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def error_response(
    status_code: int, code: str, message: str, request_id: str | None = None
) -> JSONResponse:
    headers = {"X-Request-ID": request_id} if request_id else None
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=headers,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        logger.warning(
            "app_error",
            extra={
                "request_id": _request_id(request),
                "path": request.url.path,
                "status": exc.status_code,
                "code": exc.code,
                "detail": None if exc.detail is None else str(exc.detail)[:500],
            },
        )
        return error_response(exc.status_code, exc.code, exc.message, _request_id(request))

    @app.exception_handler(RequestValidationError)
    async def _handle_request_validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        logger.info(
            "validation_error",
            extra={
                "request_id": _request_id(request),
                "path": request.url.path,
                "status": 422,
                "code": "VALIDATION_ERROR",
                "detail": str(exc.errors())[:500],
            },
        )
        return error_response(
            422, "VALIDATION_ERROR", ValidationFailedError.default_message, _request_id(request)
        )

    @app.exception_handler(RateLimitExceeded)
    async def _handle_rate_limit(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        logger.info(
            "rate_limited",
            extra={
                "request_id": _request_id(request),
                "path": request.url.path,
                "status": 429,
                "code": "RATE_LIMITED",
            },
        )
        return error_response(
            429, "RATE_LIMITED", RateLimitedError.default_message, _request_id(request)
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        fallback_code = "VALIDATION_ERROR" if exc.status_code < 500 else "INTERNAL"
        code = _STATUS_TO_CODE.get(exc.status_code, fallback_code)
        message = _STATUS_TO_MESSAGE.get(exc.status_code, GENERIC_MESSAGE)
        return error_response(exc.status_code, code, message, _request_id(request))

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # 스택은 로그에만. 사용자에게는 일반 메시지.
        logger.exception(
            "unhandled_error",
            extra={
                "request_id": _request_id(request),
                "path": request.url.path,
                "status": 500,
                "code": "INTERNAL",
            },
        )
        return error_response(500, "INTERNAL", GENERIC_MESSAGE, _request_id(request))
