# 03. API 계약

Base URL: `{VITE_API_BASE_URL}` = `https://<render-app>.onrender.com/api/v1`
모든 요청·응답은 JSON, UTF-8. 시간은 ISO 8601(UTC).

## 공통

- 인증: 세션이 필요한 엔드포인트는 헤더 `X-Session-Token: <token>` (`POST /sessions` 응답값). 토큰은 `sessionId.exp.signature`(HMAC-SHA256, 3시간 유효).
- 관리자: `X-Admin-Token: <ADMIN_TOKEN>`.
- 오류 형식:
  ```json
  { "error": { "code": "SESSION_EXPIRED", "message": "세션이 만료되었어요. 처음부터 다시 시작해 주세요." } }
  ```
  코드: `VALIDATION_ERROR`(422), `UNAUTHORIZED`(401), `SESSION_EXPIRED`(401), `NOT_FOUND`(404), `RATE_LIMITED`(429), `SCORE_REJECTED`(400), `NICKNAME_REJECTED`(400), `AI_UNAVAILABLE`(503), `INTERNAL`(500)
- 요청 제한(IP 기준, slowapi): 기본 120/분. `POST /chat` 20/분, `POST /review` 5/분, `POST /leaderboard` 5/분, `POST /sessions` 30/분, `POST /sessions/teacher` 5/분.

## 엔드포인트

### GET /healthz
`200 {"status":"ok","version":"0.1.0","variantsReady":true}` — 프론트 첫 화면에서 서버 깨우기용.

### GET /topics
학습 카드·메타. **`chatbotContext` 제외.**
```json
[{ "id":"onyang","order":1,"title":"온양온천","subtitle":"왕들이 사랑한 휴양지","era":"백제 ~ 현재",
   "keywords":["탕정","온수"], "cards":[{"id":"onyang-c1","title":"...","body":"..."}] }]
```

### POST /sessions
```json
→ { "nickname": "역사탐험가" }              // 선택. 없으면 null
← 201 { "sessionId":"s_9f2...", "token":"s_9f2....1727...abc", "expiresAt":"...", "boothMode":true, "teacher":false }
```

### POST /sessions/teacher
교사 모드 세션 생성(운영자 메뉴). 요청 `{ "code": "<교사 코드>" }` → 201, 본문은 `POST /sessions` 와 같고 `"teacher": true` (일반 세션은 `false`).
- 서버 환경변수 `TEACHER_CODE` 와 상수 시간 비교(앞뒤 공백 무시, 대소문자 구분). 비어 있으면 404 `NOT_FOUND`(교사 모드 꺼짐), 틀리면 401 `UNAUTHORIZED`("교사 코드가 맞지 않아요."). IP당 5/분. 코드는 응답·로그에 남기지 않는다.
- 교사 세션(`isTeacher`): 화면이 모든 단계를 연다. `POST /leaderboard` 는 409, `finish` 의 남은 코인이 상한을 넘으면 거부 대신 상한으로 깎아 계산한다(검수용 코인 받기 때문).

### POST /sessions/{sessionId}/stages/{stageOrder}/start   (X-Session-Token)
스테이지 시작. 서버가 문제 묶음을 준비한다(변형 캐시 우선, 없으면 원본).
```json
→ { "retry": false }
← { "stageOrder":1, "topicId":"onyang", "wavesPerStage":3,
    "quizBatch":[
      { "quizId":"q_01H...", "difficulty":1, "kind":"normal",
        "stem":"백제 시대에 온양을 부르던 이름은 무엇일까요?",
        "options":["온수(溫水)","탕정(湯井)","온창(溫昌)","온양(溫陽)"], "timeLimitSec":15 }
    ] }
```
- `quizBatch`는 난이도별로 충분히(일반 12 + 긴급 2 + 러시 3 = 17문항 목표) 담는다. 정답 위치는 서버만 안다(`quizId → correctIndex`).
- `kind`: `normal` | `emergency` | `rush`. 프론트는 kind별로 필요한 시점에 꺼내 쓴다.
- 출제 우선순위(`domain/quiz_rules.py`): ① 세션에서 아직 안 나온 원본 → ② 아직 안 나온 변형(Phase 4) → ③ 이미 나왔지만 틀렸던 문제 → ④ 이미 나온 문제 재출제(보기 다시 섞음, 최후 수단). 주제당 원본이 15문항이므로 ④까지 내려갈 수 있고, 한 배치 안에서는 같은 원본이 두 번 나오지 않는다. 그래도 문항이 모자라면 배치는 17보다 작을 수 있다(프론트는 `quiz/more`로 보충).
- `retry:true`(같은 스테이지 재도전): 그 스테이지의 이벤트 횟수 상한만 초기화한다. 정답·콤보·코인 통계는 누적.

### GET /sessions/{sessionId}/quiz/more?stage=1&count=5&kind=normal&wave=2   (X-Session-Token)
배치가 바닥났을 때 추가 문제. `count` 1~10(기본 5), `kind` `normal`(기본) | `emergency` | `rush`, `wave`(선택, 난이도 배정용 — 없으면 마지막 웨이브 기준). 출제 우선순위는 `stages/{n}/start`와 같다.
```json
← { "quizBatch":[ { "quizId":"q_01J...", "difficulty":2, "kind":"normal", "stem":"...", "options":["..."], "timeLimitSec":15 } ] }
```

### POST /sessions/{sessionId}/quiz/answer   (X-Session-Token)
```json
→ { "quizId":"q_01H...", "choiceIndex":1, "answeredMs":4200, "wave":2 }
← { "correct":true, "correctIndex":1, "explanation":"온양의 이름은 ...",
    "coins":70, "breakdown":{"base":30,"comboMult":2,"fastBonus":10,"eventMult":1},
    "combo":2, "comboMax":2, "coinsFromQuiz":130 }
```
- `choiceIndex: -1` = 시간 초과. 같은 `quizId`에 두 번 답하면 `409 VALIDATION_ERROR`.
- 서버는 `DOUBLE_COIN_TIME` 활성 여부를 세션 이벤트 기록으로 판단해 `eventMult`를 적용한다.

