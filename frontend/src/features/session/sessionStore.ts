/**
 * 세션 상태(zustand) — docs/02 §1, docs/04 §3.
 *
 * 보안:
 * - 토큰은 메모리(스토어)와 sessionStorage 에만 둔다. localStorage 금지 — 부스 공용 PC에서 다음 학생에게 남지 않도록.
 * - 결과 화면을 떠나거나 만료(401 SESSION_EXPIRED/UNAUTHORIZED)되면 즉시 지운다.
 * - 토큰·세션 id 는 로그로 남기지 않는다.
 */
import { create } from 'zustand'

import { ApiError, api as defaultApi, type Api, type SessionAuth } from '@/shared/api'

export const SESSION_STORAGE_KEY = 'defence.session.v1'

export type SessionStatus = 'idle' | 'starting' | 'ready' | 'expired' | 'error'

export interface PersistedSession {
  sessionId: string
  token: string
  /** ISO 8601 */
  expiresAt: string
  boothMode: boolean
  nickname: string | null
}

export interface WakeOptions {
  attempts?: number
  delayMs?: number
}

export interface SessionState {
  status: SessionStatus
  session: PersistedSession | null
  serverAwake: boolean
  errorMessage: string | null

  startSession: (nickname: string | null) => Promise<boolean>
  restore: () => void
  clear: () => void
  markExpired: () => void
  /** API 오류가 세션 만료면 상태를 expired 로 바꾼다. 처리했으면 true */
  handleApiError: (error: unknown) => boolean
  /** Render 무료 인스턴스가 잠들어 있을 수 있어 /healthz 를 폴링한다 (docs/01 §5) */
  wakeServer: (options?: WakeOptions) => Promise<boolean>
  auth: () => SessionAuth | null
}

export interface SessionStoreDeps {
  api: Pick<Api, 'createSession' | 'healthz'>
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_WAKE: Required<WakeOptions> = { attempts: 10, delayMs: 3_000 }
const START_FAILED_MESSAGE = '게임을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function isExpired(session: PersistedSession, nowMs: number): boolean {
  const expires = Date.parse(session.expiresAt)
  return Number.isNaN(expires) || expires <= nowMs
}

function parsePersisted(raw: string | null): PersistedSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PersistedSession>
    if (
      typeof value.sessionId === 'string' &&
      typeof value.token === 'string' &&
      typeof value.expiresAt === 'string' &&
      typeof value.boothMode === 'boolean'
    ) {
      return {
        sessionId: value.sessionId,
        token: value.token,
        expiresAt: value.expiresAt,
        boothMode: value.boothMode,
        nickname: typeof value.nickname === 'string' ? value.nickname : null,
      }
    }
  } catch {
    // 깨진 값은 없는 것으로 본다
  }
  return null
}

export function createSessionStore(deps: SessionStoreDeps) {
  const storage = deps.storage === undefined ? safeStorage() : deps.storage
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const persist = (session: PersistedSession | null) => {
    try {
      if (session) storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
      else storage?.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // 저장 실패(사생활 모드 등)는 치명적이지 않다 — 메모리 상태로 계속 진행
    }
  }

  return create<SessionState>()((set, get) => ({
    status: 'idle',
    session: null,
    serverAwake: false,
    errorMessage: null,

    async startSession(nickname) {
      set({ status: 'starting', errorMessage: null })
      try {
        const created = await deps.api.createSession(nickname)
        const session: PersistedSession = {
          sessionId: created.sessionId,
          token: created.token,
          expiresAt: created.expiresAt,
          boothMode: created.boothMode,
          nickname: nickname?.trim() || null,
        }
        persist(session)
        set({ status: 'ready', session, serverAwake: true })
        return true
      } catch (error) {
        const message = error instanceof ApiError ? error.message : START_FAILED_MESSAGE
        set({ status: 'error', session: null, errorMessage: message })
        persist(null)
        return false
      }
    },

    restore() {
      let raw: string | null = null
      try {
        raw = storage?.getItem(SESSION_STORAGE_KEY) ?? null
      } catch {
        // 저장소 접근이 막힌 환경(사생활 모드 등)에서는 세션이 없는 것으로 본다
      }
      const session = parsePersisted(raw)
      if (!session) {
        set({ status: 'idle', session: null })
        return
      }
      if (isExpired(session, now())) {
        persist(null)
        set({ status: 'idle', session: null })
        return
      }
      set({ status: 'ready', session, errorMessage: null })
    },

    clear() {
      persist(null)
      set({ status: 'idle', session: null, errorMessage: null })
    },

    markExpired() {
      persist(null)
      set({ status: 'expired', session: null })
    },

    handleApiError(error) {
      if (error instanceof ApiError && error.isSessionExpired) {
        get().markExpired()
        return true
      }
      return false
    },

    async wakeServer(options) {
      const attempts = options?.attempts ?? DEFAULT_WAKE.attempts
      const delayMs = options?.delayMs ?? DEFAULT_WAKE.delayMs
      for (let i = 0; i < attempts; i += 1) {
        try {
          await deps.api.healthz()
          set({ serverAwake: true })
          return true
        } catch {
          if (i < attempts - 1) await sleep(delayMs)
        }
      }
      set({ serverAwake: false })
      return false
    },

    auth() {
      const { session, status } = get()
      if (!session || status !== 'ready') return null
      return { sessionId: session.sessionId, token: session.token }
    },
  }))
}

/** 앱 전역 세션 스토어 */
export const useSessionStore = createSessionStore({ api: defaultApi })
