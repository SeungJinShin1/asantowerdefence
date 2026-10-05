"""세션 생성 · 이벤트 검증 · finish 점수 확정 — docs/03 `sessions` · `events` · `finish`, docs/02 §7·§9.

보안 5항목 중 '중요 로직 서버 측 검증': 이벤트는 종류·스테이지·웨이브 범위·스테이지당 횟수 상한을 서버가
검사하고 초과분은 accepted:false 로 무시한다. 2배 타임 종료 시각은 클라이언트의 at 이 아닌 서버 시각으로 계산한다.
finish 보고값은 scoring.validate_finish 로 상한 검증한 뒤 서버 점수만 저장하며, 거부 사유는 로그에만 남긴다.
'라우트 보호': 세션 토큰은 core/security 가 발급·검증한다(HMAC, 기본 3시간).
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.core.config import Settings
from app.core.errors import (
    ConflictError,
    NotFoundError,
    ScoreRejectedError,
    UnauthorizedError,
    ValidationFailedError,
)
from app.core.security import issue_session_token, new_session_id
from app.domain import scoring
from app.domain.models import (
    STAGE_COUNT,
    FinishReport,
    FinishResult,
    GameEventRecord,
    Session,
    StageState,
)
from app.routers.schemas import (
    ActiveEvent,
    EventRequest,
    EventResponse,
    FinishRequest,
    FinishResponse,
    ScoreBreakdownOut,
)
from app.services.session_store import SessionStore

logger = logging.getLogger("app.session")

NICKNAME_MAX_LEN = 20  # 정식 닉네임 규칙(2~10자·금칙어)은 Phase 5 domain/nickname.py 에서
TEACHER_NICKNAME = "선생님"
DOUBLE_COIN_EVENT = "DOUBLE_COIN_TIME"
# 스테이지당 허용 횟수. WAVE_CLEARED 는 waves_per_stage, STAGE_FAILED 는 무제한(docs/03 events).
EVENT_CAPS_PER_STAGE: dict[str, int] = {
    "MIDBOSS_DEFEATED": 1,
    "FINALBOSS_DEFEATED": 1,
    "LEARN_COMPLETED": 1,
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class SessionService:
    def __init__(
        self, store: SessionStore, settings: Settings, *, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self.store = store
        self.settings = settings
        self.clock = clock

    def create_teacher(self, code: str) -> tuple[Session, str]:
        """교사 코드가 맞으면 교사 세션을 만든다. 코드가 설정되지 않았으면 교사 모드는 없는 것(404)으로 본다.

        비교는 대소문자·앞뒤 공백을 무시하고 상수 시간(hmac.compare_digest)으로 하며, 입력한 코드·정답 코드는 응답·로그에 남기지 않는다.
        """
        expected = self.settings.teacher_code.strip().casefold()
        if not expected:
            raise NotFoundError("교사 모드가 꺼져 있어요. 운영자에게 문의해 주세요.")
        given = code.strip().casefold()
        if not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
            logger.warning("teacher_code_rejected")
            raise UnauthorizedError("교사 코드가 맞지 않아요.", detail="teacher_code")
        session, token = self.create(TEACHER_NICKNAME, teacher=True)
        logger.info("teacher_session_created")
        return session, token

    def create(self, nickname: str | None, *, teacher: bool = False) -> tuple[Session, str]:
        """세션을 만들고 (세션, 토큰)을 돌려준다. 닉네임은 저장만 한다(개인정보 아님)."""
        now = self.clock()
        session_id = new_session_id()
        expires_at = now + timedelta(hours=self.settings.session_ttl_hours)
        clean = (nickname or "").strip()[:NICKNAME_MAX_LEN] or None
        session = Session(
            session_id=session_id,
            nickname=clean,
            created_at=now,
            updated_at=now,
            expires_at=expires_at,
            booth_mode=self.settings.booth_mode,
            waves_per_stage=scoring.waves_per_stage(self.settings.booth_mode),
            is_teacher=teacher,
        )
        token = issue_session_token(session_id, expires_at, self.settings.session_secret)
        self.store.create(session)
        return session, token

    def record_event(self, session_id: str, req: EventRequest) -> EventResponse:
        session = self._load_active(session_id)
        now = self.clock()
        if not 1 <= req.stage_order <= STAGE_COUNT or not 0 <= req.wave <= session.waves_per_stage:
            raise ValidationFailedError("스테이지나 웨이브 번호가 범위를 벗어났어요.")
        if req.type != "LEARN_COMPLETED" and req.stage_order not in session.stages_started:
            # 학습 완료는 스테이지 시작 전(Learn 화면)에 오므로 예외. 나머지는 시작한 스테이지만.
            raise ValidationFailedError("아직 시작하지 않은 스테이지예요.")

        state = session.stage_states.setdefault(req.stage_order, StageState())
        cap = self._cap_for(req.type, session.waves_per_stage)
        used = state.event_counts.get(req.type, 0)
        accepted = cap is None or used < cap
        if accepted:
            until = (
                now + timedelta(seconds=scoring.DOUBLE_COIN_SECONDS)
                if req.type == "MIDBOSS_DEFEATED"
                else None
            )
            session.events.append(
                GameEventRecord(
                    type=req.type,
                    stage_order=req.stage_order,
                    wave=req.wave,
                    at=req.at,
                    until=until,
                )
            )
            state.event_counts[req.type] = used + 1
            session.updated_at = now
            self.store.save(session)
        return EventResponse(accepted=accepted, active_events=self._active_events(session, now))

    def finish(self, session_id: str, req: FinishRequest) -> FinishResponse:
        session = self._load_active(session_id)
        coins_left = req.coins_left_at_end
        if session.is_teacher:
            # 교사 모드는 검수용 '코인 받기'를 쓰므로 거부하지 않고 상한으로 깎는다(리더보드에는 못 올린다)
            coins_left = min(
                coins_left,
                scoring.max_client_coins(
                    coins_from_quiz=session.stats.coins_from_quiz,
                    stages_started=len(session.stages_started),
                    waves_cleared=req.waves_cleared,
                ),
            )
        report = FinishReport(
            stages_cleared=req.stages_cleared,
            waves_cleared=req.waves_cleared,
            lives_left_at_end=req.lives_left_at_end,
            coins_left_at_end=coins_left,
            client_score=req.client_score,
        )
        reasons = scoring.validate_finish(
            report,
            stages_started=len(session.stages_started),
            waves_per_stage=session.waves_per_stage,
            coins_from_quiz=session.stats.coins_from_quiz,
        )
        if reasons:
            # 상세 사유는 로그 전용(detail). 응답에는 code·message 만 나간다.
            raise ScoreRejectedError(detail={"sessionId": session_id, "reasons": reasons})

        score, breakdown = scoring.compute_score(
            correct_count=session.stats.correct_count,
            combo_max=session.stats.combo_max,
            waves_cleared=req.waves_cleared,
            stages_cleared=req.stages_cleared,
            lives_left=req.lives_left_at_end,
            coins_left=coins_left,
        )
        now = self.clock()
        session.result = FinishResult(
            score=score, breakdown=breakdown, reported=report, finished_at=now
        )
        session.status = "finished"
        session.updated_at = now
        self.store.save(session)
        return FinishResponse(
            score=score,
            breakdown=ScoreBreakdownOut(**breakdown.model_dump()),
            correct_count=session.stats.correct_count,
            answered_count=session.stats.answered_count,
            combo_max=session.stats.combo_max,
            stage_reached=session.stage_reached,
            wrong_quiz_ids=session.wrong_quiz_ids(),
        )

    # ---------- 내부 ----------

    def _load_active(self, session_id: str) -> Session:
        session = self.store.get(session_id)
        if session is None:
            raise NotFoundError("세션을 찾을 수 없어요.")
        if session.is_finished:
            raise ConflictError("이미 끝난 게임이에요. 새로 시작해 주세요.")
        return session

    @staticmethod
    def _cap_for(event_type: str, waves_per_stage: int) -> int | None:
        if event_type == "WAVE_CLEARED":
            return waves_per_stage
        if event_type == "STAGE_FAILED":
            return None
        return EVENT_CAPS_PER_STAGE.get(event_type)

    @staticmethod
    def _active_events(session: Session, now: datetime) -> list[ActiveEvent]:
        return [
            ActiveEvent(type=DOUBLE_COIN_EVENT, until=event.until)
            for event in session.events
            if event.until is not None and event.until > now
        ]
