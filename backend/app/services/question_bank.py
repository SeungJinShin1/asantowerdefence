"""문제 은행 — content/*.json 로드·검증·조회 (docs/05 1.2, app/content/README.md).

보안 5항목 중 관련 항목:
- ENV·정답 노출 방지: Question.answer_index / fact, Topic.chatbot_context 는 이 모듈 안(서버)에만 머문다.
  프론트로 나가는 주제 목록은 public_topics()가 TopicOut(routers/schemas)으로 필드를 명시 복사해 만든다 —
  chatbotContext 는 복사 대상에 없다.
- 중요 로직 서버 측 검증: 콘텐츠는 기동 시 전부 검증하고 하나라도 어긋나면 QuestionBankError 로 기동을 막는다(fail-fast).
- 프로덕션 에러 로그: QuestionBankError 메시지에는 파일 이름·id·개수만 담고 정답 보기·fact 본문은 넣지 않는다.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.domain.models import CamelModel, Question, Topic
from app.routers.schemas import CardOut, TopicOut

TOPICS_FILE = "topics.json"
QUESTIONS_FILE = "questions.json"
OPTION_COUNT = 4
DIFFICULTIES: tuple[int, ...] = (1, 2, 3)
MAX_PROBLEMS_IN_MESSAGE = 10


class QuestionBankError(Exception):
    """콘텐츠 로드·검증 실패.

    source 는 파일 이름(topics.json / questions.json) 또는 원인 식별자, problems 는 발견한 문제 전체.
    메시지에는 앞 MAX_PROBLEMS_IN_MESSAGE 개만 싣고 나머지는 '외 N건'으로 줄인다.
    """

    def __init__(self, source: str, problems: Sequence[str]) -> None:
        self.source = source
        self.problems = list(problems)
        super().__init__(self._format_message())

    def _format_message(self) -> str:
        shown = self.problems[:MAX_PROBLEMS_IN_MESSAGE]
        hidden = len(self.problems) - len(shown)
        tail = f" (외 {hidden}건)" if hidden > 0 else ""
        # 구분자는 ASCII 만 사용 — cp949 콘솔(Windows)에서도 로그 출력이 깨지지 않게
        return f"{self.source}: 문제 {len(self.problems)}건 - {'; '.join(shown)}{tail}"


# ---------- 파일 읽기 ----------


def _read_json_object(path: Path) -> dict[str, Any]:
    """UTF-8 JSON 파일을 읽어 최상위 객체(dict)를 돌려준다. 실패는 모두 QuestionBankError."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise QuestionBankError(path.name, [f"파일이 없습니다: {path}"]) from exc
    except UnicodeDecodeError as exc:
        raise QuestionBankError(path.name, [f"UTF-8 로 읽을 수 없습니다: {exc.reason}"]) from exc
    except OSError as exc:
        raise QuestionBankError(path.name, [f"파일을 읽을 수 없습니다: {exc.strerror}"]) from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        problem = f"JSON 문법 오류: {exc.msg} (line {exc.lineno}, col {exc.colno})"
        raise QuestionBankError(path.name, [problem]) from exc
    if not isinstance(data, dict):
        raise QuestionBankError(
            path.name, [f"최상위가 객체({{...}})가 아닙니다: {type(data).__name__}"]
        )
    return data


def _parse_items[ModelT: CamelModel](
    data: dict[str, Any], key: str, model: type[ModelT], file_name: str
) -> list[ModelT]:
    """최상위 key 배열의 각 원소를 model 로 검증한다. pydantic 오류는 원소 인덱스·id 와 함께 모은다."""
    items = data.get(key)
    if not isinstance(items, list):
        raise QuestionBankError(file_name, [f"최상위 '{key}' 가 없거나 배열이 아닙니다"])
    parsed: list[ModelT] = []
    problems: list[str] = []
    for index, item in enumerate(items):
        try:
            parsed.append(model.model_validate(item))
        except ValidationError as exc:
            label = f"{key}[{index}]{_item_id(item)}"
            problems.extend(
                f"{label} {'.'.join(str(part) for part in err['loc'])}: {err['msg']}"
                for err in exc.errors()
            )
    if problems:
        raise QuestionBankError(file_name, problems)
    return parsed


def _item_id(item: Any) -> str:
    if isinstance(item, dict) and isinstance(item.get("id"), str):
        return f" id='{item['id']}'"
    return ""


def _read_version(data: dict[str, Any], file_name: str) -> str:
    version = data.get("version", "")
    if not isinstance(version, str):
        raise QuestionBankError(file_name, ["최상위 'version' 은 문자열이어야 합니다"])
    return version


# ---------- 교차 검증 (문제를 모두 모아 한 번에) ----------


def _validate_topics(topics: Sequence[Topic]) -> list[str]:
    problems: list[str] = []
    seen_topic_ids: set[str] = set()
    seen_card_ids: set[str] = set()
    for topic in topics:
        if topic.id in seen_topic_ids:
            problems.append(f"topics: 주제 id 중복 '{topic.id}'")
        seen_topic_ids.add(topic.id)
        if not topic.cards:
            problems.append(f"topics: 주제 '{topic.id}' 에 카드가 없습니다")
        for card in topic.cards:
            if card.id in seen_card_ids:
                problems.append(f"topics: 카드 id 중복 '{card.id}' (주제 '{topic.id}')")
            seen_card_ids.add(card.id)
    orders = sorted(topic.order for topic in topics)
    expected = list(range(1, len(topics) + 1))
    if orders != expected:  # 정렬 결과가 1..N 이면 유일성과 연속성이 동시에 보장된다
        problems.append(
            f"topics: order 는 1..{len(topics)} 로 유일·연속이어야 합니다 (실제 {orders})"
        )
    return problems


