# 01. 아키텍처

## 1. 시스템 구성

```
[학생 브라우저]  ── HTTPS ──▶  [프론트엔드 · Vercel]      정적 파일 (Vite 빌드)
       │                              │
       └────────── HTTPS (REST/JSON) ─┴──▶  [백엔드 · Render · FastAPI]
                                               ├── Gemini API   (GEMINI_API_KEY, 서버 전용)
                                               └── Firestore    (firebase-admin, 서비스 계정, 서버 전용)
```

- 프론트는 **백엔드 REST API만** 호출한다. Firebase·Gemini SDK를 쓰지 않는다.
- 백엔드가 **출제·채점·코인·점수·리더보드**를 모두 담당한다(서버 권위). 타워디펜스 시뮬레이션(몬스터 이동, 타워 공격)만 클라이언트에서 돌고, 그 결과는 서버가 상한 검사로 검증한다.
- Firestore 보안 규칙은 **클라이언트 접근 전면 차단**(`allow read, write: if false`). 오직 Admin SDK로만 접근한다.

## 2. 저장소 구조

```
defence/
├─ CLAUDE.md
├─ docs/
├─ assets/prompts/gemini_image_prompts.md
├─ .gitignore
├─ backend/
│  ├─ app/
│  │  ├─ main.py                  # 앱 생성, CORS, 예외 핸들러, 라우터 등록, /healthz
│  │  ├─ core/
│  │  │  ├─ config.py             # pydantic-settings (환경변수)
│  │  │  ├─ security.py           # 세션 토큰(HMAC), 관리자 토큰 검사, 요청 제한 설정
│  │  │  ├─ errors.py             # AppError 계층, 오류 응답 형식, 전역 예외 핸들러
│  │  │  └─ logging.py            # JSON 구조화 로그 + 요청 로그 미들웨어(request_id)
│  │  ├─ domain/                  # 순수 도메인 로직 (외부 의존 없음, 테스트 최우선)
│  │  │  ├─ models.py             # Topic, Question, Variant, Quiz, Session 등 pydantic 모델
│  │  │  ├─ scoring.py            # 코인·콤보·점수 공식, 상한 검증
│  │  │  ├─ quiz_rules.py         # 난이도 선택, 중복 방지, 보기 섞기
│  │  │  └─ nickname.py           # 닉네임 정제·검증
│  │  ├─ services/
│  │  │  ├─ question_bank.py      # content/*.json 로드·검증
│  │  │  ├─ variation.py          # Gemini 변형 생성 + 스키마 검증 + 캐시
│  │  │  ├─ gemini_client.py      # google-genai 래퍼 (재시도, 타임아웃)
│  │  │  ├─ chat.py               # 학습 챗봇 프롬프트·응답
│  │  │  ├─ review.py             # 오답 정리 프롬프트·응답
│  │  │  ├─ quiz_service.py       # 출제·채점 오케스트레이션 (stages/start, quiz/more, quiz/answer)
│  │  │  ├─ session_service.py    # 세션 생성, 이벤트 검증·기록, finish 점수 확정
│  │  │  ├─ session_store.py      # 세션 CRUD — SessionStore 프로토콜 + InMemorySessionStore
│  │  │  ├─ firestore_store.py    # Firestore 구현(세션·변형 캐시·리더보드) — 서비스 계정 env 있을 때만 선택됨
│  │  │  └─ leaderboard.py
│  │  ├─ routers/
│  │  │  ├─ schemas.py            # 03_api_contract.md의 요청/응답 DTO (camelCase)
│  │  │  ├─ topics.py  quiz.py  sessions.py  chat.py  review.py  leaderboard.py  admin.py
│  │  ├─ content/                 # topics.json, questions.json (서버 전용)
│  │  └─ prompts/                 # chat_system.txt, review_system.txt, variation_system.txt
│  ├─ tests/                      # pytest (domain → services → routers 순)
│  ├─ requirements.txt  requirements-dev.txt
│  ├─ .env.example
│  ├─ render.yaml                 # Render Blueprint(프록시 헤더·헬스체크·환경변수 목록)
│  └─ scripts/smoke_concurrent.py # 부스 리허설용 동시 접속 스모크
├─ scripts/prepare_assets.py         # 이미지 자산 정리(흰 배경 제거·트림·리사이즈 → frontend/public/assets)
├─ assets/raw/                       # 원본 이미지(gitignore)
└─ frontend/
   ├─ public/assets/
   │  ├─ towers/   tower_*.png
   │  └─ enemies/  enemy_*.png  boss_*.png
   ├─ src/
   │  ├─ app/                     # 라우터, 전역 Provider, ErrorBoundary
   │  ├─ shared/
   │  │  ├─ api/                  # fetch 래퍼, 엔드포인트 함수, 타입 (03_api_contract.md와 1:1)
   │  │  ├─ ui/                   # Button, Modal, ProgressBar 등 공통 컴포넌트
   │  │  └─ lib/                  # 유틸
   │  ├─ features/
   │  │  ├─ session/              # 세션 시작·닉네임 입력·상태(zustand)
   │  │  ├─ learning/             # 주제 학습 카드 + 챗봇 패널
   │  │  ├─ quiz/                 # 퀴즈 팝업 모달, 타이머, 콤보 표시
   │  │  ├─ game/
   │  │  │  ├─ engine/            # 순수 로직: loop, path, spawner, tower, enemy, projectile, events, state
   │  │  │  ├─ render/            # Canvas 그리기: background(주제별, 캐시), sprites(이미지 없으면 도형 폴백), effects, draw(프레임)
   │  │  │  ├─ config/            # balance.ts, waves.ts, maps/*.ts (숫자·구성은 여기서만 수정)
   │  │  │  ├─ components/        # GameCanvas, Hud(DOM — 글자 크기·접근성 때문에 Canvas 대신), BuildMenu, EventToast
   │  │  │  ├─ controller.ts       # 엔진 ↔ React 다리(useSyncExternalStore 스냅샷, 액션, outbox 전달)
   │  │  │  └─ runStore.ts         # 한 판 누적 기록(finish 보고값)
   │  │  ├─ review/               # 오답 정리 화면
   │  │  ├─ leaderboard/          # 기록 등록·순위 화면
   │  │  └─ result/               # 결과 화면
   │  ├─ pages/                   # Title, Nickname, StageSelect, Learn, Play, Result, Leaderboard
   │  └─ main.tsx
   ├─ tests/ (또는 각 폴더 옆 *.test.ts)
   ├─ .env.example
   └─ vercel.json
```

