"""1.2 — 문제 은행(QuestionBank): 실제 콘텐츠 로드·공개 변환·조회·검증 실패 케이스."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.models import TOPIC_IDS, Question, Topic
from app.services.question_bank import QuestionBank, QuestionBankError

CONTENT_DIR = Path(__file__).resolve().parents[1] / "app" / "content"
PUBLIC_TOPIC_KEYS = {"id", "order", "title", "subtitle", "era", "keywords", "cards"}
PUBLIC_CARD_KEYS = {"id", "title", "body"}


# ---------- 픽스처 헬퍼 ----------


def _card(card_id: str = "c-01") -> dict[str, Any]:
    return {"id": card_id, "title": "카드 제목", "body": "카드 본문"}


def _topic(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "t1",
        "order": 1,
        "title": "주제",
        "subtitle": "부제",
        "era": "시대",
        "keywords": ["키워드"],
        "cards": [_card()],
        "chatbotContext": "서버 전용 근거 요약",
    }
    base.update(overrides)
    return base


def _question(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "q-01",
        "topicId": "t1",
        "difficulty": 1,
        "stem": "문제일까요?",
        "options": ["정답", "오답1", "오답2", "오답3"],
        "answerIndex": 0,
        "fact": "사실 한 문장",
        "explanation": "해설",
        "source": "",
    }
    base.update(overrides)
    return base


Payload = list[dict[str, Any]] | str | None


def write_content(tmp_path: Path, topics: Payload, questions: Payload) -> Path:
    """list → 정상 JSON 문서, str → 원문 그대로(문법 오류 재현), None → 파일을 만들지 않음."""
    for name, payload in (("topics", topics), ("questions", questions)):
        if payload is None:
            continue
        if isinstance(payload, str):
            text = payload
        else:
            document = {"version": "9.9.9", "updatedAt": "2026-01-01", name: payload}
            text = json.dumps(document, ensure_ascii=False)
        (tmp_path / f"{name}.json").write_text(text, encoding="utf-8")
    return tmp_path


@pytest.fixture(scope="module")
def bank() -> QuestionBank:
    return QuestionBank.load(CONTENT_DIR)


# ---------- 실제 콘텐츠 ----------


def test_real_content_counts(bank: QuestionBank) -> None:
    assert len(bank) == 75
    assert [topic.id for topic in bank.topics] == list(TOPIC_IDS)
    assert [topic.order for topic in bank.topics] == [1, 2, 3, 4, 5]
    assert sum(len(topic.cards) for topic in bank.topics) == 34
    assert bank.count_by_topic() == dict.fromkeys(TOPIC_IDS, 15)
    assert bank.count_by_difficulty() == {1: 27, 2: 32, 3: 16}
    assert all(question.answer_index == 0 for question in bank.questions)
    assert isinstance(bank.version, str) and bank.version
    raw = json.loads((CONTENT_DIR / "questions.json").read_text(encoding="utf-8"))
    assert [question.id for question in bank.questions] == [item["id"] for item in raw["questions"]]


def test_public_topics_never_expose_chatbot_context(bank: QuestionBank) -> None:
    raw = json.loads((CONTENT_DIR / "topics.json").read_text(encoding="utf-8"))
    # 전제: 실제 파일에는 chatbotContext가 있어야 이 테스트가 의미 있다
    assert all(item.get("chatbotContext") for item in raw["topics"])

    public = bank.public_topics()
    assert [topic.id for topic in public] == list(TOPIC_IDS)
    for topic_out in public:
        dumped = topic_out.model_dump(by_alias=True)
        assert "chatbotContext" not in dumped
        assert set(dumped) == PUBLIC_TOPIC_KEYS
        assert dumped["cards"], topic_out.id
        for card in dumped["cards"]:
            assert set(card) == PUBLIC_CARD_KEYS

    serialized = json.dumps([t.model_dump(by_alias=True) for t in public], ensure_ascii=False)
    assert "chatbotContext" not in serialized
    for topic in bank.topics:  # 키뿐 아니라 값(근거 본문)도 새지 않아야 한다
        assert topic.chatbot_context not in serialized


def test_questions_for_topic_real_content(bank: QuestionBank) -> None:
    onyang = bank.questions_for_topic("onyang")
    assert len(onyang) == 15
    assert [q.id for q in onyang] == [q.id for q in bank.questions if q.topic_id == "onyang"]

    easy = bank.questions_for_topic("onyang", difficulties=[1])
    assert easy and all(q.difficulty == 1 for q in easy)
    assert len(easy) == bank.count_by_difficulty("onyang")[1]

    hard = bank.questions_for_topic("onyang", difficulties={2, 3})
    assert all(q.difficulty in (2, 3) for q in hard)
    assert len(hard) + len(easy) == 15

    assert bank.questions_for_topic("onyang", difficulties=[]) == []
    assert bank.questions_for_topic("no-such-topic") == []
    assert bank.count_by_difficulty("no-such-topic") == {1: 0, 2: 0, 3: 0}


def test_lookups_real_content(bank: QuestionBank) -> None:
    assert bank.get_topic("onyang").order == 1
    assert bank.get_topic("no-such-topic") is None
    assert bank.topic_by_order(5).id == "seonjang"
    assert bank.topic_by_order(0) is None and bank.topic_by_order(6) is None
    assert bank.get_question("ony-01").topic_id == "onyang"
    assert bank.get_question("no-such-question") is None


def test_returned_collections_are_copies(bank: QuestionBank) -> None:
    bank.topics.clear()
    bank.questions.clear()
    bank.questions_for_topic("onyang").clear()
    assert len(bank.topics) == 5
    assert len(bank.questions) == 75
    assert len(bank.questions_for_topic("onyang")) == 15


# ---------- 깨진 콘텐츠 → QuestionBankError ----------

_T1 = [_topic()]
_Q1 = [_question()]
_Q_T1_T2 = [_question(), _question(id="q-02", topicId="t2")]

# id → (topics.json 내용, questions.json 내용, 오류 메시지에 들어 있어야 할 식별자)
BROKEN_CASES: dict[str, tuple[Payload, Payload, list[str]]] = {
    "questions-json-syntax": (_T1, '{"questions": [', ["questions.json"]),
    "topics-json-syntax": ("{oops", _Q1, ["topics.json"]),
    "questions-file-missing": (_T1, None, ["questions.json"]),
    "topics-file-missing": (None, _Q1, ["topics.json"]),
    "topics-top-level-not-object": ("[]", _Q1, ["topics.json"]),
    "questions-not-list": (_T1, '{"version": "1", "questions": {}}', ["questions.json"]),
    "pydantic-difficulty": (_T1, [_question(difficulty=5)], ["questions.json", "q-01"]),
    "three-options": (_T1, [_question(options=["정답", "오답1", "오답2"])], ["q-01"]),
    "answer-index-4": (_T1, [_question(answerIndex=4)], ["q-01"]),
    "unknown-topic": (_T1, [_question(topicId="ghost")], ["q-01", "ghost"]),
    "duplicate-question-id": (_T1, [_question(), _question(stem="다른 문제?")], ["q-01"]),
    "duplicate-option-after-strip": (
        _T1,
        [_question(options=["정답", " 정답 ", "오답2", "오답3"])],
        ["q-01"],
    ),
    "blank-option": (_T1, [_question(options=["정답", "  ", "오답2", "오답3"])], ["q-01"]),
    "empty-stem": (_T1, [_question(stem="   ")], ["q-01"]),
    "empty-fact": (_T1, [_question(fact="")], ["q-01"]),
    "empty-explanation": (_T1, [_question(explanation="")], ["q-01"]),
    "topic-order-gap-1-3": (
        [_topic(), _topic(id="t2", order=3, cards=[_card("c-02")])],
        _Q_T1_T2,
        ["order"],
    ),
    "duplicate-topic-id": ([_topic(), _topic(order=2, cards=[_card("c-02")])], _Q1, ["t1"]),
    "duplicate-card-id": (
        [_topic(), _topic(id="t2", order=2, cards=[_card("c-01")])],
        _Q_T1_T2,
        ["c-01"],
    ),
    "topic-without-cards": ([_topic(cards=[])], _Q1, ["t1"]),
    "topic-without-questions": (
        [_topic(), _topic(id="t2", order=2, cards=[_card("c-02")])],
        _Q1,
        ["t2"],
    ),
}


@pytest.mark.parametrize(
    ("topics", "questions", "expected"), BROKEN_CASES.values(), ids=BROKEN_CASES.keys()
)
def test_broken_content_raises(
    tmp_path: Path, topics: Payload, questions: Payload, expected: list[str]
) -> None:
    content_dir = write_content(tmp_path, topics, questions)
    with pytest.raises(QuestionBankError) as excinfo:
        QuestionBank.load(content_dir)
    message = str(excinfo.value)
    for needle in expected:
        assert needle in message, message
    assert excinfo.value.problems


def test_all_problems_collected_in_one_error(tmp_path: Path) -> None:
    questions = [
        _question(options=["정답", "오답1", "오답2"]),
        _question(id="q-02", answerIndex=9),
    ]
    content_dir = write_content(tmp_path, [_topic()], questions)
    with pytest.raises(QuestionBankError) as excinfo:
        QuestionBank.load(content_dir)
    assert len(excinfo.value.problems) == 2
    assert "q-01" in str(excinfo.value) and "q-02" in str(excinfo.value)


def test_error_message_lists_at_most_ten_problems(tmp_path: Path) -> None:
    questions = [_question(id=f"q-{n:02d}", answerIndex=7) for n in range(1, 13)]
    content_dir = write_content(tmp_path, [_topic()], questions)
    with pytest.raises(QuestionBankError) as excinfo:
        QuestionBank.load(content_dir)
    message = str(excinfo.value)
    assert len(excinfo.value.problems) == 12
    assert "q-10" in message and "q-11" not in message
    assert "외 2건" in message


def test_error_message_never_contains_answer_or_fact(tmp_path: Path) -> None:
    secret_fact = "유출되면안되는사실"
    questions = [_question(options=["유출정답", "유출정답", "오답2", "오답3"], fact=secret_fact)]
    content_dir = write_content(tmp_path, [_topic()], questions)
    with pytest.raises(QuestionBankError) as excinfo:
        QuestionBank.load(content_dir)
    assert "유출정답" not in str(excinfo.value)
    assert secret_fact not in str(excinfo.value)


# ---------- 정상 최소 픽스처 ----------


def test_minimal_valid_content(tmp_path: Path) -> None:
    content_dir = write_content(tmp_path, [_topic()], [_question()])
    bank = QuestionBank.load(content_dir)

    assert len(bank) == 1
    assert bank.version == "9.9.9"
    assert bank.count_by_topic() == {"t1": 1}
    assert bank.count_by_difficulty() == {1: 1, 2: 0, 3: 0}
    assert bank.count_by_difficulty("t1") == {1: 1, 2: 0, 3: 0}
    assert bank.get_topic("t1").chatbot_context == "서버 전용 근거 요약"
    assert bank.topic_by_order(1).id == "t1"
    assert bank.get_question("q-01").fact == "사실 한 문장"
    assert bank.questions_for_topic("t1", difficulties=(1,)) == [bank.get_question("q-01")]

    public = bank.public_topics()
    assert len(public) == 1
    assert public[0].model_dump(by_alias=True) == {
        "id": "t1",
        "order": 1,
        "title": "주제",
        "subtitle": "부제",
        "era": "시대",
        "keywords": ["키워드"],
        "cards": [{"id": "c-01", "title": "카드 제목", "body": "카드 본문"}],
    }


def test_constructor_sorts_topics_by_order() -> None:
    topics = [
        Topic.model_validate(_topic(id="t2", order=2, cards=[_card("c-02")])),
        Topic.model_validate(_topic()),
    ]
    questions = [
        Question.model_validate(_question(id="q-02", topicId="t2")),
        Question.model_validate(_question()),
    ]
    bank = QuestionBank(topics, questions)

    assert bank.version == ""
    assert [topic.id for topic in bank.topics] == ["t1", "t2"]
    assert [question.id for question in bank.questions] == ["q-02", "q-01"]  # 파일 순서 유지
    assert bank.topic_by_order(2).id == "t2"
    assert bank.count_by_topic() == {"t1": 1, "t2": 1}


def test_constructor_validates_models_directly() -> None:
    bad = Question.model_validate(_question(answerIndex=-1))
    with pytest.raises(QuestionBankError) as excinfo:
        QuestionBank([Topic.model_validate(_topic())], [bad])
    assert "q-01" in str(excinfo.value)