def _validate_question(question: Question, topic_ids: set[str]) -> list[str]:
    label = f"questions: 문항 '{question.id}'"
    problems: list[str] = []
    if question.topic_id not in topic_ids:
        problems.append(f"{label} topicId '{question.topic_id}' 가 주제 목록에 없습니다")
    options = [option.strip() for option in question.options]
    if len(options) != OPTION_COUNT:
        problems.append(f"{label} options 는 {OPTION_COUNT}개여야 합니다 (실제 {len(options)}개)")
    if any(not option for option in options):
        problems.append(f"{label} 빈 보기가 있습니다")
    if len(set(options)) != len(options):
        problems.append(f"{label} 보기가 서로 달라야 합니다")
    if not 0 <= question.answer_index < OPTION_COUNT:
        problems.append(
            f"{label} answerIndex 는 0..{OPTION_COUNT - 1} 이어야 합니다 (실제 {question.answer_index})"
        )
    for field in ("stem", "fact", "explanation"):
        if not getattr(question, field).strip():
            problems.append(f"{label} {field} 가 비어 있습니다")
    return problems


def _validate(topics: Sequence[Topic], questions: Sequence[Question]) -> list[str]:
    problems = _validate_topics(topics)
    topic_ids = {topic.id for topic in topics}
    seen_question_ids: set[str] = set()
    for question in questions:
        if question.id in seen_question_ids:
            problems.append(f"questions: 문항 id 중복 '{question.id}'")
        seen_question_ids.add(question.id)
        problems.extend(_validate_question(question, topic_ids))
    questioned_topics = {question.topic_id for question in questions}
    problems.extend(
        f"questions: 주제 '{topic.id}' 에 문항이 없습니다"
        for topic in topics
        if topic.id not in questioned_topics
    )
    return problems


def _to_public(topic: Topic) -> TopicOut:
    """TopicOut 으로 필드를 명시 복사한다 — chatbot_context 는 여기서 절대 옮기지 않는다."""
    return TopicOut(
        id=topic.id,
        order=topic.order,
        title=topic.title,
        subtitle=topic.subtitle,
        era=topic.era,
        keywords=list(topic.keywords),
        cards=[CardOut(id=card.id, title=card.title, body=card.body) for card in topic.cards],
    )


# ---------- 문제 은행 ----------


class QuestionBank:
    """검증된 주제·문항의 읽기 전용 저장소. 조회 결과 리스트는 매번 새 리스트(내부 상태 보호)."""

    def __init__(self, topics: list[Topic], questions: list[Question], version: str = "") -> None:
        problems = _validate(topics, questions)
        if problems:
            raise QuestionBankError("content", problems)
        self._topics: list[Topic] = sorted(topics, key=lambda topic: topic.order)
        self._questions: list[Question] = list(questions)
        self._version = version
        self._topic_by_id = {topic.id: topic for topic in self._topics}
        self._topic_by_order = {topic.order: topic for topic in self._topics}
        self._question_by_id = {question.id: question for question in self._questions}
        self._questions_by_topic: dict[str, list[Question]] = {t.id: [] for t in self._topics}
        for question in self._questions:
            self._questions_by_topic[question.topic_id].append(question)

    @classmethod
    def load(cls, content_dir: Path) -> QuestionBank:
        """content_dir/topics.json 과 content_dir/questions.json 을 읽어 검증된 은행을 만든다."""
        topics_data = _read_json_object(content_dir / TOPICS_FILE)
        questions_data = _read_json_object(content_dir / QUESTIONS_FILE)
        topics = _parse_items(topics_data, "topics", Topic, TOPICS_FILE)
        questions = _parse_items(questions_data, "questions", Question, QUESTIONS_FILE)
        version = _read_version(questions_data, QUESTIONS_FILE)
        return cls(topics, questions, version=version)

    @property
    def topics(self) -> list[Topic]:
        """order 오름차순."""
        return list(self._topics)

    @property
    def questions(self) -> list[Question]:
        """파일 순서."""
        return list(self._questions)

    @property
    def version(self) -> str:
        return self._version

    def __len__(self) -> int:
        return len(self._questions)

    def get_topic(self, topic_id: str) -> Topic | None:
        return self._topic_by_id.get(topic_id)

    def topic_by_order(self, order: int) -> Topic | None:
        return self._topic_by_order.get(order)

    def public_topics(self) -> list[TopicOut]:
        """프론트에 내려보낼 주제 목록 — chatbotContext 가 절대 포함되지 않는다."""
        return [_to_public(topic) for topic in self._topics]

    def get_question(self, question_id: str) -> Question | None:
        return self._question_by_id.get(question_id)

    def questions_for_topic(
        self, topic_id: str, difficulties: Iterable[int] | None = None
    ) -> list[Question]:
        """주제의 문항을 파일 순서대로. difficulties 를 주면 그 난이도만 남긴다."""
        pool = self._questions_by_topic.get(topic_id, [])
        if difficulties is None:
            return list(pool)
        allowed = set(difficulties)
        return [question for question in pool if question.difficulty in allowed]

    def count_by_topic(self) -> dict[str, int]:
        return {topic.id: len(self._questions_by_topic[topic.id]) for topic in self._topics}

    def count_by_difficulty(self, topic_id: str | None = None) -> dict[int, int]:
        """키 1, 2, 3 이 항상 존재한다. 없는 주제는 전부 0."""
        pool = self._questions if topic_id is None else self._questions_by_topic.get(topic_id, [])
        counts: dict[int, int] = dict.fromkeys(DIFFICULTIES, 0)
        for question in pool:
            counts[question.difficulty] += 1
        return counts
