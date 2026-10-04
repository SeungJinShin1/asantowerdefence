import { describe, expect, it, vi } from 'vitest'

import type { ApiClient, RequestOptions } from './client'
import { createApi } from './endpoints'

function fakeClient() {
  const request = vi.fn().mockResolvedValue({})
  const client: ApiClient = {
    baseUrl: 'http://api.test/api/v1',
    request: request as unknown as ApiClient['request'],
  }
  return { client, request }
}

const auth = { sessionId: 's_1', token: 's_1.99.sig' }

function lastCall(request: ReturnType<typeof fakeClient>['request']) {
  const call = request.mock.calls.at(-1)!
  return { path: call[0] as string, options: (call[1] ?? {}) as RequestOptions }
}

describe('createApi — 경로·메서드·본문이 docs/03 과 같다', () => {
  it('healthz 는 서버 루트를 짧은 타임아웃·재시도 없이 부른다', async () => {
    const { client, request } = fakeClient()
    await createApi(client).healthz()
    const { path, options } = lastCall(request)
    expect(path).toBe('http://api.test/healthz')
    expect(options.retry).toBe(false)
    expect(options.timeoutMs).toBe(4_000)
  })

  it('getTopics / createSession', async () => {
    const { client, request } = fakeClient()
    const api = createApi(client)

    await api.getTopics()
    expect(lastCall(request).path).toBe('/topics')

    await api.createSession('역사탐험가')
    expect(lastCall(request)).toEqual({
      path: '/sessions',
      options: { method: 'POST', body: { nickname: '역사탐험가' } },
    })

    await api.createSession()
    expect(lastCall(request).options.body).toEqual({ nickname: null })
  })

  it('세션 엔드포인트는 경로에 sessionId, 헤더용 token 을 넘긴다', async () => {
    const { client, request } = fakeClient()
    const api = createApi(client)

    await api.startStage(auth, 2, true)
    expect(lastCall(request)).toEqual({
      path: '/sessions/s_1/stages/2/start',
      options: { method: 'POST', body: { retry: true }, token: auth.token },
    })

    await api.quizMore(auth, { stage: 1, count: 3, kind: 'emergency' })
    expect(lastCall(request)).toEqual({
      path: '/sessions/s_1/quiz/more',
      options: {
        token: auth.token,
        query: { stage: 1, count: 3, kind: 'emergency', wave: undefined },
      },
    })

    const answer = { quizId: 'q_1', choiceIndex: -1, answeredMs: 15_000, wave: 2 }
    await api.answerQuiz(auth, answer)
    expect(lastCall(request)).toEqual({
      path: '/sessions/s_1/quiz/answer',
      options: { method: 'POST', body: answer, token: auth.token },
    })

    const event = {
      type: 'MIDBOSS_DEFEATED' as const,
      stageOrder: 1,
      wave: 2,
      at: '2026-10-01T00:00:00Z',
    }
    await api.reportEvent(auth, event)
    expect(lastCall(request).path).toBe('/sessions/s_1/events')
    expect(lastCall(request).options.body).toEqual(event)

    const finish = {
      stagesCleared: 1,
      wavesCleared: 3,
      livesLeftAtEnd: 10,
      coinsLeftAtEnd: 100,
      clientScore: 0,
    }
    await api.finishSession(auth, finish)
    expect(lastCall(request)).toEqual({
      path: '/sessions/s_1/finish',
      options: { method: 'POST', body: finish, token: auth.token },
    })
  })
})
