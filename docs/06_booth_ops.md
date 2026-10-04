# 06. 배포와 부스 운영 가이드

대상: 부스 운영자(선생님). 코드 지식 없이 따라 할 수 있게 적었습니다. 개발 관련 세부는 `01_architecture.md`, Firestore 설정은 `firestore_setup.md`.

## 1. 배포 (처음 한 번)

### 백엔드 — Render
1. Render 대시보드 → **New → Blueprint** → 이 저장소 선택 → `backend/render.yaml` 이 읽힙니다.
2. 생성 후 환경변수 화면에서 비어 있는 값 입력:
   - `ALLOWED_ORIGINS`: Vercel 주소(예: `https://asan-defence.vercel.app`). 여러 개면 쉼표로.
   - `GEMINI_API_KEY`, `GEMINI_MODEL`: Gemini 키와 모델명(없으면 비워 둠 → 챗봇·오답 AI 노트만 꺼지고 게임은 동작).
   - `FIREBASE_SERVICE_ACCOUNT_B64`: `firestore_setup.md` 5절대로 만든 값(없으면 메모리 저장소 → 재시작 시 리더보드가 지워짐).
   - `SESSION_SECRET`, `ADMIN_TOKEN` 은 Render 가 자동 생성합니다. `ADMIN_TOKEN` 값은 2절(리더보드 초기화)에서 쓰니 적어 두세요.
3. 배포가 끝나면 `https://<render-app>.onrender.com/healthz` 가 `{"status":"ok",...}` 를 보여 줘야 합니다.

### 프론트 — Vercel
1. Vercel → **Add New Project** → 저장소 선택 → Root Directory `frontend`, Framework `Vite`.
2. 환경변수 `VITE_API_BASE_URL` = `https://<render-app>.onrender.com/api/v1`.
3. 배포 후 주소를 Render 의 `ALLOWED_ORIGINS` 에 넣고 Render 를 재배포합니다(CORS).

### 배포 전 자동 점검(개발자)
```bash
cd backend && pytest -q && ruff check .
cd frontend && npm run lint && npm test && npm run build && npm run check:secrets   # 번들에 비밀값 없음 확인
```

## 2. 부스 당일 체크리스트

- [ ] **서버 깨우기**: 무료 Render 는 15분 쉬면 잠듭니다. 행사 30분 전부터 외부 모니터(UptimeRobot 등)로 5분마다 `/healthz` 를 핑하거나, 유료 인스턴스로 올립니다. 프론트도 첫 화면에서 자동으로 깨웁니다.
- [ ] **부스 모드 확인**: Render 환경변수 `BOOTH_MODE=true`(스테이지당 3웨이브, 한 판 8~10분). 전체 모드로 바꾸려면 `false` 로 바꾸고 재배포.
- [ ] **태블릿/PC**: 가로 화면 고정, 브라우저 전체화면, 소리 설정, `https://<vercel-app>.vercel.app` 즐겨찾기.
- [ ] **리허설**: 한 판 끝까지(학습 → 게임 → 결과 → 오답 정리 → 명예의 전당 등록) 돌려 보고, 아래 3절로 테스트 기록을 지웁니다.
- [ ] **동시 접속 테스트**(개발자): `backend/scripts/smoke_concurrent.py --base https://<render-app>.onrender.com/api/v1 --players 10` → 429 가 나오면 요청 제한 한도 조정이 필요합니다(같은 공인 IP 에서 세션 생성은 분당 30개).
- [ ] **개인정보 안내문**: 타이틀 화면 하단 "닉네임과 점수만 기록됩니다" 문구가 보이는지. 부스 안내판에도 같은 문장을 적습니다.
- [ ] **다음 학생 교대**: 명예의 전당에서 "처음으로"를 누르면 세션·진행도가 지워집니다. 중간에 그만둔 경우 타이틀 로고를 5번 탭 → 운영자 메뉴 → "세션·진행도 초기화".

## 3. 리더보드 초기화 (관리자)

테스트 기록을 지우거나 행사 시작 전 비울 때. 되돌릴 수 없습니다.

```bash
curl -X POST https://<render-app>.onrender.com/api/v1/admin/leaderboard/reset -H "X-Admin-Token: <ADMIN_TOKEN>"
# → {"removed": 3}
```

Windows PowerShell:
```powershell
Invoke-RestMethod -Method Post -Uri "https://<render-app>.onrender.com/api/v1/admin/leaderboard/reset" -Headers @{ "X-Admin-Token" = "<ADMIN_TOKEN>" }
```

## 4. 문제·학습 카드 수정 후 재배포

1. `backend/app/content/questions.json`, `topics.json` 을 고칩니다(정답은 항상 `options[0]`, 보기 4개).
2. `cd backend && pytest -q tests/test_question_bank.py` 로 형식 검증(깨진 파일이면 서버가 기동되지 않습니다).
3. 커밋·푸시하면 Render 가 자동 재배포합니다. 변형 문제 캐시는 시작 시 백그라운드로 다시 만들어집니다(`GET /api/v1/admin/variants/status` 로 진행 확인).

## 5. 이미지 교체

`assets/raw/` 에 원본(2048px, 투명 배경)을 넣고 `backend/.venv/Scripts/python.exe scripts/prepare_assets.py` 를 실행하면 `frontend/public/assets/` 에 규격대로 저장됩니다. 파일명은 `assets/prompts/gemini_image_prompts.md` 표를 따릅니다. 이미지가 없으면 게임은 색 도형으로 대신 그립니다.

## 6. 문제가 생겼을 때

| 증상 | 확인 |
|---|---|
| 첫 화면에서 "서버를 깨우는 중" 이 오래감 | Render 슬립. 30초쯤 기다리거나 `/healthz` 를 직접 열어 본다 |
| "AI 선생님이 잠시 쉬고 있어요" | Gemini 키/모델 미설정 또는 한도 초과. 게임은 계속 가능 |
| 점수 검증 실패(SCORE_REJECTED) | 클라이언트 보고값이 상한을 넘음 — 보통 조작·버그. Render 로그에서 사유 확인 |
| 요청이 너무 많아요(429) | 같은 IP 에서 한도 초과. 1분 뒤 재시도. 반복되면 `03_api_contract.md` 의 한도 조정 |
