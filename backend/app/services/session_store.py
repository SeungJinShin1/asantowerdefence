"""세션 저장소 — SessionStore 프로토콜 + InMemorySessionStore (docs/01 §2, docs/04 §1).

역할: Session 문서(docs/04 §1 `defence_sessions`)의 CRUD. Phase 5의 FirestoreSessionStore가 같은
프로토콜을 구현하므로, 메모리 구현도 DB처럼 동작한다 — create/save는 깊은 복사를 보관하고 get은 깊은
복사를 돌려주어, 반환 객체를 바꿔도 save 전에는 저장소가 변하지 않는다.

보안 5항목 관련:
- DB 보안: 저장소는 백엔드 서비스 계층만 접근한다. 세션 소유 검증(토큰의 session_id와 일치)은
  라우터·security 의존성의 책임이며, 저장소는 session_id로만 조회한다.
- 서버 측 검증: Session에는 correct_index 등 서버 전용 필드가 그대로 들어 있다. 이 모듈은 로그를
  남기지 않으며, 예외 메시지에도 session_id 외의 세션 내용을 담지 않는다.
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.domain.models import Session


class SessionStoreError(Exception):
    """세션 저장소 공통 오류."""


class SessionAlreadyExistsError(SessionStoreError):
    """같은 session_id의 세션이 이미 존재한다."""


class SessionNotFoundError(SessionStoreError):
    """session_id에 해당하는 세션이 없다."""


@runtime_checkable
class SessionStore(Protocol):
    """세션 저장소 인터페이스. 메모리 구현과 Firestore 구현(Phase 5)이 공유한다."""

    def create(self, session: Session) -> None:
        """새 세션을 저장한다. session_id가 이미 있으면 SessionAlreadyExistsError."""
        ...

    def get(self, session_id: str) -> Session | None:
        """세션을 조회한다. 없으면 None. 반환 객체는 저장소와 분리된 사본이다."""
        ...

    def save(self, session: Session) -> None:
        """기존 세션을 덮어쓴다. 없으면 SessionNotFoundError."""
        ...

    def delete(self, session_id: str) -> bool:
        """세션을 삭제한다. 삭제했으면 True, 없었으면 False."""
        ...

    def purge_expired(self, now: datetime) -> int:
        """expires_at <= now 인 세션을 모두 삭제하고 개수를 돌려준다. now는 tz-aware."""
        ...

    def count(self) -> int:
        """저장된 세션 수."""
        ...


def _require_aware(value: datetime, name: str) -> None:
    """naive datetime은 tz-aware 값과 비교할 수 없으므로 일찍 거부한다."""
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError(f"{name} must be a tz-aware datetime")


class InMemorySessionStore:
    """dict + threading.Lock 기반 메모리 저장소 (부스 모드·테스트용).

    프로세스가 재시작되면 모든 세션이 사라진다. 운영에서 영속성이 필요하면 FirestoreSessionStore를 쓴다.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, session: Session) -> None:
        _require_aware(session.expires_at, "session.expires_at")
        with self._lock:
            if session.session_id in self._sessions:
                raise SessionAlreadyExistsError(session.session_id)
            self._sessions[session.session_id] = session.model_copy(deep=True)

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            stored = self._sessions.get(session_id)
            return None if stored is None else stored.model_copy(deep=True)

    def save(self, session: Session) -> None:
        _require_aware(session.expires_at, "session.expires_at")
        with self._lock:
            if session.session_id not in self._sessions:
                raise SessionNotFoundError(session.session_id)
            self._sessions[session.session_id] = session.model_copy(deep=True)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def purge_expired(self, now: datetime) -> int:
        _require_aware(now, "now")
        with self._lock:
            expired = [sid for sid, s in self._sessions.items() if s.expires_at <= now]
            for sid in expired:
                del self._sessions[sid]
            return len(expired)

    def count(self) -> int:
        with self._lock:
            return len(self._sessions)
