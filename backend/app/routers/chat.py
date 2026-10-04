"""POST /chat — 학습 챗봇 (docs/03).

보안 5항목:
- 라우트 보호: X-Session-Token 필수(경로에 세션 id 가 없으므로 토큰의 세션을 쓴다), IP 20/분 + 세션당 40회/판(docs/04 §4).
- DB 보안: 세션 저장소를 통해 호출 횟수만 기록한다. 채팅 내용은 저장하지 않는다.
- ENV 노출 방지: Gemini 키·모델명은 서비스 조립 시에만 쓰이고 응답에 없다.
- 서버 측 검증: 메시지 수·길이·역할은 스키마가, 턴 자르기·후처리는 ChatService 가 수행. chatbotContext 는 서버에만.
- 에러 로그: Gemini 실패는 AI_UNAVAILABLE(503) 로 매핑, 로그에 채팅 원문 없음.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.errors import RateLimitedError
from app.core.security import limiter
from app.domain.models import Session
from app.routers.deps import get_chat_service, get_session_from_token, get_session_store
from app.routers.schemas import ChatRequest, ChatResponse
from app.services.chat import CHAT_PER_SESSION_LIMIT, ChatService
from app.services.session_store import SessionStore

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def chat(
    request: Request,
    body: ChatRequest,
    session: Session = Depends(get_session_from_token),
    service: ChatService = Depends(get_chat_service),
    store: SessionStore = Depends(get_session_store),
) -> ChatResponse:
    if session.chat_count >= CHAT_PER_SESSION_LIMIT:
        raise RateLimitedError("이번 판에서 물어볼 수 있는 횟수를 다 썼어요. 게임을 계속해 볼까요?")
    response = service.chat(body.topic_id, body.messages)
    session.chat_count += 1
    store.save(session)
    return response
