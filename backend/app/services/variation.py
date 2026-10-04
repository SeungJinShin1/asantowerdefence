"""변형 문제 생성·검증·캐시 — docs/04 §6, docs/03 admin/variants, content/README.md '변형 출제 규칙'.

보안(서버 측 검증·절대 금지 규칙): 변형은 fact·정답 텍스트를 고정하고 검증기를 통과한 것만 캐시한다.
생성은 시작 시 백그라운드와 관리자 엔드포인트에서만 — 사용자 요청 경로(웨이브 진행 중)에서는 Gemini 를 부르지 않는다.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from app.domain.models import Question, Topic, Variant
from app.services.gemini_client import GeminiClient, GeminiError
from app.services.question_bank import QuestionBank

logger = logging.getLogger("app.variation")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "variation_system.txt"
MAX_STEM_CHARS = 80
MAX_OPTION_CHARS = 30
OPTION_COUNT = 4
MAX_VARIANTS_PER_CALL = 5
CONTEXT_MAX_CHARS = 1500


class VariantValidationError(ValueError):
    """검증 실패 사유(로그·테스트용). 사용자에게 노출되지 않는다."""


def _normalize(text: str) -> str:
    return " ".join(text.split()).casefold()


def validate_variant(
    raw: Any, question: Question, banned_words: Iterable[str] = ()
) -> tuple[str, list[str]]:
    """Gemini 가 낸 항목 하나를 검증해 (stem, options) 를 돌려준다. 실패하면 VariantValidationError."""
    if not isinstance(raw, dict):
        raise VariantValidationError("항목이 객체가 아님")
    stem = raw.get("stem")
    options = raw.get("options")
    if not isinstance(stem, str) or not isinstance(options, list):
        raise VariantValidationError("stem/options 형식 오류")
    stem = " ".join(stem.split())
    cleaned = [" ".join(str(o).split()) for o in options]
    if len(cleaned) != OPTION_COUNT or any(not o for o in cleaned) or not stem:
        raise VariantValidationError("보기 4개가 아니거나 빈 값")
    answer = question.options[question.answer_index].strip()
    if cleaned[0] != answer:
        raise VariantValidationError("정답 텍스트 불일치")
    if len({_normalize(o) for o in cleaned}) != OPTION_COUNT:
        raise VariantValidationError("보기 중복")
    if len(stem) > MAX_STEM_CHARS:
        raise VariantValidationError("문제 길이 초과")
    if any(len(o) > MAX_OPTION_CHARS for o in cleaned):
        raise VariantValidationError("보기 길이 초과")
    if _normalize(stem) == _normalize(question.stem):
        raise VariantValidationError("원본과 같은 문장")
    haystack = _normalize(stem + " " + " ".join(cleaned))
    for word in banned_words:
        if word and word.casefold() in haystack:
            raise VariantValidationError("금칙어 포함")
    return stem, cleaned


# ---------- 캐시 ----------


class VariantCache(Protocol):
    def get(self, question_id: str) -> list[Variant]: ...

    def put(self, variants: Iterable[Variant]) -> None: ...

    def by_topic(self, topic_id: str) -> dict[str, list[Variant]]: ...

    def all(self) -> list[Variant]: ...

    def clear(self) -> None: ...

    def last_built_at(self) -> datetime | None: ...

    def mark_built(self, at: datetime) -> None: ...


class InMemoryVariantCache:
    """Phase 1~4용 메모리 캐시. Phase 5 에서 Firestore 구현이 같은 프로토콜을 따른다."""

    def __init__(self) -> None:
        self._by_question: dict[str, list[Variant]] = {}
        self._built_at: datetime | None = None
        self._lock = threading.Lock()

    def get(self, question_id: str) -> list[Variant]:
        with self._lock:
            return list(self._by_question.get(question_id, []))

    def put(self, variants: Iterable[Variant]) -> None:
        with self._lock:
            for v in variants:
                bucket = self._by_question.setdefault(v.question_id, [])
                if all(existing.variant_id != v.variant_id for existing in bucket):
                    bucket.append(v)

    def by_topic(self, topic_id: str) -> dict[str, list[Variant]]:
        with self._lock:
            return {
                qid: [v for v in vs if v.topic_id == topic_id]
                for qid, vs in self._by_question.items()
                if any(v.topic_id == topic_id for v in vs)
            }

    def all(self) -> list[Variant]:
        with self._lock:
            return [v for vs in self._by_question.values() for v in vs]

    def clear(self) -> None:
        with self._lock:
            self._by_question.clear()
            self._built_at = None

    def last_built_at(self) -> datetime | None:
        return self._built_at

    def mark_built(self, at: datetime) -> None:
        self._built_at = at


# ---------- 생성 서비스 ----------


@dataclass
class BuildReport:
    total: int = 0
    built: int = 0
    failed: int = 0


def utcnow() -> datetime:
    return datetime.now(UTC)


class VariationService:
    def __init__(
        self,
        question_bank: QuestionBank,
        client: GeminiClient | None,
        cache: VariantCache,
        *,
        variants_per_question: int = 2,
        prompt_path: Path = PROMPT_PATH,
        banned_words: Sequence[str] = (),
        clock=utcnow,
    ) -> None:
        self.bank = question_bank
        self.client = client
        self.cache = cache
        self.variants_per_question = max(1, min(variants_per_question, MAX_VARIANTS_PER_CALL))
        self.system_prompt = prompt_path.read_text(encoding="utf-8")
        self.banned_words = tuple(banned_words)
        self.clock = clock
        self._thread: threading.Thread | None = None

    @property
    def building(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def ready(self) -> bool:
        return self.cache.last_built_at() is not None

    def build_for_question(self, question: Question) -> list[Variant]:
        """문항 하나의 변형을 생성·검증해 캐시에 넣고, 통과한 것만 돌려준다. 실패는 로그만 남긴다."""
        if self.client is None:
            return []
        topic = self.bank.get_topic(question.topic_id)
        try:
            raw = self.client.generate_json(self.system_prompt, self._user_prompt(question, topic))
        except GeminiError as exc:
            logger.warning("variant_generation_failed", extra={"code": str(exc)[:80]})
            return []
        items = raw.get("variants") if isinstance(raw, dict) else raw
        if not isinstance(items, list):
            logger.warning("variant_generation_failed", extra={"code": "shape"})
            return []
        existing = len(self.cache.get(question.id))
        valid: list[Variant] = []
        rejected = 0
        for item in items[:MAX_VARIANTS_PER_CALL]:
            try:
                stem, options = validate_variant(item, question, self.banned_words)
            except VariantValidationError:
                rejected += 1
                continue
            valid.append(
                Variant(
                    variant_id=f"{question.id}-v{existing + len(valid) + 1}",
                    question_id=question.id,
                    topic_id=question.topic_id,
                    stem=stem,
                    options=options,
                    correct_index=0,
                    model=self.client.model,
                    created_at=self.clock(),
                    valid=True,
                )
            )
        self.cache.put(valid)
        logger.info(
            "variants_built",
            extra={"detail": f"question={question.id} valid={len(valid)} rejected={rejected}"},
        )
        return valid

    def build_all(self, topic_id: str | None = None) -> BuildReport:
        report = BuildReport()
        questions = [q for q in self.bank.questions if topic_id is None or q.topic_id == topic_id]
        report.total = len(questions)
        for question in questions:
            built = self.build_for_question(question)
            if built:
                report.built += 1
            else:
                report.failed += 1
        self.cache.mark_built(self.clock())
        return report

    def start_background_build(self) -> threading.Thread | None:
        """시작 시·관리자 요청 시 백그라운드 생성(요청을 막지 않음). 클라이언트가 없거나 이미 진행 중이면 None."""
        if self.client is None or self.building:
            return None
        self._thread = threading.Thread(target=self.build_all, name="variants-build", daemon=True)
        self._thread.start()
        return self._thread

    def wait(self, timeout: float | None = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def status(self) -> dict[str, Any]:
        per_topic: dict[str, int] = {t.id: 0 for t in self.bank.topics}
        with_variants = 0
        for question in self.bank.questions:
            if any(v.valid for v in self.cache.get(question.id)):
                with_variants += 1
                per_topic[question.topic_id] = per_topic.get(question.topic_id, 0) + 1
        return {
            "total": len(self.bank),
            "with_variants": with_variants,
            "per_topic": per_topic,
            "last_built_at": self.cache.last_built_at(),
            "building": self.building,
        }

    def _user_prompt(self, question: Question, topic: Topic | None) -> str:
        context = (topic.chatbot_context if topic else "")[:CONTEXT_MAX_CHARS]
        answer = question.options[question.answer_index]
        return (
            f"[원본 문제] {question.stem}\n"
            f"[정답 텍스트] {answer}\n"
            f"[근거] {question.fact}\n"
            f"[근거 자료]\n{context}\n\n"
            f"위 사실을 묻는 새 문제를 {self.variants_per_question}개 만들어 주세요."
        )
