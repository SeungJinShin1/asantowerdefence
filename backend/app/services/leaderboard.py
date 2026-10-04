"""리더보드 — docs/03 POST/GET /leaderboard, docs/04 §1 defence_leaderboard.

보안(서버 측 검증·개인정보): 닉네임만 저장하고(domain/nickname 검증), 점수는 세션의 서버 결과(finish)에서만 가져온다.
세션당 1회만 등록(Session.leaderboard_id). 클라이언트가 보내는 점수는 받지 않는다.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Protocol

from app.core.errors import ConflictError
from app.domain.models import LeaderboardEntry, Session
from app.domain.nickname import validate_nickname
from app.routers.schemas import LeaderboardRow, RegisterLeaderboardResponse
from app.services.session_store import SessionStore

DEFAULT_LIMIT = 20
MAX_LIMIT = 50


class LeaderboardStore(Protocol):
    def add(self, entry: LeaderboardEntry) -> str: ...

    def top(self, limit: int) -> list[LeaderboardEntry]: ...

    def rank_of(self, score: int) -> int: ...

    def clear(self) -> int: ...


class InMemoryLeaderboardStore:
    def __init__(self) -> None:
        self._entries: list[tuple[str, LeaderboardEntry]] = []
        self._lock = threading.Lock()

    def add(self, entry: LeaderboardEntry) -> str:
        entry_id = uuid.uuid4().hex
        with self._lock:
            self._entries.append((entry_id, entry.model_copy(deep=True)))
        return entry_id

    def top(self, limit: int) -> list[LeaderboardEntry]:
        with self._lock:
            ordered = sorted((e for _, e in self._entries), key=lambda e: (-e.score, e.created_at))
        return [e.model_copy(deep=True) for e in ordered[:limit]]

    def rank_of(self, score: int) -> int:
        with self._lock:
            return sum(1 for _, e in self._entries if e.score > score) + 1

    def clear(self) -> int:
        with self._lock:
            removed = len(self._entries)
            self._entries.clear()
        return removed


def utcnow() -> datetime:
    return datetime.now(UTC)


class LeaderboardService:
    def __init__(
        self,
        store: LeaderboardStore,
        sessions: SessionStore,
        *,
        banned_words: Sequence[str] = (),
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.store = store
        self.sessions = sessions
        self.banned_words = tuple(banned_words)
        self.clock = clock

    def register(self, session: Session, nickname: str) -> RegisterLeaderboardResponse:
        if not session.is_finished or session.result is None:
            raise ConflictError("게임이 끝난 뒤에 기록할 수 있어요.")
        if session.leaderboard_id:
            raise ConflictError("이번 판 기록은 이미 올렸어요.")
        clean = validate_nickname(nickname, self.banned_words)
        entry = LeaderboardEntry(
            nickname=clean,
            score=session.result.score,
            stage_reached=session.stage_reached,
            correct_count=session.stats.correct_count,
            combo_max=session.stats.combo_max,
            booth_mode=session.booth_mode,
            session_id=session.session_id,
            created_at=self.clock(),
        )
        entry_id = self.store.add(entry)
        session.leaderboard_id = entry_id
        session.nickname = clean
        self.sessions.save(session)
        return RegisterLeaderboardResponse(
            rank=self.store.rank_of(entry.score), score=entry.score, nickname=clean
        )

    def reset(self) -> int:
        """부스 운영용: 모든 기록을 지우고 지운 개수를 돌려준다(관리자 토큰 필수, 라우터에서 로그)."""
        return self.store.clear()

    def list_top(self, limit: int = DEFAULT_LIMIT) -> list[LeaderboardRow]:
        limit = max(1, min(limit, MAX_LIMIT))
        return [
            LeaderboardRow(
                rank=index,
                nickname=e.nickname,
                score=e.score,
                stage_reached=e.stage_reached,
                created_at=e.created_at,
            )
            for index, e in enumerate(self.store.top(limit), start=1)
        ]
