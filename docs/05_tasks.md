# 05. 작업 순서 (Claude Code 시작점)

원칙: 각 Phase는 **작은 태스크 → 테스트 → 구현 → 리팩토링** 순서로 진행한다. 태스크 하나가 끝날 때마다 사용자에게 짧게 보고하고, ✋ 표시가 있는 지점에서는 **반드시 사용자에게 묻고 답을 받은 뒤** 진행한다.
숫자(밸런스)는 모두 `frontend/src/features/game/config/`와 `backend/app/domain/scoring.py` 상수에서만 바꾼다.

---

## Phase 0 — 계획 확인 (코드 없음)

- [ ] `CLAUDE.md`와 `docs/01~04`를 읽고, 이해한 구조를 10줄 이내로 요약해 사용자에게 보여 준다.
- [ ] ✋ 아래 확인 질문에 답을 받는다.
  1. 부스 모드(스테이지당 3웨이브) 기본값으로 시작해도 되는지
  2. 패키지 관리: 백엔드 `pip + requirements.txt`, 프론트 `npm`으로 진행해도 되는지
  3. Firestore·Gemini 키가 준비되었는지 (없으면 Phase 1~3은 메모리 저장소·Gemini 목(mock)으로 진행)
- [ ] 완료 기준: 사용자 동의.

## Phase 1 — 백엔드 뼈대 + 문제 은행 + 출제·채점 (Gemini·Firestore 없이 동작)

| # | 태스크 | 테스트(먼저 작성) | 완료 기준 |
|---|---|---|---|
| 1.1 | `backend/` 초기화: `app/main.py`, `core/config.py`, `core/logging.py`, `/healthz`, `requirements*.txt`, `.env.example`, ruff 설정 | `test_healthz.py` | `pytest` 통과, `uvicorn` 기동 |
| 1.2 | `services/question_bank.py`: `content/*.json` 로드, 스키마 검증(보기 4·정답 범위·topicId 존재·id 유일), 주제별·난이도별 조회 | `test_question_bank.py`(정상 로드 75문항, 깨진 파일은 명확한 예외) | 통과 |
| 1.3 | `domain/quiz_rules.py`: 보기 섞기(정답 위치 반환), 난이도 배정표, 세션 내 중복 제외·부족 시 폴백 순서 | `test_quiz_rules.py`(섞어도 정답 보존, 중복 없음, 부족 시 폴백) | 통과 |
| 1.4 | `domain/scoring.py`: 코인 공식(base·combo·fast·event), 콤보 갱신, 점수 공식, finish 상한 검증 | `test_scoring.py`(`02_game_design.md` §6·§9의 표를 그대로 케이스로) | 통과 |
| 1.5 | `services/session_store.py`: `SessionStore` 프로토콜 + `InMemorySessionStore` | `test_session_store.py` | 통과 |
| 1.6 | `core/security.py`: 세션 토큰 발급·검증, 관리자 토큰, slowapi 설정 | `test_security.py`(위조·만료 토큰 거부) | 통과 |
| 1.7 | 라우터: `GET /topics`(chatbotContext 미포함 검증), `POST /sessions`, `stages/{n}/start`, `quiz/more`, `quiz/answer`, `events`, `finish` | `test_routers_quiz_flow.py`(세션 생성 → 시작 → 답변 → 이벤트 → 종료 전체 흐름, 응답 JSON이 `03_api_contract.md`와 일치) | 통과 |
| 1.8 | 전역 예외 핸들러·오류 형식·JSON 로그·CORS | `test_errors.py` | 통과 |

- 보안 5항목 설명을 각 라우터 파일 상단 주석에 남긴다.
- 완료 보고 후 ✋ 사용자 확인.

## Phase 2 — 프론트 뼈대 + 학습·퀴즈 화면 (게임 없이 동작)

