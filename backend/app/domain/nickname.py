"""닉네임 정제·검증 — docs/03 POST /leaderboard, docs/04 §5.

규칙: strip + 연속 공백 축약, 2~10자, [가-힣a-zA-Z0-9 ]만, 전화번호·이메일 패턴 거부,
금칙어(content/banned_words.txt) 부분 일치 — 공백 제거 형태와 자모 분리 형태(ㅂㅏㅂㅗ 같은 우회)로도 검사.
보안(서버 측 검증): 프론트의 1차 검증과 별개로 서버가 최종 판단한다. 거부 사유는 로그 전용(detail)이고 응답은 NICKNAME_REJECTED 하나.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from app.core.errors import NicknameRejectedError

NICKNAME_MIN = 2
NICKNAME_MAX = 10
BANNED_WORDS_PATH = Path(__file__).resolve().parent.parent / "content" / "banned_words.txt"

_ALLOWED = re.compile(r"^[가-힣a-zA-Z0-9 ]+$")
_PHONE = re.compile(r"\d{3}-?\d{3,4}-?\d{4}")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+")

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"


def normalize_nickname(raw: str) -> str:
    return " ".join(raw.split())


def decompose_jamo(text: str) -> str:
    """한글 음절을 자모로 풀어 쓴다('바보' → 'ㅂㅏㅂㅗ'). 우회 표기와 같은 꼴로 비교하기 위해 쓴다."""
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            offset = code - 0xAC00
            out.append(_CHO[offset // 588])
            out.append(_JUNG[(offset % 588) // 28])
            jong = offset % 28
            if jong:
                out.append(_JONG[jong])
        else:
            out.append(ch)
    return "".join(out)


def _compact(text: str) -> str:
    return re.sub(r"[\s\-_.]+", "", text).casefold()


def load_banned_words(path: Path = BANNED_WORDS_PATH) -> tuple[str, ...]:
    if not path.exists():
        return ()
    words: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        word = line.split("#", 1)[0].strip()
        if word:
            words.append(word)
    return tuple(words)


def find_banned_word(text: str, banned_words: Iterable[str]) -> str | None:
    """금칙어가 들어 있으면 그 단어를 돌려준다(공백 제거·자모 분리 형태 모두 비교)."""
    compact = _compact(text)
    jamo = decompose_jamo(compact)
    for word in banned_words:
        key = _compact(word)
        if not key:
            continue
        if key in compact or decompose_jamo(key) in jamo:
            return word
    return None


def validate_nickname(raw: str, banned_words: Iterable[str] = ()) -> str:
    """통과하면 정제된 닉네임을 돌려주고, 아니면 NicknameRejectedError(detail=사유)."""
    name = normalize_nickname(raw or "")
    if len(name) < NICKNAME_MIN or len(name) > NICKNAME_MAX:
        raise NicknameRejectedError(
            f"닉네임은 {NICKNAME_MIN}~{NICKNAME_MAX}글자로 지어 주세요.", detail="length"
        )
    if not _ALLOWED.fullmatch(name):
        raise NicknameRejectedError("한글, 영어, 숫자, 띄어쓰기만 쓸 수 있어요.", detail="charset")
    if _PHONE.search(name) or _EMAIL.search(name):
        raise NicknameRejectedError("전화번호나 이메일은 넣지 말아 주세요.", detail="personal_info")
    banned = find_banned_word(name, banned_words)
    if banned:
        raise NicknameRejectedError(
            "사용할 수 없는 말이 들어 있어요. 다른 닉네임을 골라 주세요.", detail="banned"
        )
    return name
