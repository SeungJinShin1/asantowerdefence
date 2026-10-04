/**
 * fetch 래퍼 (docs/03 '프론트 API 클라이언트 규칙').
 * - 타임아웃 10초(AbortController)
 * - 5xx·네트워크 오류·타임아웃은 같은 본문으로 1회 재시도(4xx 는 재시도하지 않음)
 * - 오류는 항상 ApiError(code, message, status) 로 변환해 화면이 코드로 분기할 수 있게 한다
 *
 * 보안(ENV 노출 방지): 이 모듈이 읽는 환경변수는 VITE_API_BASE_URL 하나뿐이다.
 * 세션 토큰은 호출자가 넘기며(sessionStorage), 어디에도 로그로 남기지 않는다.
 */
import type { ApiErrorBody, ApiErrorCode } from './types'

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_RETRY_DELAY_MS = 300
export const DEFAULT_BASE_URL = 'http://localhost:8000/api/v1'

const NETWORK_MESSAGE = '서버에 연결할 수 없어요. 인터넷을 확인하고 다시 시도해 주세요.'
const TIMEOUT_MESSAGE = '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'
const GENERIC_MESSAGE = '잠시 문제가 생겼어요. 다시 시도해 주세요.'

export class ApiError extends Error {
  readonly code: ApiErrorCode | string
  readonly status: number
  readonly requestId: string | null

  constructor(
    code: ApiErrorCode | string,
    message: string,
    status: number,
    requestId?: string | null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId ?? null
  }

  get isSessionExpired(): boolean {
    return this.code === 'SESSION_EXPIRED' || this.code === 'UNAUTHORIZED'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** X-Session-Token */
  token?: string | null
  /** X-Admin-Token (관리자 화면 전용) */
  adminToken?: string | null
  query?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number
  /** 기본 true. false 면 5xx·네트워크 오류에도 재시도하지 않는다 */
  retry?: boolean
}

export interface ApiClientConfig {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  retryDelayMs?: number
}

export interface ApiClient {
  readonly baseUrl: string
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

/** `.../api/v1` 베이스에서 `/healthz` 가 있는 서버 루트를 구한다 */
export function healthUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/api\/v1\/?$/, '')}/healthz`
}

export function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim()
  const url = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL
  return url.replace(/\/+$/, '')
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('http')
    ? path
    : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function parseError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('x-request-id')
  let body: Partial<ApiErrorBody> | null = null
  try {
    body = (await response.json()) as Partial<ApiErrorBody>
  } catch {
    // JSON 이 아닌 오류 본문(프록시 HTML 등) — 상태 코드로 분류한다
  }
  const code = body?.error?.code ?? (response.status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR')
  const message = body?.error?.message ?? GENERIC_MESSAGE
  return new ApiError(code, message, response.status, requestId)
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args))
  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelay = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  async function attempt<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch {
      // 우리가 중단시킨 것이면 타임아웃, 아니면 네트워크 오류 (DOMException 은 환경마다 Error 상속이 달라 signal 로 판별)
      if (controller.signal.aborted) throw new ApiError('TIMEOUT', TIMEOUT_MESSAGE, 0)
      throw new ApiError('NETWORK_ERROR', NETWORK_MESSAGE, 0)
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw await parseError(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return {
    baseUrl,
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'
      if (options.token) headers['X-Session-Token'] = options.token
      if (options.adminToken) headers['X-Admin-Token'] = options.adminToken

      const init: RequestInit = {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }
      const url = buildUrl(baseUrl, path, options.query)
      const timeoutMs = options.timeoutMs ?? defaultTimeout
      const canRetry = options.retry ?? true

      try {
        return await attempt<T>(url, init, timeoutMs)
      } catch (error) {
        const retriable = error instanceof ApiError && (error.status === 0 || error.status >= 500)
        if (!canRetry || !retriable) throw error
        await sleep(retryDelay)
        return attempt<T>(url, init, timeoutMs) // 같은 본문으로 정확히 1회 재시도
      }
    },
  }
}
