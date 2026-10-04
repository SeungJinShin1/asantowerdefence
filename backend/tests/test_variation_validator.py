"""4.3 — 변형 검증기와 생성 서비스(목): 잘못된 JSON·정답 불일치·중복·길이 초과는 폐기."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.domain.models import Question
from app.services.gemini_client import FakeGeminiClient, GeminiError
from app.services.question_bank import QuestionBank
from app.services.variation import (
    InMemoryVariantCache,
    VariantValidationError,
    VariationService,
    validate_variant,
)

ORIGINAL = Question(
    id="ony-01",
    topic_id="onyang",
    difficulty=1,
    stem="백제 시대에 온양을 부르던 이름은 무엇일까요?",
    options=["탕정(湯井)", "온수(溫水)", "온양(溫陽)", "온창(溫昌)"],
    answer_index=0,
    fact="백제 시대에는 온양을 탕정(湯井)이라 불렀다.",
    explanation="탕정 → 온수 → 온양",
)

GOOD = {
    "stem": "'끓는 우물'이라는 뜻의 백제 때 온양 이름은?",
    "options": ["탕정(湯井)", "신창", "아산", "도고"],
}


def test_valid_variant_passes_and_is_normalized() -> None:
    stem, options = validate_variant(
        {
            "stem": "  '끓는   우물'이라는 뜻의 백제 때 온양 이름은? ",
            "options": [" 탕정(湯井) ", "신창", "아산", "도고"],
        },
        ORIGINAL,
    )
    assert stem == "'끓는 우물'이라는 뜻의 백제 때 온양 이름은?"
    assert options == ["탕정(湯井)", "신창", "아산", "도고"]


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("문자열", "객체"),
        ({"stem": "x"}, "형식"),
        ({**GOOD, "options": ["탕정(湯井)", "신창", "아산"]}, "4개"),
        ({**GOOD, "options": ["온수(溫水)", "신창", "아산", "도고"]}, "정답"),
        ({**GOOD, "options": ["탕정(湯井)", "신창", "신창 ", "도고"]}, "중복"),
        ({**GOOD, "options": ["탕정(湯井)", "탕정(湯井)", "아산", "도고"]}, "중복"),
        ({**GOOD, "stem": "가" * 81}, "문제 길이"),
        ({**GOOD, "options": ["탕정(湯井)", "나" * 31, "아산", "도고"]}, "보기 길이"),
        ({**GOOD, "stem": ORIGINAL.stem}, "원본"),
        ({**GOOD, "options": ["탕정(湯井)", "", "아산", "도고"]}, "빈"),
    ],
)
def test_invalid_variants_are_rejected(raw: object, reason: str) -> None:
    with pytest.raises(VariantValidationError) as info:
        validate_variant(raw, ORIGINAL)
    assert reason in str(info.value)


def test_banned_words_are_rejected() -> None:
    with pytest.raises(VariantValidationError):
        validate_variant(
            {**GOOD, "options": ["탕정(湯井)", "바보", "아산", "도고"]}, ORIGINAL, ["바보"]
        )


def test_cache_put_get_by_topic_and_dedupe() -> None:
    cache = InMemoryVariantCache()
    from app.domain.models import Variant

    v = Variant(
        variant_id="ony-01-v1",
        question_id="ony-01",
        topic_id="onyang",
        stem="s",
        options=["a", "b", "c", "d"],
    )
    cache.put([v, v])
    assert [x.variant_id for x in cache.get("ony-01")] == ["ony-01-v1"]
    assert list(cache.by_topic("onyang")) == ["ony-01"]
    assert cache.by_topic("yisunsin") == {}
    assert cache.last_built_at() is None
    cache.mark_built(datetime(2026, 10, 4, tzinfo=UTC))
    assert cache.last_built_at() is not None
    cache.clear()
    assert cache.all() == [] and cache.last_built_at() is None


def test_service_keeps_only_valid_variants(question_bank: QuestionBank) -> None:
    fake = FakeGeminiClient(
        [
            {
                "variants": [
                    GOOD,
                    {
                        **GOOD,
                        "options": ["온수(溫水)", "신창", "아산", "도고"],
                    },  # 정답 불일치 → 폐기
                    {
                        "stem": "고려 이전, 온천 우물 이름은?",
                        "options": ["탕정(湯井)", "온수", "온양", "신창"],
                    },
                ]
            }
        ]
    )
    cache = InMemoryVariantCache()
    service = VariationService(question_bank, fake, cache, variants_per_question=2)
    question = question_bank.get_question("ony-01")
    assert question is not None

    built = service.build_for_question(question)

    assert [v.variant_id for v in built] == ["ony-01-v1", "ony-01-v2"]
    assert all(v.options[0] == "탕정(湯井)" and v.correct_index == 0 for v in built)
    assert built[0].model == "fake-model"
    assert cache.get("ony-01") == built
    assert "[정답 텍스트] 탕정(湯井)" in fake.calls[0]["prompt"]
    assert question.fact[:10] in fake.calls[0]["prompt"]


def test_service_handles_failures_and_reports_status(question_bank: QuestionBank) -> None:
    fake = FakeGeminiClient([{"variants": [GOOD]}, GeminiError("down"), "not json at all"])
    service = VariationService(question_bank, fake, InMemoryVariantCache())
    report = service.build_all(topic_id="onyang")
    assert report.total == 15
    assert (
        report.built == 1 and report.failed == 14
    )  # 첫 호출(ony-01)만 성공, 이후는 실패·응답 없음
    status = service.status()
    assert status["total"] == 75
    assert status["with_variants"] == 1
    assert status["per_topic"]["onyang"] == 1
    assert status["last_built_at"] is not None
    assert status["building"] is False
    assert service.ready() is True


def test_service_without_client_is_noop(question_bank: QuestionBank) -> None:
    service = VariationService(question_bank, None, InMemoryVariantCache())
    assert service.build_for_question(question_bank.questions[0]) == []
    assert service.start_background_build() is None
    assert service.ready() is False
