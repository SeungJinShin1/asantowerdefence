/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 백엔드 API 베이스 URL — 프론트가 쓰는 유일한 환경변수 (docs/01 §3) */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
