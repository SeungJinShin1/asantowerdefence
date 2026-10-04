"""5.2 — 닉네임 규칙: 길이·문자 집합·전화번호/이메일·금칙어(공백·자모 분리 우회)."""

from __future__ import annotations

import pytest

from app.core.errors import NicknameRejectedError
from app.domain.nickname import (
    BANNED_WORDS_PATH,
    decompose_jamo,
    find_banned_word,
    load_banned_words,
    validate_nickname,
)

BANNED = ("바보", "ㅅㅂ", "fuck")


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("역사탐험가", "역사탐험가"),
        ("  Kim  12 ", "Kim 12"),
        ("가나", "가나"),
        ("열글자닉네임입니다요", "열글자닉네임입니다요"),
    ],
)
def test_valid_nicknames_are_normalized(raw: str, expected: str) -> None:
    assert validate_nickname(raw, BANNED) == expected


@pytest.mark.parametrize(
    "raw, detail",
    [
        ("", "length"),
        ("   ", "length"),
        ("가", "length"),
        ("열한글자가넘는닉네임이에요", "length"),
        ("nick!", "charset"),
        ("이름_철수", "charset"),
        ("0101234567", "personal_info"),
        ("a@b", "charset"),
        ("바보왕", "banned"),
        ("바 보", "banned"),
        ("ㅂㅏㅂㅗ", "charset"),  # 자모만 쓴 입력은 문자 집합 규칙이 먼저 막는다
        ("FUCKer", "banned"),
        ("ㅅㅂ123", "charset"),
    ],
)
def test_rejected_nicknames(raw: str, detail: str) -> None:
    with pytest.raises(NicknameRejectedError) as info:
        validate_nickname(raw, BANNED)
    assert info.value.detail == detail
    assert info.value.code == "NICKNAME_REJECTED"
    assert not raw.strip() or raw not in info.value.message  # 입력값을 메시지에 되비추지 않는다


def test_decompose_jamo_and_find_banned_word() -> None:
    assert decompose_jamo("바보") == "ㅂㅏㅂㅗ"
    assert decompose_jamo("한글A") == "ㅎㅏㄴㄱㅡㄹA"
    assert find_banned_word("착한 아이", BANNED) is None
    assert find_banned_word("바-보", BANNED) == "바보"
    assert find_banned_word("ㅂㅏ ㅂㅗ", BANNED) == "바보"


def test_banned_words_file_loads_and_is_used_by_default() -> None:
    words = load_banned_words(BANNED_WORDS_PATH)
    assert len(words) >= 10
    assert all("#" not in w and w == w.strip() for w in words)
    assert validate_nickname("착한 어린이", words) == "착한 어린이"
    with pytest.raises(NicknameRejectedError):
        validate_nickname("씨발맨", words)


def test_missing_banned_words_file_means_no_banned_words(tmp_path) -> None:
    assert load_banned_words(tmp_path / "none.txt") == ()
