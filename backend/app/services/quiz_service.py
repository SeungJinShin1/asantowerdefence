"""출제·채점 오케스트레이션 — docs/03 `stages/{n}/start` · `quiz/more` · `quiz/answer`.

보안 5항목 중 '중요 로직 서버 측 검증': 정답 위치(correct_index)는 QuizRecord 로 세션에만 저장하고
응답(QuizItem)에는 넣지 않는다. 채점·코인·콤보는 domain/scoring 으로 서버가 계산하며,
클라이언트가 보내는 값은 choiceIndex · answeredMs · wave 뿐이다.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence
from datetime import UTC, datetime

from app.core.errors import ConflictError, NotFoundError
from app.core.security import new_quiz_id
from app.domain import scoring
from app.domain.models import STAGE_COUNT, QuizKind, QuizRecord, Session, StageState
from app.domain.quiz_rules import (
    QuizSlot,
    difficulties_for,
    plan_stage_slots,
    select_for_slots,
    shuffle_options,
    slot_sort_key,
)
from app.routers.schemas import (
    AnswerRequest,
    AnswerResponse,
    CoinBreakdown,
    QuizItem,
    QuizMoreResponse,
    StageStartResponse,
)
from app.services.question_bank import QuestionBank
from app.services.session_store import SessionStore


def utcnow() -> datetime:
    return datetime.now(UTC)


class QuizService:
    """스테이지 시작(배치 출제) · 추가 출제 · 채점. 상태는 전부 SessionStore 에 저장한다."""

    def __init__(
        self,
        question_bank: QuestionBank,
        store: SessionStore,
        *,
        rng: random.Random | None = None,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.question_bank = question_bank
        self.store = store
        self.rng = rng or random.Random()
        self.clock = clock

    # ---------- 공개 API ----------

    def start_stage(
        self, session_id: str, stage_order: int, *, retry: bool = False
    ) -> StageStartResponse:
        session = self._load_active(session_id)
        topic = (
            self.question_bank.topic_by_order(stage_order)
            if 1 <= stage_order <= STAGE_COUNT
            else None
        )
        if topic is None:
            raise NotFoundError("없는 스테이지예요.")

        if stage_order not in session.stages_started:
            session.stages_started = sorted([*session.stages_started, stage_order])
        state = session.stage_states.setdefault(stage_order, StageState())
        state.attempts += 1
        if state.attempts > 1:
            # 재도전(docs/02 §8): 이벤트 횟수 상한만 초기화. 정답·콤보·코인 통계는 누적.
            # retry 플래그와 무관하게 두 번째 시작부터 재도전으로 본다(클라이언트 값에 의존하지 않음).
            state.event_counts = {}

        batch = self._serve(
            session, topic.id, stage_order, plan_stage_slots(session.waves_per_stage)
        )
        session.updated_at = self.clock()
        self.store.save(session)
        return StageStartResponse(
            stage_order=stage_order,
            topic_id=topic.id,
            waves_per_stage=session.waves_per_stage,
            quiz_batch=batch,
        )

    def more(
        self,
        session_id: str,
        *,
        stage_order: int,
        count: int,
        kind: QuizKind = "normal",
        wave: int | None = None,
    ) -> QuizMoreResponse:
        session = self._load_active(session_id)
        if stage_order not in session.stages_started:
            raise ConflictError("아직 시작하지 않은 스테이지예요.")
        topic = self.question_bank.topic_by_order(stage_order)
        if topic is None:
            raise NotFoundError("없는 스테이지예요.")

        target_wave = wave if wave is not None else session.waves_per_stage
        difficulties = difficulties_for(kind, target_wave, session.waves_per_stage)
        slots = [
            QuizSlot(kind=kind, wave=target_wave, difficulties=difficulties) for _ in range(count)
        ]
        batch = self._serve(session, topic.id, stage_order, slots)
        session.updated_at = self.clock()
        self.store.save(session)
        return QuizMoreResponse(quiz_batch=batch)

    def answer(self, session_id: str, req: AnswerRequest) -> AnswerResponse:
        session = self._load_active(session_id)
        quiz = session.quizzes.get(req.quiz_id)
        if quiz is None:
            raise NotFoundError("없는 문제예요.")
        if quiz.answered:
            raise ConflictError("이미 답한 문제예요.")

        now = self.clock()
        correct = req.choice_index == quiz.correct_index  # -1(시간 초과)은 항상 오답
        combo = scoring.next_combo(session.stats.combo, correct)
        double_coin_active = any(e.until is not None and e.until > now for e in session.events)
        award = scoring.award_coins(
            quiz.kind,
            correct=correct,
            combo_after=combo,
            answered_ms=req.answered_ms,
            double_coin_active=double_coin_active,
        )

        stats = session.stats
        stats.answered_count += 1
        if correct:
            stats.correct_count += 1
        stats.combo = combo
        stats.combo_max = max(stats.combo_max, combo)
        stats.coins_from_quiz += award.coins

        quiz.answered_at = now
        quiz.wave = req.wave
        quiz.choice_index = req.choice_index
        quiz.correct = correct
        quiz.coins = award.coins
        session.updated_at = now
        self.store.save(session)

        return AnswerResponse(
            correct=correct,
            correct_index=quiz.correct_index,
            explanation=quiz.explanation,
            coins=award.coins,
            breakdown=CoinBreakdown(
                base=award.base,
                combo_mult=award.combo_mult,
                fast_bonus=award.fast_bonus,
                event_mult=award.event_mult,
            ),
            combo=combo,
            combo_max=stats.combo_max,
            coins_from_quiz=stats.coins_from_quiz,
        )

    # ---------- 내부 ----------

    def _load_active(self, session_id: str) -> Session:
        session = self.store.get(session_id)
        if session is None:
            raise NotFoundError("세션을 찾을 수 없어요.")
        if session.is_finished:
            raise ConflictError("이미 끝난 게임이에요. 새로 시작해 주세요.")
        return session

    def _serve(
        self, session: Session, topic_id: str, stage_order: int, slots: Sequence[QuizSlot]
    ) -> list[QuizItem]:
        """슬롯마다 문항을 고르고(우선순위 ①~④) 보기를 섞어 세션에 기록한 뒤 클라이언트용 항목을 돌려준다."""
        pool = self.question_bank.questions_for_topic(topic_id)
        wrong_ids = {q.question_id for q in session.quizzes.values() if q.correct is False}
        picks = select_for_slots(
            slots,
            pool,
            served_ids=set(session.served_question_ids),
            wrong_ids=wrong_ids,
            rng=self.rng,
        )
        room = max(scoring.MAX_QUIZZES_PER_SESSION - len(session.quizzes), 0)
        picks = picks[:room]  # docs/04 §1: 세션당 quizzes 최대 200건

        now = self.clock()
        served: list[tuple[QuizSlot, QuizRecord]] = []
        for pick in picks:
            options, correct_index = shuffle_options(
                pick.question.options, pick.question.answer_index, self.rng
            )
            record = QuizRecord(
                quiz_id=new_quiz_id(),
                question_id=pick.question.id,
                topic_id=topic_id,
                stage_order=stage_order,
                kind=pick.slot.kind,
                difficulty=pick.question.difficulty,
                stem=pick.question.stem,
                options=options,
                correct_index=correct_index,
                explanation=pick.question.explanation,
                served_at=now,
            )
            session.quizzes[record.quiz_id] = record
            if pick.question.id not in session.served_question_ids:
                session.served_question_ids.append(pick.question.id)
            served.append((pick.slot, record))

        served.sort(key=lambda pair: slot_sort_key(pair[0]))  # 웨이브 순으로 클라이언트에 전달
        return [
            QuizItem(
                quiz_id=record.quiz_id,
                difficulty=record.difficulty,
                kind=record.kind,
                stem=record.stem,
                options=list(record.options),
                time_limit_sec=scoring.QUIZ_TIME_LIMIT_SEC,
            )
            for _, record in served
        ]