## 3. 환경변수

### backend/.env
| 변수 | 설명 |
|---|---|
| `APP_ENV` | `development` / `production` |
| `ALLOWED_ORIGINS` | CORS 허용 목록 (쉼표 구분). 예: `https://<vercel-app>.vercel.app,http://localhost:5173` |
| `SESSION_SECRET` | 세션 토큰 HMAC 비밀키 (32자 이상 랜덤) |
| `ADMIN_TOKEN` | `/api/v1/admin/*` 호출용 토큰 |
| `GEMINI_API_KEY` | Gemini API 키 |
| `GEMINI_MODEL` | 텍스트 모델명 (예: 사용자가 지정). 하드코딩 금지 |
| `FIREBASE_SERVICE_ACCOUNT_B64` | 서비스 계정 JSON을 base64로 인코딩한 값 (Render 환경변수는 여러 줄 JSON을 다루기 불편하므로 base64 사용). 값이 있으면 Firestore 저장소, 없으면 메모리 저장소. 설정 절차는 `docs/firestore_setup.md` |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | (대안) 서비스 계정 JSON 파일 경로. Render Secret Files 사용 시 `/etc/secrets/firebase.json`. b64 와 둘 중 하나 |
| `FIRESTORE_COLLECTION_PREFIX` | 기본 `defence_` (개발/운영 분리용) |
| `VARIANTS_PER_QUESTION` | 문제당 생성할 변형 수 (기본 2) |
| `BOOTH_MODE` | `true`(기본, 스테이지당 3웨이브) / `false`(5웨이브). 세션 생성 시 확정되어 `boothMode`·`wavesPerStage`로 내려간다 |
| `LOG_LEVEL` | 로그 레벨 (기본 `INFO`) |
| `RATE_LIMIT_ENABLED` | 요청 제한 on/off (기본 `true`, 테스트에서만 `false`) |
| `SENTRY_DSN` | (선택) 비어 있으면 미사용 |

### frontend/.env
| 변수 | 설명 |
|---|---|
| `VITE_API_BASE_URL` | 예: `http://localhost:8000/api/v1` / `https://<render-app>.onrender.com/api/v1` |

프론트 환경변수는 **`VITE_API_BASE_URL` 하나뿐**이어야 한다. 비밀값이 `VITE_` 접두사로 들어가면 번들에 노출된다.

## 4. 로컬 실행 순서

1. `backend/.env` 작성 (Firestore 없이 개발하려면 `APP_ENV=development`에서 메모리 세션 저장소 사용 — `session_store.py`의 `InMemorySessionStore`)
2. `uvicorn app.main:app --reload` → `GET http://localhost:8000/healthz` 확인
3. `frontend/.env`에 `VITE_API_BASE_URL=http://localhost:8000/api/v1`
4. `npm run dev`

## 5. 배포

### Render (백엔드)
- Web Service, 루트 디렉터리 `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/healthz`
- 환경변수: 위 표 전부. `APP_ENV=production`
- **무료 인스턴스는 15분 미사용 시 잠들어 첫 응답이 30초 이상 걸릴 수 있다.** 부스 당일은 유료 인스턴스로 올리거나, 외부 모니터(예: 5분 간격 `/healthz` 핑)를 걸어 둔다. 프론트는 첫 화면에서 `/healthz`를 미리 호출해 서버를 깨운다.
- 시작 시 변형 문제 캐시가 비어 있으면 백그라운드 태스크로 생성한다(요청을 막지 않음).

### Vercel (프론트엔드)
- 루트 디렉터리 `frontend`, Framework preset: Vite
- 환경변수 `VITE_API_BASE_URL`
- `vercel.json`에 SPA 리라이트(`/(.*)` → `/index.html`)

## 6. 로깅·에러 처리

- 백엔드: JSON 구조화 로그를 stdout으로 출력(Render 로그에서 확인). 필드: `time, level, request_id, path, status, duration_ms, session_id(있으면), message`. 예외는 전역 핸들러가 잡아 `{"error": {"code", "message"}}`로 응답하고 스택은 로그에만 남긴다. 사용자에게 내부 정보·스택을 노출하지 않는다.
- 프론트: 최상위 `ErrorBoundary`가 게임 중 예외를 잡아 "잠시 문제가 생겼어요, 다시 시도" 화면으로 안내. `console.error`는 개발 환경에서만.
- `SENTRY_DSN`이 있으면 백엔드에 Sentry 연동(선택).

## 7. 성능 목표

- 게임 루프 60fps 목표, 최소 30fps (고정 타임스텝 `1/60`, 렌더는 rAF)
- 퀴즈 팝업 표시 지연 < 100ms (문제는 스테이지 시작 시 서버에서 묶음으로 미리 받아 둔다: `POST /stages/{n}/start` 응답의 `quizBatch`)
- 초기 로드 < 3초(이미지 자산 총합 3MB 이하 목표, 각 PNG 256~512px)
