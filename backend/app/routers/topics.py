"""GET /topics — 학습 카드·메타 (docs/03).

보안 5항목:
- 라우트 보호: 공개 읽기 전용(세션 불필요). 요청 제한은 기본 120/분(SlowAPIMiddleware).
- DB 보안: 서버 메모리의 문제 은행만 읽는다.
- ENV 노출 방지: 설정값을 쓰지 않는다.
- 서버 측 검증: chatbotContext 가 없는 TopicOut 으로만 직렬화한다(정답·근거 필드 없음).
- 에러 로그: 공통 미들웨어·핸들러.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.routers.deps import get_question_bank
from app.routers.schemas import TopicOut
from app.services.question_bank import QuestionBank

router = APIRouter(tags=["topics"])


@router.get("/topics", response_model=list[TopicOut])
async def list_topics(bank: QuestionBank = Depends(get_question_bank)) -> list[TopicOut]:
    return bank.public_topics()
