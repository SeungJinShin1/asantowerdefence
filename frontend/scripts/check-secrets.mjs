// 빌드 산출물(dist/)에 비밀값·서버 전용 필드가 섞이지 않았는지 검사한다 (docs/05 5.4, docs/04 §7 ENV 노출 방지).
// 사용: npm run build && npm run check:secrets
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PATTERNS = [
  /GEMINI_API_KEY/,
  /SESSION_SECRET/,
  /ADMIN_TOKEN/,
  /FIREBASE_SERVICE_ACCOUNT/,
  /AIza[0-9A-Za-z_-]{30,}/, // Google API 키 형태
  /"private_key"/,
  /chatbotContext/,
  /answerIndex/,
]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`dist/ 가 없어요. 먼저 npm run build 를 실행하세요. (${DIST})`)
  process.exit(2)
}

const hits = []
for (const file of files) {
  if (!/\.(js|css|html|json|map)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) hits.push(`${file}: ${pattern}`)
  }
}

if (hits.length) {
  console.error('번들에서 비밀값/서버 전용 식별자가 발견되었습니다:')
  for (const hit of hits) console.error(`  - ${hit}`)
  process.exit(1)
}
console.log(`check:secrets OK — ${files.length}개 파일에서 비밀값 없음`)
