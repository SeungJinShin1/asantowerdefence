"""변형 문제 품질 검수 — 실제 Gemini 키로 N문항 × VARIANTS_PER_QUESTION 개를 생성해 표로 보여 준다 (docs/05 Phase 4 ✋).

backend/.env 의 GEMINI_API_KEY·GEMINI_MODEL 을 읽는다(키를 인자로 받지 않음). 캐시는 메모리라 서버 상태를 바꾸지 않는다.
사용:  backend/.venv/Scripts/python.exe scripts/variant_qa.py [--questions 10] [--topic onyang] [--out variant_qa.md]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.core.config import Settings
from app.services.gemini_client import GoogleGeminiClient
from app.services.question_bank import QuestionBank
from app.services.variation import (
    InMemoryVariantCache,
    VariantValidationError,
    VariationService,
    validate_variant,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--questions", type=int, default=10, help="검수할 문항 수(주제별로 고르게)")
    parser.add_argument("--topic", default=None, help="특정 주제만")
    parser.add_argument("--out", default="variant_qa.md")
    args = parser.parse_args()

    settings = Settings()
    if not settings.gemini_configured:
        print("backend/.env 에 GEMINI_API_KEY 와 GEMINI_MODEL 을 먼저 넣어 주세요.")
        return 2

    bank = QuestionBank.load(settings.content_dir)
    client = GoogleGeminiClient(settings.gemini_api_key, settings.gemini_model)
    service = VariationService(
        bank, client, InMemoryVariantCache(), variants_per_question=settings.variants_per_question
    )

    pool = [q for q in bank.questions if args.topic is None or q.topic_id == args.topic]
    # 주제별로 번갈아 고른다
    by_topic: dict[str, list] = {}
    for q in pool:
        by_topic.setdefault(q.topic_id, []).append(q)
    picked = []
    while len(picked) < args.questions and any(by_topic.values()):
        for qs in by_topic.values():
            if qs and len(picked) < args.questions:
                picked.append(qs.pop(0))

    lines = [f"# 변형 문제 검수 — 모델 `{settings.gemini_model}`, 문항 {len(picked)}개\n"]
    total_valid = total_rejected = 0
    for q in picked:
        topic = bank.get_topic(q.topic_id)
        raw = client.generate_json(service.system_prompt, service._user_prompt(q, topic))
        items = raw.get("variants") if isinstance(raw, dict) else raw
        lines.append(f"\n## {q.id} ({q.topic_id}, 난이도 {q.difficulty})\n")
        lines.append(
            f"- 원본: **{q.stem}** → 정답 `{q.options[q.answer_index]}`\n- 근거: {q.fact}\n"
        )
        for i, item in enumerate(items if isinstance(items, list) else [], start=1):
            try:
                stem, options = validate_variant(item, q)
                total_valid += 1
                lines.append(f"- ✅ 변형{i}: {stem}\n  - 보기: {' / '.join(options)}")
            except VariantValidationError as exc:
                total_rejected += 1
                lines.append(f"- ❌ 변형{i} 폐기({exc}): {item}")
        print(f"{q.id}: 완료")
    lines.insert(1, f"\n통과 {total_valid} · 폐기 {total_rejected}\n")
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(f"\n통과 {total_valid} / 폐기 {total_rejected} → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
