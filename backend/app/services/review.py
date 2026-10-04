"""오답 정리 — docs/03 POST /sessions/{id}/review (finished 세션만).

보안(서버 측 검증): 게임이 끝난 뒤이므로 retryCorrectIndex 를 내려보내 로컬에서 다시 풀 수 있게 한다(점수 미반영).
Gemini 실패 시 aiNote·summary 를 빈 문자열로 내려보내되 200 을 유지한다(문제 은행 해설만으로 화면 완성).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.core.errors import ConflictError
from app.domain.models import QuizRecord, Session
from app.routers.schemas import ReviewItem, ReviewResponse
from app.services.chat import sanitize_text
from app.services.gemini_client import GeminiClient, GeminiError
from app.services.question_bank import QuestionBank

logger = logging.getLogger("app.review")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "review_system.txt"
MAX_NOTE_CHARS = 300
MAX_SUMMARY_CHARS = 200
PERFECT_SUMMARY = "틀린 문제가 없어요! 완벽해요."
TIMEOUT_ANSWER = "시간 초과"


class ReviewService:
    def __init__(
        self,
        question_bank: QuestionBank,
        client: GeminiClient | None,
        *,
        prompt_path: Path = PROMPT_PATH,
    ) -> None:
        self.bank = question_bank
        self.client = client
        self.system_prompt = prompt_path.read_text(encoding="utf-8")

    def review(self, session: Session) -> ReviewResponse:
        if not session.is_finished:
            raise ConflictError("게임이 끝난 뒤에 볼 수 있어요.")
        wrong = sorted(
            (q for q in session.quizzes.values() if q.correct is False), key=lambda q: q.served_at
        )
        items = [self._item(q) for q in wrong]
        if not items:
            return ReviewResponse(items=[], summary=PERFECT_SUMMARY)
        notes, summary = self._ask_ai(items, wrong)
        for item in items:
            item.ai_note = notes.get(item.quiz_id, "")
        logger.info(
            "review_done", extra={"detail": f"wrong={len(items)} ai={'y' if summary else 'n'}"}
        )
        return ReviewResponse(items=items, summary=summary)

    def _item(self, quiz: QuizRecord) -> ReviewItem:
        question = self.bank.get_question(quiz.question_id)
        choice = quiz.choice_index
        your_answer = (
            quiz.options[choice]
            if choice is not None and 0 <= choice < len(quiz.options)
            else TIMEOUT_ANSWER
        )
        return ReviewItem(
            quiz_id=quiz.quiz_id,
            stem=quiz.stem,
            your_answer=your_answer,
            correct_answer=quiz.options[quiz.correct_index],
            explanation=question.explanation if question else quiz.explanation,
            ai_note="",
            retry_options=list(quiz.options),
            retry_correct_index=quiz.correct_index,
        )

    def _ask_ai(
        self, items: list[ReviewItem], wrong: list[QuizRecord]
    ) -> tuple[dict[str, str], str]:
        if self.client is None:
            return {}, ""
        lines: list[str] = []
        for index, (item, quiz) in enumerate(zip(items, wrong, strict=True), start=1):
            question = self.bank.get_question(quiz.question_id)
            fact = question.fact if question else ""
            lines.append(
                f"[{index}] quizId={item.quiz_id}\n문제: {item.stem}\n아이의 답: {item.your_answer}\n"
                f"정답: {item.correct_answer}\n해설: {item.explanation}\n근거: {fact}"
            )
        prompt = "틀린 문제 목록입니다.\n\n" + "\n\n".join(lines)
        try:
            raw: Any = self.client.generate_json(self.system_prompt, prompt)
        except GeminiError as exc:
            logger.warning("review_ai_failed", extra={"code": str(exc)[:80]})
            return {}, ""
        if not isinstance(raw, dict):
            return {}, ""
        notes: dict[str, str] = {}
        for entry in raw.get("items", []) if isinstance(raw.get("items"), list) else []:
            if isinstance(entry, dict) and isinstance(entry.get("quizId"), str):
                note = entry.get("aiNote")
                if isinstance(note, str) and note.strip():
                    notes[entry["quizId"]] = sanitize_text(note, MAX_NOTE_CHARS)
        summary_raw = raw.get("summary")
        summary = (
            sanitize_text(summary_raw, MAX_SUMMARY_CHARS) if isinstance(summary_raw, str) else ""
        )
        return notes, summary