| # | 태스크 | 테스트 | 완료 기준 |
|---|---|---|---|
| 2.1 | `frontend/` 초기화(Vite React TS, Tailwind, router, zustand, vitest, eslint/prettier), `.env.example`, `vercel.json`, `app/ErrorBoundary` | 빌드·린트 통과 | `npm run dev` 화면 표시 |
| 2.2 | `shared/api/`: `client.ts`(타임아웃·재시도), `types.ts`(계약 1:1), 엔드포인트 함수 | `client.test.ts`(타임아웃·재시도·오류 매핑) | 통과 |
| 2.3 | `features/session`: 세션 시작, 토큰 `sessionStorage`, 만료 처리, 서버 깨우기(`/healthz`) | `sessionStore.test.ts` | 통과 |
| 2.4 | 페이지: Title(개인정보 안내 문구·부스 모드 숨김 메뉴), Nickname, StageSelect(해금 표시) | 스냅샷 최소, 상호작용 테스트 | 화면 전환 |
| 2.5 | `features/learning`: 카드 넘기기(진행률, 완료 시 `LEARN_COMPLETED` 이벤트), 챗봇 패널 UI(백엔드 `/chat` 연결은 Phase 4, 지금은 안내 문구) | `LearnCards.test.tsx` | 마지막 카드에서 보너스 표시 |
| 2.6 | `features/quiz`: `QuizModal`(문항·보기 4·15초 타이머·결과 표시·해설 3초), 콤보 표시 컴포넌트, `quizBatch` 큐 관리 훅 | `quizQueue.test.ts`, `QuizModal.test.tsx`(시간 초과 → -1 제출) | 통과 |
| 2.7 | 임시 "퀴즈 연습" 페이지로 백엔드와 연결해 출제→답변→코인 표시 흐름 확인 | 수동 확인 | 사용자 시연 ✋ |

## Phase 3 — 타워디펜스 엔진 (순수 로직 → 렌더 → 통합)

| # | 태스크 | 테스트 | 완료 기준 |
|---|---|---|---|
| 3.1 | `engine/state.ts`(GameState 타입·초기값), `config/balance.ts`·`waves.ts`·`events.ts`·`maps/onyang.ts` | 타입 컴파일 | — |
| 3.2 | `engine/path.ts`: 웨이포인트 따라 이동, 진행률, 성 도달 판정 | `path.test.ts` | 통과 |
| 3.3 | `engine/spawner.ts`: 웨이브 구성표대로 시간 기반 스폰, 황금 슬라임 확률, 보스 타이밍 | `spawner.test.ts`(시드 고정 RNG) | 통과 |
| 3.4 | `engine/tower.ts`·`projectile.ts`: 사거리·조준 우선순위·피해·관통·범위·감속·보스 추가 피해·업그레이드·판매 | `tower.test.ts` | 통과 |
| 3.5 | `engine/enemy.ts`: 체력·스테이지 배율·유령 반투명 주기·골렘 감속 면역·처치 코인 | `enemy.test.ts` | 통과 |
| 3.6 | `engine/events.ts`: `EventBus`, 이벤트 정의 데이터 적용(2배 타임, 웨이브 보너스, 콤보 마일스톤, 긴급 퀴즈 추가 피해) | `events.test.ts` | 통과 |
| 3.7 | `engine/loop.ts`: 고정 타임스텝, 일시정지(퀴즈 중), 퀴즈 트리거 타이머(18초/부스 14초), 러시·긴급 퀴즈 훅 | `loop.test.ts` | 통과 |
| 3.8 | `render/`: 배경(주제별 팔레트·도형), 경로, 타일 하이라이트, 스프라이트(이미지 없으면 색 사각형 폴백), HUD(코인·체력·웨이브·콤보·이벤트 타이머), 이펙트 | 수동 확인 | 60fps 근처 |
| 3.9 | `components/GameCanvas`·`BuildMenu`(타워 5종, 해금·비용·업그레이드·판매)·`EventToast`, Play 페이지 통합(퀴즈 모달·서버 이벤트 보고) | 통합 테스트 1개(웨이브 1 클리어 시나리오, 렌더 목) | 사용자 시연 ✋ |
| 3.10 | 나머지 맵 4개, Result 페이지(finish 호출), 실패 → 재도전, 스테이지 해금 | `result.test.ts` | 5스테이지 완주 |
| 3.11 | 밸런스 조정 라운드: 사용자와 함께 플레이 후 상수만 조정 | — | 사용자 확인 ✋ |

## Phase 4 — AI 연동 (챗봇·변형 출제·오답 정리)

