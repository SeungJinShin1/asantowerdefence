/**
 * 닉네임 1차 검증 (docs/03 POST /leaderboard, docs/04 §5 와 같은 규칙의 클라이언트 복사본).
 * 서버가 최종 검증(금칙어 포함, Phase 5)을 하므로 여기서는 즉시 피드백용이다.
 */
export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 10

const ALLOWED = /^[가-힣a-zA-Z0-9 ]+$/
const PHONE = /\d{3}-?\d{3,4}-?\d{4}/
const EMAIL = /@/

export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** 문제가 없으면 null, 있으면 아이에게 보여 줄 안내 문구 */
export function validateNickname(raw: string): string | null {
  const name = normalizeNickname(raw)
  if (name.length === 0) return '닉네임을 입력해 주세요.'
  if (name.length < NICKNAME_MIN) return `닉네임은 ${NICKNAME_MIN}글자 이상이에요.`
  if (name.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}글자까지만 쓸 수 있어요.`
  if (!ALLOWED.test(name)) return '한글, 영어, 숫자, 띄어쓰기만 쓸 수 있어요.'
  if (PHONE.test(name) || EMAIL.test(name)) return '전화번호나 이메일은 넣지 말아 주세요.'
  return null
}
