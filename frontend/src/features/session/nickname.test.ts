import { describe, expect, it } from 'vitest'

import { normalizeNickname, validateNickname } from './nickname'

describe('validateNickname', () => {
  it('2~10자의 한글·영문·숫자·공백은 통과', () => {
    expect(validateNickname('역사탐험가')).toBeNull()
    expect(validateNickname('  Kim 12 ')).toBeNull()
    expect(validateNickname('가나')).toBeNull()
    expect(validateNickname('열글자닉네임입니다요')).toBeNull()
  })

  it('길이 규칙', () => {
    expect(validateNickname('')).toMatch(/입력/)
    expect(validateNickname('   ')).toMatch(/입력/)
    expect(validateNickname('가')).toMatch(/2글자/)
    expect(validateNickname('열한글자가넘는닉네임이에요')).toMatch(/10글자/)
  })

  it('허용되지 않는 문자·개인정보 패턴', () => {
    expect(validateNickname('nick!')).toMatch(/한글, 영어, 숫자/)
    expect(validateNickname('010-1234')).toMatch(/한글, 영어, 숫자/)
    expect(validateNickname('0101234567')).toMatch(/전화번호/)
    expect(validateNickname('a@b')).toMatch(/한글, 영어, 숫자|이메일/)
  })

  it('normalizeNickname 은 앞뒤 공백 제거·연속 공백 축약', () => {
    expect(normalizeNickname('  역사   탐험가 ')).toBe('역사 탐험가')
  })
})
