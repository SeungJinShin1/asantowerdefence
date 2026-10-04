import { describe, expect, it, vi } from 'vitest'

import { ApiError, createApiClient, healthUrl } from './client'

type FetchImpl = typeof fetch

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function makeClient(fetchImpl: FetchImpl, timeoutMs = 10_000) {
  return createApiClient({
    baseUrl: 'http://api.test/api/v1/',
    fetchImpl,
    timeoutMs,
    retryDelayMs: 0,
  })
}

describe('createApiClient', () => {
  it('베이스 URL 뒤에 경로·쿼리를 붙이고 JSON 을 돌려준다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(jsonResponse([{ id: 'onyang' }]))
    const client = makeClient(fetchImpl)

    const result = await client.request<{ id: string }[]>('/topics', {
      query: { stage: 1, count: undefined, kind: 'rush' },
    })

    expect(result).toEqual([{ id: 'onyang' }])
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://api.test/api/v1/topics?stage=1&kind=rush')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  it('본문이 있으면 POST + JSON 헤더, 토큰은 X-Session-Token 으로 보낸다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(jsonResponse({ ok: true }))
    const client = makeClient(fetchImpl)

    await client.request('/sessions/s_1/quiz/answer', {
      body: { quizId: 'q_1', choiceIndex: 2 },
      token: 's_1.123.abc',
    })

    const [, init] = fetchImpl.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ quizId: 'q_1', choiceIndex: 2 }))
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Session-Token']).toBe('s_1.123.abc')
  })

  it('오류 응답 {error:{code,message}} 를 ApiError 로 바꾼다 (4xx 는 재시도 없음)', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(
      jsonResponse({ error: { code: 'SESSION_EXPIRED', message: '세션이 만료되었어요.' } }, 401, {
        'X-Request-ID': 'req-1',
      }),
    )
    const client = makeClient(fetchImpl)

    const error = await client
      .request<never>('/sessions/s_1/finish', { body: {} })
      .catch((e: unknown) => e as ApiError)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('SESSION_EXPIRED')
    expect(error.status).toBe(401)
    expect(error.message).toBe('세션이 만료되었어요.')
    expect(error.requestId).toBe('req-1')
    expect(error.isSessionExpired).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('JSON 이 아닌 오류 본문은 상태 코드로 코드를 정한다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    const client = makeClient(fetchImpl)

    const error = await client
      .request<never>('/topics', { retry: false })
      .catch((e: unknown) => e as ApiError)

    expect(error.code).toBe('INTERNAL')
    expect(error.status).toBe(502)
  })

  it('5xx 는 같은 본문으로 정확히 1회 재시도하고 성공하면 결과를 돌려준다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INTERNAL', message: 'x' } }, 500))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }))
    const client = makeClient(fetchImpl)

    const result = await client.request('/sessions/s_1/events', { body: { type: 'WAVE_CLEARED' } })

    expect(result).toEqual({ accepted: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const bodies = fetchImpl.mock.calls.map(([, init]) => init?.body)
    expect(bodies[0]).toBe(bodies[1])
  })

  it('네트워크 오류는 1회 재시도 후에도 실패하면 NETWORK_ERROR 로 던진다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = makeClient(fetchImpl)

    const error = await client.request<never>('/topics').catch((e: unknown) => e as ApiError)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.status).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retry:false 면 5xx 에도 한 번만 호출한다', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL', message: 'x' } }, 503))
    const client = makeClient(fetchImpl)

    const error = await client
      .request<never>('/healthz', { retry: false })
      .catch((e: unknown) => e as ApiError)

    expect(error.code).toBe('INTERNAL')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('타임아웃이면 요청을 중단하고 TIMEOUT 으로 던진다', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const client = makeClient(fetchImpl, 20)

    const error = await client
      .request<never>('/topics', { retry: false })
      .catch((e: unknown) => e as ApiError)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('TIMEOUT')
  })
})

describe('healthUrl', () => {
  it('/api/v1 베이스에서 서버 루트의 /healthz 를 만든다', () => {
    expect(healthUrl('http://localhost:8000/api/v1')).toBe('http://localhost:8000/healthz')
    expect(healthUrl('https://app.onrender.com/api/v1/')).toBe('https://app.onrender.com/healthz')
  })
})
