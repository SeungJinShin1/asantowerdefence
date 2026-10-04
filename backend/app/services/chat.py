"""학습 챗봇 — docs/03 POST /chat, docs/04 §5·§6.

보안: 사용자 메시지는 항상 user 역할로만 전달하고 시스템 프롬프트에 끼워 넣지 않는다(프롬프트 주입 완화).
chatbotContext 는 서버에서만 프롬프트에 넣고 응답으로 내려보내지 않는다.
로그에는 채팅 원문을 남기지 않는다(주제·턴 수·길이만). 응답은 800자로 자르고 URL·전화번호를 지운다.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Sequence
from pathlib import Path

from app.core.errors import AiUnavailableError, NotFoundError, ValidationFailedError
from app.domain.models import Topic
from app.routers.schemas import ChatMessage, ChatResponse
from app.services.gemini_client import ChatTurn, GeminiClient, GeminiError
from app.services.question_bank import QuestionBank

logger = logging.getLogger("app.chat")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "chat_system.txt"
MAX_TURNS = 6
MAX_REPLY_CHARS = 800
SUGGESTED_COUNT = 3
CHAT_PER_SESSION_LIMIT = 40
CONTEXT_MAX_CHARS = 4000

_URL = re.compile(r"(https?://\S+|www\.\S+)", re.IGNORECASE)
_PHONE = re.compile(r"\d{2,3}-?\d{3,4}-?\d{4}")


def sanitize_text(text: str, limit: int) -> str:
    """URL·전화번호 제거, 공백 정리, 길이 제한(가능하면 문장 끝에서 자름)."""
    cleaned = _PHONE.sub("", _URL.sub("", text)).strip()
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if len(cleaned) <= limit:
        return cleaned
    cut = cleaned[:limit]
    boundary = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"), cut.rfind("요"))
    return cut[: boundary + 1] if boundary > limit * 0.5 else cut


def trim_turns(messages: Sequence[ChatMessage]) -> list[ChatTurn]:
    """최근 MAX_TURNS 만 남긴다. 마지막은 반드시 사용자 질문이어야 한다."""
    turns = [
        ChatTurn(role=m.role, content=m.content.strip()) for m in messages if m.content.strip()
    ]
    if not turns or turns[-1].role != "user":
        raise ValidationFailedError("마지막 메시지는 질문이어야 해요.")
    return turns[-MAX_TURNS:]


def build_system_prompt(template: str, topic: Topic) -> str:
    cards = "\n".join(f"- {c.title}: {c.body}" for c in topic.cards)
    context = f"{topic.chatbot_context}\n\n[학습 카드]\n{cards}".strip()[:CONTEXT_MAX_CHARS]
    return template.format(
        title=topic.title, subtitle=topic.subtitle, era=topic.era, context=context
    )


def suggest_questions(topic: Topic, asked: Iterable[str]) -> list[str]:
    """키워드·카드 제목으로 추천 질문 3개. 이미 물어본 것은 뺀다."""
    asked_set = {" ".join(a.split()) for a in asked}
    candidates = [f"{kw}이(가) 뭐예요?" for kw in topic.keywords]
    candidates += [f"{card.title} 이야기 더 들려줘요" for card in topic.cards]
    seen: set[str] = set()
    result: list[str] = []
    for text in candidates:
        if text in asked_set or text in seen:
            continue
        seen.add(text)
        result.append(text)
        if len(result) == SUGGESTED_COUNT:
            break
    return result


class ChatService:
    def __init__(
        self,
        question_bank: QuestionBank,
        client: GeminiClient | None,
        *,
        prompt_path: Path = PROMPT_PATH,
    ) -> None:
        self.bank = question_bank
        self.client = client
        self.template = prompt_path.read_text(encoding="utf-8")

    def chat(self, topic_id: str, messages: Sequence[ChatMessage]) -> ChatResponse:
        topic = self.bank.get_topic(topic_id)
        if topic is None:
            raise NotFoundError("없는 주제예요.")
        turns = trim_turns(messages)
        if self.client is None:
            raise AiUnavailableError()
        system = build_system_prompt(self.template, topic)
        try:
            raw_reply = self.client.generate_text(system, turns)
        except GeminiError as exc:
            raise AiUnavailableError(detail=str(exc)[:120]) from None
        reply = sanitize_text(raw_reply, MAX_REPLY_CHARS)
        suggested = suggest_questions(topic, (t.content for t in turns if t.role == "user"))
        logger.info(
            "chat_done",
            extra={"detail": f"topic={topic_id} turns={len(turns)} reply_len={len(reply)}"},
        )
        return ChatResponse(reply=reply, suggested=suggested)
