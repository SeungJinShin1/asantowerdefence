"""API 라우터 묶음. main.py가 `/api/v1` 아래에 include 한다."""

from fastapi import APIRouter

from app.routers import admin, chat, quiz, review, sessions, topics

api_router = APIRouter()
api_router.include_router(topics.router)
api_router.include_router(sessions.router)
api_router.include_router(quiz.router)
api_router.include_router(chat.router)
api_router.include_router(review.router)
api_router.include_router(admin.router)
