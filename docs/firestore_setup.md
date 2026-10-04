# Firestore 수동 설정 안내 (Phase 5.5)

백엔드는 **Admin SDK(서비스 계정)** 로만 Firestore 에 접근합니다. 아래는 사용자가 Firebase 콘솔/GCP 콘솔에서 직접 해야 하는 작업입니다. 모두 끝나면 `backend/.env`(또는 Render 환경변수)에 값을 넣고 `/healthz` 로 기동을 확인합니다.

## 1. 프로젝트와 데이터베이스

1. Firebase 콘솔 → 프로젝트 만들기(예: `asan-defence`).
2. Firestore Database → 데이터베이스 만들기 → **네이티브 모드**, 리전은 `asia-northeast3`(서울) 권장.

## 2. 보안 규칙 배포 (클라이언트 접근 전면 차단)

Firestore → 규칙 탭에 아래를 붙여 넣고 **게시**합니다. 프론트는 Firebase SDK 를 쓰지 않으므로 이 규칙으로 아무 문제가 없고, 혹시 모를 직접 접근을 막습니다(`docs/04 §2`).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

## 3. 세션 자동 삭제(TTL)

세션 문서에는 `expiresAt`(생성 + 3시간) 필드가 있습니다. GCP 콘솔 → Firestore → **TTL 정책** → 컬렉션 그룹 `defence_sessions`(접두사를 바꿨다면 그 이름), 타임스탬프 필드 `expiresAt` 로 정책을 만듭니다. 운영 중 세션이 쌓이지 않도록 하는 장치이며, 백엔드도 `purge_expired` 를 제공하지만 TTL 이 기본입니다.

## 4. 서비스 계정(최소 권한)

1. GCP 콘솔 → IAM 및 관리자 → 서비스 계정 → 만들기(예: `defence-backend`).
2. 역할은 **Cloud Datastore 사용자(`roles/datastore.user`)** 하나만 부여합니다(규칙 편집·프로젝트 소유 권한 불필요).
3. 키 → 새 키 만들기(JSON) → 파일을 내려받습니다. **이 파일은 저장소에 절대 커밋하지 않습니다**(`.gitignore` 에 `serviceAccount*.json` 포함).

## 5. 환경변수에 넣기

**가장 쉬운 방법(Render Secret Files)**: Render 서비스 → Environment → **Secret Files → Add Secret File** → Filename `firebase.json`, Contents 에 내려받은 JSON 파일 내용을 그대로 붙여넣기 → 저장. 그리고 환경변수 `FIREBASE_SERVICE_ACCOUNT_FILE=/etc/secrets/firebase.json` 을 추가합니다. base64 변환이 필요 없습니다.

**대안(base64 한 줄)**:

Render 환경변수는 여러 줄 JSON 을 다루기 불편하므로 base64 한 줄로 넣습니다.

- Windows PowerShell:
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\serviceAccount.json")) | Set-Clipboard
  ```
- macOS/Linux:
  ```bash
  base64 -w0 serviceAccount.json   # macOS 는 base64 -i serviceAccount.json
  ```

`backend/.env` 또는 Render:

```
FIREBASE_SERVICE_ACCOUNT_B64=<붙여넣기>
FIRESTORE_COLLECTION_PREFIX=defence_        # 개발/운영 분리: dev_ / defence_
```

값이 있으면 백엔드가 자동으로 Firestore 저장소(세션·변형 캐시·리더보드)를 쓰고, 없으면 메모리 저장소로 동작합니다(`backend/app/main.py`).

## 6. 확인

1. `uvicorn app.main:app --reload` 기동 로그에 오류가 없고 `GET /healthz` 가 200.
2. 게임을 한 판 끝내고 리더보드에 등록 → Firestore 콘솔 `defence_leaderboard` 에 문서가 생기는지 확인(닉네임·점수·도달 스테이지만 있고 개인정보 없음).
3. `defence_sessions` 문서의 `expiresAt` 이 TTL 정책 필드와 같은 이름인지 확인.

## 7. 체크리스트 (사용자 ✋)

- [ ] 규칙 게시 완료(전면 차단)
- [ ] TTL 정책(`defence_sessions.expiresAt`) 생성
- [ ] 서비스 계정 역할이 `roles/datastore.user` 하나뿐
- [ ] 서비스 계정 JSON 이 저장소 밖에 있고, base64 값이 환경변수에만 있음
- [ ] 개발/운영 접두사 분리(`FIRESTORE_COLLECTION_PREFIX`)
