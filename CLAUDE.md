# 아산 향토사 프로젝트 — AI 챗봇 학습 + 타워디펜스 게임 (`defence`)

부스에서 초등학생이 **아산 향토사를 AI 챗봇과 함께 배우고 → 퀴즈 정답으로 코인을 얻어 → 타워를 세워 5단계 타워디펜스를 클리어**하는 온라인 게임입니다.
게임이 끝나면 AI가 틀린 문제를 정리해 주고, 다시 도전하거나 기록(닉네임·점수)을 남깁니다.

## 문서 지도 (반드시 이 순서로 읽기)

| 문서 | 내용 |
|---|---|
| `docs/05_tasks.md` | **작업은 여기서 시작.** 단계별 작업, 테스트, 완료 기준, 사용자에게 물어야 할 체크포인트 |
| `docs/01_architecture.md` | 시스템 구조, 폴더 구조, 환경변수, 로컬 실행, 배포(Vercel·Render) |
| `docs/02_game_design.md` | 화면 흐름, 스테이지·웨이브, 타워·몬스터 스탯, 퀴즈 팝업·콤보·이벤트, 점수 공식 |
| `docs/03_api_contract.md` | 프론트 ↔ 백엔드 API 계약 (요청/응답 JSON) |
| `docs/04_data_model_and_security.md` | Firestore 컬렉션, 세션 토큰, 검증 규칙, 보안 5항목 대응 |
| `assets/prompts/gemini_image_prompts.md` | 이미지 자산 목록·파일명·규격 (이미지는 사용자가 Gemini로 생성해 제공) |
| `backend/app/content/README.md` | 문제 은행·학습 카드 스키마 (`questions.json`, `topics.json`) |

## 작업 방식 — 반드시 지킬 것

1. **계획 먼저.** 작업 지시를 받으면 코드를 쓰기 전에 접근 계획(수정할 파일, 순서, 테스트)을 브리핑하고 동의를 받은 뒤 구현한다.
2. **큰 수정은 묻는다.** 여러 모듈에 걸친 변경, 구조 변경, 의존성 추가는 먼저 사용자에게 묻는다.
3. **불명확하면 되묻는다.** 추측해서 실행하지 말고 이해한 바를 먼저 말하고 확인받는다.
4. **작은 단위 + TDD.** 테스트 작성 → 통과하는 구현 → 리팩토링. 태스크는 테스트가 통과해야 완료다.
5. **모듈화.** 기능별 모듈/컴포넌트로 분리한다. 한 파일이 300줄을 넘으면 분리를 검토한다. 게임 엔진 로직은 DOM·Canvas와 분리된 순수 함수로 작성해 vitest로 검증한다.
6. **보안 5항목 설명.** 새 기능·페이지·엔드포인트를 만들 때 아래 5항목이 어떻게 반영됐는지 짧게 설명한다(주석 또는 작업 요약). 취약한 설계면 경고하고 안전한 대안을 먼저 제시한다.
   - 라우트 보호·접근 제어 / DB 보안 규칙 / ENV 프론트 노출 방지 / 중요 로직 서버 측 검증 / 프로덕션 에러 로그 처리
7. **소통.** 항상 공손한 한국어. 코드 식별자는 영어, 주석·문서·커밋 메시지는 한국어.
8. **컨텍스트 관리.** 대화가 길어져 컨텍스트의 약 85%에 이르면 compact를 제안한다.
9. **완료 보고.** 태스크가 끝나면 무엇을 만들었는지, 어떻게 테스트했는지, 남은 리스크가 무엇인지 3줄 이내로 보고한다.

## 기술 스택 (고정)

| 영역 | 선택 |
|---|---|
| 프론트엔드 | Vite + React 18 + TypeScript(strict) + Tailwind CSS + zustand + react-router. 게임은 Canvas 2D 커스텀 엔진(외부 게임엔진 없음). 테스트 vitest + Testing Library. 배포 Vercel |
| 백엔드 | Python 3.12 + FastAPI + pydantic v2 + pydantic-settings + uvicorn. Gemini는 `google-genai` SDK. Firestore는 `firebase-admin`(Admin SDK). 요청 제한 `slowapi`. 테스트 pytest + httpx. 린트 ruff. 배포 Render(Web Service) |
| 데이터 | Firestore — **백엔드(Admin SDK)만 접근.** 프론트는 Firebase SDK를 사용하지 않는다 |
| AI | Gemini API — **백엔드에서만 호출.** 모델명은 `GEMINI_MODEL` 환경변수로 관리(하드코딩 금지) |
| 이미지 | 타워·몬스터·보스 PNG는 사용자가 Gemini로 생성해 `frontend/public/assets/`에 넣는다. 배경·맵·UI·이펙트는 코드(SVG/Canvas)로 그린다 |

## 도메인 용어 (이 이름을 코드에 그대로 사용)