### POST /sessions/{sessionId}/events   (X-Session-Token)
클라이언트 게임 사건 보고(서버 코인 배율·검증용).
```json
→ { "type":"MIDBOSS_DEFEATED", "stageOrder":1, "wave":2, "at":"2026-10-01T02:11:05Z" }
← { "accepted":true, "activeEvents":[{"type":"DOUBLE_COIN_TIME","until":"2026-10-01T02:11:25Z"}] }
```
- 허용 type: `MIDBOSS_DEFEATED`, `FINALBOSS_DEFEATED`, `WAVE_CLEARED`, `STAGE_FAILED`, `LEARN_COMPLETED`.
- 서버 검증: 스테이지당 `MIDBOSS_DEFEATED` 1회, `FINALBOSS_DEFEATED` 1회, `WAVE_CLEARED`는 `wavesPerStage`회까지. 초과분은 `accepted:false`로 무시(오류 아님).

### POST /sessions/{sessionId}/finish   (X-Session-Token)
```json
→ { "stagesCleared":3, "wavesCleared":9, "livesLeftAtEnd":7, "coinsLeftAtEnd":180, "clientScore":4690 }
← { "score":4690, "breakdown":{"correct":1200,"combo":250,"waves":1350,"stages":1500,"lives":210,"coins":180},
    "correctCount":12, "answeredCount":15, "comboMax":5, "stageReached":3,
    "wrongQuizIds":["q_01H...","q_01J..."] }
```
- 검증 실패 시 `400 SCORE_REJECTED`(로그에 상세). 클라이언트 점수와 서버 점수가 다르면 **서버 점수**를 쓴다.
- 세션 상태를 `finished`로 바꾼다. 이후 `answer`/`events`는 `409`.

### POST /sessions/{sessionId}/review   (X-Session-Token, finished 세션만)
틀린 문제 일괄 해설.
```json
→ {}
← { "items":[
      { "quizId":"q_01H...", "stem":"...", "yourAnswer":"온수(溫水)", "correctAnswer":"탕정(湯井)",
        "explanation":"(문제 은행 해설)", "aiNote":"(Gemini가 초등 눈높이로 2~3문장 추가 설명)",
        "retryOptions":["온수(溫水)","탕정(湯井)","온창(溫昌)","온양(溫陽)"], "retryCorrectIndex":1 }
    ],
    "summary":"이번 판에서는 온양의 옛 이름과 ...을 다시 살펴보면 좋겠어요." }
```
- 게임이 끝난 뒤이므로 `retryCorrectIndex`를 내려보내 로컬에서 다시 풀 수 있게 한다(점수 미반영).
- Gemini 실패 시 `aiNote`·`summary`를 빈 문자열로 내려보내되 200을 유지한다(문제 은행 해설만으로도 화면이 완성되도록).

### POST /chat   (X-Session-Token)
학습 챗봇. 해당 주제 `chatbotContext`를 시스템 프롬프트에 넣어 답한다.
```json
→ { "topicId":"onyang", "messages":[{"role":"user","content":"온양이라는 이름은 왜 생겼어?"}] }
← { "reply":"세종 임금님이 온양에 행궁을 짓고 온천에서 병을 치료한 것을 기념해서 ...", "suggested":["온양행궁은 누가 지었어?","신정비가 뭐야?"] }
```
- `messages`는 최근 6턴까지만 받는다(초과분은 서버가 잘라 냄). 각 메시지 500자 제한.
- 시스템 프롬프트 규칙(`backend/app/prompts/chat_system.txt`): 초등학생 눈높이, 3~4문장, 존댓말이 아닌 친근한 반말체("~해요" 톤), 주어진 근거 밖의 사실은 "자료에 없어요"라고 답함, 개인정보 묻지 않음, 주제와 무관한 요청은 정중히 주제로 돌림.

### POST /leaderboard   (X-Session-Token, finished 세션만)
```json
→ { "nickname":"역사탐험가" }
← 201 { "rank":4, "score":3120, "nickname":"역사탐험가" }
```
- 닉네임 규칙(`domain/nickname.py`): 앞뒤 공백 제거, 2~10자, 한글·영문·숫자·공백만, 금칙어 목록(욕설·비속어, 전화번호·이메일 패턴) 거부 → `400 NICKNAME_REJECTED`. 세션당 1회만 등록.

### GET /leaderboard?limit=20
```json
← [{ "rank":1, "nickname":"역사탐험가", "score":4520, "stageReached":5, "createdAt":"..." }]
```

### POST /admin/variants/rebuild   (X-Admin-Token)
변형 문제 캐시 재생성(백그라운드). `202 {"queued":true}`.

### GET /admin/variants/status   (X-Admin-Token)
`{ "total":75, "withVariants":70, "perTopic":{"onyang":15,...}, "lastBuiltAt":"..." }`

## 프론트 API 클라이언트 규칙

- `shared/api/client.ts`: `fetch` 래퍼. 타임아웃 10초, 5xx·네트워크 오류 1회 재시도(`answer`·`events`·`finish`·`leaderboard`는 멱등하지 않으므로 재시도 시 같은 `quizId`/동일 본문으로만).
- `shared/api/types.ts`: 이 문서의 JSON을 TypeScript 타입으로 그대로 옮긴다. 백엔드 pydantic 모델과 필드명·형식이 다르면 이 문서를 먼저 고치고 양쪽을 맞춘다.
