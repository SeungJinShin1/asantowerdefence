"""Firestore 구현 — SessionStore · VariantCache · LeaderboardStore 프로토콜 (docs/04 §1, docs/01 §3).

보안(DB 보안 규칙): Firestore 는 서버의 Admin SDK 로만 접근한다(클라이언트 규칙은 전면 차단, docs/04 §2).
서비스 계정은 FIREBASE_SERVICE_ACCOUNT_B64 환경변수로만 받고 로그·응답에 넣지 않는다.
컬렉션 이름은 FIRESTORE_COLLECTION_PREFIX 로 개발/운영을 분리한다. 테스트는 같은 메서드만 가진 가짜 DB 를 주입한다.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

from app.domain.models import LeaderboardEntry, Session, Variant
from app.services.session_store import SessionAlreadyExistsError, SessionNotFoundError

SESSIONS = "sessions"
VARIANTS = "variants"
LEADERBOARD = "leaderboard"
META = "meta"
VARIANTS_META_DOC = "variants"


class ServiceAccountError(ValueError):
    """서비스 계정 설정이 잘못됐을 때(기동 거부). 메시지에 키 내용은 넣지 않는다."""


def load_service_account(
    service_account_b64: str = "", service_account_file: str = ""
) -> dict[str, Any]:
    """base64 문자열 또는 파일 경로에서 서비스 계정 JSON 을 읽는다. 공백·줄바꿈·따옴표·패딩 누락은 보정한다."""
    if service_account_file:
        try:
            text = Path(service_account_file).read_text(encoding="utf-8")
        except OSError as exc:
            raise ServiceAccountError(
                f"FIREBASE_SERVICE_ACCOUNT_FILE 을 읽을 수 없어요: {exc.strerror}"
            ) from None
    elif service_account_b64:
        cleaned = "".join(service_account_b64.split()).strip("'\"")
        cleaned += "=" * (-len(cleaned) % 4)
        try:
            text = base64.b64decode(cleaned, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise ServiceAccountError(
                f"FIREBASE_SERVICE_ACCOUNT_B64 가 올바른 base64 가 아니에요(길이 {len(cleaned)}). "
                "JSON 파일 전체를 base64 로 바꾼 값을 넣거나, 파일을 올리고 FIREBASE_SERVICE_ACCOUNT_FILE 을 쓰세요."
            ) from None
    else:
        raise ServiceAccountError("서비스 계정 설정이 없어요.")
    try:
        info = json.loads(text)
    except json.JSONDecodeError:
        raise ServiceAccountError(
            "서비스 계정 내용이 JSON 이 아니에요(파일 전체를 넣었는지 확인)."
        ) from None
    missing = [k for k in ("type", "project_id", "private_key", "client_email") if k not in info]
    if missing:
        raise ServiceAccountError(f"서비스 계정 JSON 에 필드가 빠졌어요: {', '.join(missing)}")
    return info


def create_firestore_client(
    service_account_b64: str = "", service_account_file: str = "", app_name: str = "defence"
) -> Any:
    """서비스 계정(base64 또는 파일)으로 Admin SDK 를 초기화하고 Firestore 클라이언트를 돌려준다."""
    import firebase_admin
    from firebase_admin import credentials, firestore

    info = load_service_account(service_account_b64, service_account_file)
    try:
        app = firebase_admin.get_app(app_name)
    except ValueError:
        app = firebase_admin.initialize_app(credentials.Certificate(info), name=app_name)
    return firestore.client(app)


def _field_filter(field: str, op: str, value: Any) -> Any:
    from google.cloud.firestore_v1.base_query import FieldFilter

    return FieldFilter(field, op, value)


def _dump(model: Any) -> dict[str, Any]:
    """camelCase 문서. datetime 은 그대로(Firestore Timestamp), 정수 키 맵은 문자열 키로."""
    data = model.model_dump(by_alias=True, mode="python")
    if isinstance(data.get("stageStates"), dict):
        data["stageStates"] = {str(k): v for k, v in data["stageStates"].items()}
    return data


class FirestoreSessionStore:
    def __init__(self, db: Any, prefix: str = "defence_") -> None:
        self._col = db.collection(f"{prefix}{SESSIONS}")

    def create(self, session: Session) -> None:
        ref = self._col.document(session.session_id)
        if ref.get().exists:
            raise SessionAlreadyExistsError(session.session_id)
        ref.set(_dump(session))

    def get(self, session_id: str) -> Session | None:
        snap = self._col.document(session_id).get()
        if not snap.exists:
            return None
        return Session.model_validate(snap.to_dict())

    def save(self, session: Session) -> None:
        ref = self._col.document(session.session_id)
        if not ref.get().exists:
            raise SessionNotFoundError(session.session_id)
        ref.set(_dump(session))

    def delete(self, session_id: str) -> bool:
        ref = self._col.document(session_id)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    def purge_expired(self, now: datetime) -> int:
        expired = list(self._col.where(filter=_field_filter("expiresAt", "<=", now)).stream())
        for snap in expired:
            self._col.document(snap.id).delete()
        return len(expired)

    def count(self) -> int:
        return len(list(self._col.stream()))


class FirestoreVariantCache:
    def __init__(self, db: Any, prefix: str = "defence_") -> None:
        self._col = db.collection(f"{prefix}{VARIANTS}")
        self._meta = db.collection(f"{prefix}{META}").document(VARIANTS_META_DOC)

    @staticmethod
    def _load(snaps: Iterable[Any]) -> list[Variant]:
        return [Variant.model_validate(s.to_dict()) for s in snaps]

    def get(self, question_id: str) -> list[Variant]:
        return self._load(
            self._col.where(filter=_field_filter("questionId", "==", question_id)).stream()
        )

    def put(self, variants: Iterable[Variant]) -> None:
        for v in variants:
            self._col.document(v.variant_id).set(_dump(v))

    def by_topic(self, topic_id: str) -> dict[str, list[Variant]]:
        grouped: dict[str, list[Variant]] = {}
        for v in self._load(
            self._col.where(filter=_field_filter("topicId", "==", topic_id)).stream()
        ):
            grouped.setdefault(v.question_id, []).append(v)
        return grouped

    def all(self) -> list[Variant]:
        return self._load(self._col.stream())

    def clear(self) -> None:
        for snap in list(self._col.stream()):
            self._col.document(snap.id).delete()
        self._meta.delete()

    def last_built_at(self) -> datetime | None:
        snap = self._meta.get()
        if not snap.exists:
            return None
        value = (snap.to_dict() or {}).get("lastBuiltAt")
        return value if isinstance(value, datetime) else None

    def mark_built(self, at: datetime) -> None:
        self._meta.set({"lastBuiltAt": at})


class FirestoreLeaderboardStore:
    def __init__(self, db: Any, prefix: str = "defence_") -> None:
        self._col = db.collection(f"{prefix}{LEADERBOARD}")

    def add(self, entry: LeaderboardEntry) -> str:
        _update_time, ref = self._col.add(_dump(entry))
        return ref.id

    def top(self, limit: int) -> list[LeaderboardEntry]:
        from google.cloud.firestore_v1 import Query

        snaps = (
            self._col.order_by("score", direction=Query.DESCENDING)
            .order_by("createdAt")
            .limit(limit)
            .stream()
        )
        return [LeaderboardEntry.model_validate(s.to_dict()) for s in snaps]

    def rank_of(self, score: int) -> int:
        higher = list(self._col.where(filter=_field_filter("score", ">", score)).stream())
        return len(higher) + 1

    def clear(self) -> int:
        snaps = list(self._col.stream())
        for snap in snaps:
            self._col.document(snap.id).delete()
        return len(snaps)