| 용어 | 코드 이름 | 뜻 |
|---|---|---|
| 주제 | `Topic` | 향토사 주제 = 스테이지 1개 (`onyang`, `maengsaseong`, `yisunsin`, `gongseri`, `seonjang`) |
| 학습 카드 | `Card` | 학습 단계에서 읽는 카드 |
| 문제 | `Question` | 문제 은행 원본 (서버 전용 필드: `answerIndex`, `fact`) |
| 변형 문제 | `Variant` | Gemini가 원본의 `fact`를 고정하고 문장·오답만 바꾼 문제 |
| 출제 | `Quiz` | 세션에 실제로 나간 문제 1건 (`quizId`, 섞인 보기, 정답 위치는 서버만 보관) |
| 세션 | `Session` | 한 명의 한 판. 서버가 정답 수·콤보·코인·이벤트를 기록 |
| 스테이지 | `Stage` | 주제 1개 = 웨이브 5개 (3웨이브 중간보스, 5웨이브 최종보스) |
| 웨이브 | `Wave` | 몬스터 묶음 1회 |
| 타워 | `Tower` | 5종. 스테이지 N 클리어 시 타워 N 해금 |
| 몬스터 | `Enemy` | '망각의 괴물'. 일반 5종 + 황금 슬라임 + 중간보스 + 최종보스 |
| 성(기지) | `Base` | 지켜야 하는 곳. 체력 = `lives` |
| 콤보 | `Combo` | 연속 정답 수. 2연속 ×2, 3연속 이상 ×3 |
| 이벤트 | `GameEvent` | 코인이 늘어나는 보너스만 존재. **감점·패널티 이벤트 없음** |
| 점수 | `Score` | 서버가 최종 계산 (`docs/02_game_design.md` 공식) |
| 리더보드 | `Leaderboard` | 닉네임·점수·도달 스테이지만 저장. 개인정보 없음 |
| 오답 정리 | `Review` | 게임 종료 후 틀린 문제를 AI가 일괄 해설 |

## 절대 하지 말 것

- 프론트 번들·응답에 `answerIndex`, `fact`, `chatbotContext`, `GEMINI_API_KEY`, Firebase 서비스 계정을 넣지 않는다.
- 프론트에서 Firebase SDK, Gemini SDK를 사용하지 않는다.
- 감점·코인 감소·체력 감소형 **퀴즈** 이벤트를 만들지 않는다 (몬스터가 성에 도달해 `lives`가 줄어드는 것은 타워디펜스 기본 규칙이므로 허용).
- 웨이브 진행 중 Gemini를 동기 호출하지 않는다 (변형 문제는 스테이지 시작 전에 미리 생성·캐시).
- 학생 개인정보(이름·학교·학년·연락처)를 어디에도 저장하지 않는다. 닉네임만 저장한다.
- 테스트 없이 게임 규칙(코인·콤보·점수·웨이브) 로직을 변경하지 않는다.

## 자주 쓰는 명령

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
pytest -q && ruff check .

# frontend
cd frontend && npm install
npm run dev        # http://localhost:5173
npm run test       # vitest
npm run build && npm run lint
```

## 현재 상태 (2026-10-04)

- 콘텐츠(문제 75문항, 학습 카드 34장)는 `backend/app/content/`에 준비됨 (사용자 검수 중 — 파일 내용은 사용자가 수정할 수 있음)
- Phase 1~5 구현 완료(백엔드·프론트·타워디펜스 엔진·AI 연동(목)·Firestore 저장소·리더보드·보안 점검). Phase 6은 배포 자산(`backend/render.yaml`, `docs/06_booth_ops.md`, 스모크 스크립트)까지 준비됨 — 실제 Render/Vercel 배포와 Firestore 수동 설정(`docs/firestore_setup.md`)은 사용자 작업.
- Gemini·Firestore 키는 아직 없음 → 메모리 저장소·Gemini 목으로 동작. 실제 키가 생기면 변형 20개 품질 검수(✋)부터 한다.
- 2026-10-05 게임성 개편: 퀴즈는 몬스터 수 기준 출제(`config/waves.quizMarksFor`), 부스 웨이브 13→23→37마리, 타워 업그레이드 옵션 4종(`config/upgrades.ts`, 타워당 6회), 게임 속도 ×1~×8(기본 ×2), Play 화면 전체 폭. 밸런스는 `engine/balance.sim.test.ts` 표로 확인.
- 2026-10-05 타워 재설계: 나중에 열리는 타워일수록 비싸고 강함(비용 50/70/100/120/150, 초당 피해 7→12→33→20(광역)→44), 단계별 배율 `STAGE_SCALE`(체력 1.0→2.5, 보스 0.55→2.6, 수량 0.6→1.2), 시작 코인 150. 타워별 발사체·명중 이펙트는 `render/projectiles.ts`·`render/effects.ts`. 밸런스는 반드시 `balance.sim.test.ts`의 **초보(새 타워를 먼저 사는) 플레이어** 표로 확인한다.
- 2026-10-05 교사 모드: 타이틀 로고 5탭 → 운영자 메뉴 → 교사 코드(`TEACHER_CODE` env, `POST /sessions/teacher`). 모든 단계 열림(`useStageAccess`), 검수 도구(`engine/teacher.ts`), 원리 안내 패널, 리더보드 제외(서버). 계정·로그인은 만들지 않는다.
- 이미지 자산 19장은 `frontend/public/assets/`에 배치됨(원본은 `assets/raw/`, 재처리는 `scripts/prepare_assets.py`). 슬라임·골렘 원본은 왼쪽을 봐서 `render/sprites.ts`의 `FACES_LEFT`로 보정.
