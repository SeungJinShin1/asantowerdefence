"""테스트용 가짜 Firestore — 실제 SDK 와 같은 메서드 이름·동작의 최소 부분집합.

collection().document().get()/set()/delete(), collection().add(), where(filter=FieldFilter), order_by, limit, stream.
"""

from __future__ import annotations

import copy
import operator
import uuid
from datetime import datetime
from typing import Any

from google.cloud.firestore_v1 import Query
from google.cloud.firestore_v1.base_query import FieldFilter

_OPS = {
    "==": operator.eq,
    "!=": operator.ne,
    "<": operator.lt,
    "<=": operator.le,
    ">": operator.gt,
    ">=": operator.ge,
}


class FakeSnapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocument:
    def __init__(self, store: dict[str, dict[str, Any]], doc_id: str) -> None:
        self._store = store
        self.id = doc_id

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self.id, self._store.get(self.id))

    def set(self, data: dict[str, Any]) -> None:
        self._store[self.id] = copy.deepcopy(data)

    def update(self, data: dict[str, Any]) -> None:
        self._store.setdefault(self.id, {}).update(copy.deepcopy(data))

    def delete(self) -> None:
        self._store.pop(self.id, None)


class FakeQuery:
    def __init__(
        self,
        store: dict[str, dict[str, Any]],
        filters: list[FieldFilter] | None = None,
        orders: list[tuple[str, str]] | None = None,
        limit_n: int | None = None,
    ) -> None:
        self._store = store
        self._filters = filters or []
        self._orders = orders or []
        self._limit = limit_n

    def where(self, *args: Any, filter: FieldFilter | None = None) -> FakeQuery:
        if filter is None:
            filter = FieldFilter(*args)
        return FakeQuery(self._store, [*self._filters, filter], self._orders, self._limit)

    def order_by(self, field: str, direction: str = Query.ASCENDING) -> FakeQuery:
        return FakeQuery(
            self._store, self._filters, [*self._orders, (field, direction)], self._limit
        )

    def limit(self, n: int) -> FakeQuery:
        return FakeQuery(self._store, self._filters, self._orders, n)

    def stream(self) -> list[FakeSnapshot]:
        rows = [(doc_id, data) for doc_id, data in self._store.items() if self._matches(data)]
        for field, direction in reversed(self._orders):
            rows.sort(
                key=lambda r: _sort_key(r[1].get(field)), reverse=direction == Query.DESCENDING
            )
        if self._limit is not None:
            rows = rows[: self._limit]
        return [FakeSnapshot(doc_id, data) for doc_id, data in rows]

    def get(self) -> list[FakeSnapshot]:
        return self.stream()

    def _matches(self, data: dict[str, Any]) -> bool:
        for f in self._filters:
            value = data.get(f.field_path)
            if value is None or not _OPS[f.op_string](value, f.value):
                return False
        return True


def _sort_key(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.timestamp()
    return value


class FakeCollection(FakeQuery):
    def document(self, doc_id: str | None = None) -> FakeDocument:
        return FakeDocument(self._store, doc_id or uuid.uuid4().hex)

    def add(self, data: dict[str, Any]) -> tuple[None, FakeDocument]:
        doc = self.document()
        doc.set(data)
        return None, doc


class FakeFirestore:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict[str, Any]]] = {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self.collections.setdefault(name, {}))