| # | 태스크 | 테스트 | 완료 기준 |
|---|---|---|---|
| 4.1 | `services/gemini_client.py`: 타임아웃·재시도·JSON 응답 파싱, 목 객체 주입 가능 구조 | `test_gemini_client.py`(목) | 통과 |
| 4.2 | `prompts/chat_system.txt` + `services/chat.py` + `POST /chat`: 주제 `chatbotContext` 주입, 6턴 제한, 후처리, `suggested` 3개 | `test_chat.py`(목: 프롬프트에 근거 포함·범위 밖 질문 처리) | 통과 |
| 4.3 | `prompts/variation_system.txt` + `services/variation.py`: `fact`·정답 고정 변형 생성, 검증기, 캐시 저장, 시작 시 백그라운드 생성, `admin/variants/*` | `test_variation_validator.py`(잘못된 JSON·정답 불일치·중복·길이 초과 폐기) | 통과 |
| 4.4 | `stages/{n}/start`에서 변형 우선 출제로 교체 | 기존 흐름 테스트 갱신 | 통과 |
| 4.5 | `prompts/review_system.txt` + `services/review.py` + `POST /review`: 틀린 문제 일괄 해설·요약, 실패 시 빈 문자열 | `test_review.py`(목) | 통과 |
| 4.6 | 프론트: 챗봇 패널 연결(로딩·오류 문구), Review 페이지(다시 풀기, 로컬 채점) | `ReviewPage.test.tsx` | 사용자 시연 ✋ |

- ✋ 실제 Gemini 키로 변형 20개를 생성해 사용자에게 품질 검수를 받고, 프롬프트를 조정한다.

## Phase 5 — Firestore·리더보드·보안 마무리

| # | 태스크 | 테스트 | 완료 기준 |
|---|---|---|---|
| 5.1 | `FirestoreSessionStore`(프로토콜 구현), 변형 캐시 Firestore 저장, `APP_ENV`별 저장소 선택 | 에뮬레이터 또는 목 | 통과 |
| 5.2 | `domain/nickname.py` + `content/banned_words.txt` + `POST/GET /leaderboard` | `test_nickname.py`(금칙어·전화번호·길이), `test_leaderboard.py`(세션당 1회) | 통과 |
| 5.3 | 프론트 Leaderboard 페이지(등록·순위·내 순위 강조), 결과 화면 이탈 시 세션 정리 | `Leaderboard.test.tsx` | 통과 |
| 5.4 | 보안 점검: CORS 실제 도메인, 요청 제한 수치, 로그에 채팅 원문 없음, 번들에 비밀값 없음(`grep -r "GEMINI\|SESSION_SECRET" dist/` 비어 있음) | 체크리스트 | 사용자 보고 |
| 5.5 | 사용자 수동 작업 안내: Firestore 규칙 배포, TTL 설정(`expiresAt`), 서비스 계정 최소 권한 | 안내문 | ✋ 확인 |

## Phase 6 — 배포·리허설

- [ ] `backend/render.yaml`(또는 대시보드 설정), Render 환경변수 전부 입력, `/healthz` 확인, 시작 시 변형 캐시 생성 확인
- [ ] Vercel 배포, `VITE_API_BASE_URL` 설정, CORS에 Vercel 도메인 추가
- [ ] 부스 리허설 체크리스트: 서버 슬립 대비(모니터 핑), 태블릿 가로 화면, 동시 접속 10명 테스트(요청 제한 한도 확인), 이미지 로드 시간, 효과음 토글
- [ ] 운영 가이드 `docs/06_booth_ops.md` 작성: 부스 모드 켜기, 리더보드 초기화(관리자 엔드포인트 추가 여부 ✋), 문제 수정 후 재배포 절차

---

## 이미지 자산이 아직 없을 때

`render/sprites.ts`는 이미지 로드 실패 시 **타워는 색 사각형 + 이름 첫 글자, 몬스터는 색 원 + 눈 두 개**로 그린다. 자산이 오면 `public/assets/`에 넣는 것만으로 교체되어야 한다(파일명은 `assets/prompts/gemini_image_prompts.md` 표를 따른다).

## 정의: 완료(Definition of Done)

- 테스트 통과(`pytest`, `vitest`) + 린트 통과
- `03_api_contract.md`와 코드가 일치(달라졌으면 문서를 먼저 갱신)
- 보안 5항목 설명 남김
- 사용자에게 3줄 보고(만든 것 / 테스트 / 남은 리스크)
