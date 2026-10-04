import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/shared/api'

import { SESSION_STORAGE_KEY, createSessionStore } from './sessionStore'

const NOW = Date.parse('2026-10-04T05:00:00Z')
const FUTURE = '2026-10-04T08:00:00.000Z'
const PAST = '2026-10-04T04:00:00.000Z'

function makeStore(overrides: { createSession?: unknown; healthz?: unknown } = {}) {
  const createSession = vi.fn().mockResolvedValue({
    sessionId: 's_1',
    token: 's_1.999.sig',
    expiresAt: FUTURE,
    boothMode: true,
  })
  const healthz = vi
    .fn()
    .mockResolvedValue({ status: 'ok', version: '0.1.0', variantsReady: false })
  const sleep = vi.fn().mockResolvedValue(undefined)
  const deps = {
    api: {
      createSession: (overrides.createSession ?? createSession) as typeof createSession,
      healthz: (overrides.healthz ?? healthz) as typeof healthz,
    },
    storage: window.sessionStorage,
    now: () => NOW,
    sleep,
  }
  return { store: createSessionStore(deps), createSession, healthz, sleep }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('sessionStore.startSession', () => {
  it('세션을 만들고 sessionStorage 에 저장하며 auth() 를 제공한다', async () => {
    const { store, createSession } = makeStore()

    const ok = await store.getState().startSession('  역사탐험가 ')

    expect(ok).toBe(true)
    expect(createSession).toHaveBeenCalledWith('  역사탐험가 ')
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.serverAwake).toBe(true)
    expect(state.session).toEqual({
      sessionId: 's_1',
      token: 's_1.999.sig',
      expiresAt: FUTURE,
      boothMode: true,
      nickname: '역사탐험가',
    })
    expect(state.auth()).toEqual({ sessionId: 's_1', token: 's_1.999.sig' })
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toMatchObject({
      sessionId: 's_1',
    })
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('실패하면 error 상태와 메시지를 남기고 저장하지 않는다', async () => {
    const createSession = vi
      .fn()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', '서버에 연결할 수 없어요.', 0))
    const { store } = makeStore({ createSession })

    const ok = await store.getState().startSession(null)

    expect(ok).toBe(false)
    expect(store.getState().status).toBe('error')
    expect(store.getState().errorMessage).toBe('서버에 연결할 수 없어요.')
    expect(store.getState().auth()).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('sessionStore.restore', () => {
  it('유효한 세션은 복원한다', () => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 's_9', token: 't', expiresAt: FUTURE, boothMode: false }),
    )
    const { store } = makeStore()

    store.getState().restore()

    expect(store.getState().status).toBe('ready')
    expect(store.getState().session?.sessionId).toBe('s_9')
    expect(store.getState().session?.boothMode).toBe(false)
  })

  it('만료된 세션은 지우고 idle 로 돌아간다', () => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 's_9', token: 't', expiresAt: PAST, boothMode: true }),
    )
    const { store } = makeStore()

    store.getState().restore()

    expect(store.getState().status).toBe('idle')
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('깨진 값·빈 값은 무시한다', () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, '{not json')
    const { store } = makeStore()
    store.getState().restore()
    expect(store.getState().status).toBe('idle')

    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    store.getState().restore()
    expect(store.getState().status).toBe('idle')
  })
})

describe('sessionStore 만료·정리', () => {
  it('markExpired / clear 는 저장소를 비운다', async () => {
    const { store } = makeStore()
    await store.getState().startSession('a')

    store.getState().markExpired()
    expect(store.getState().status).toBe('expired')
    expect(store.getState().auth()).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()

    await store.getState().startSession('b')
    store.getState().clear()
    expect(store.getState().status).toBe('idle')
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('handleApiError 는 SESSION_EXPIRED/UNAUTHORIZED 만 처리한다', async () => {
    const { store } = makeStore()
    await store.getState().startSession('a')

    expect(store.getState().handleApiError(new Error('boom'))).toBe(false)
    expect(store.getState().handleApiError(new ApiError('NOT_FOUND', 'x', 404))).toBe(false)
    expect(store.getState().status).toBe('ready')

    expect(store.getState().handleApiError(new ApiError('SESSION_EXPIRED', '만료', 401))).toBe(true)
    expect(store.getState().status).toBe('expired')
  })
})

describe('sessionStore.wakeServer', () => {
  it('healthz 가 될 때까지 폴링하고 성공하면 true', async () => {
    const healthz = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('TIMEOUT', 't', 0))
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'n', 0))
      .mockResolvedValueOnce({ status: 'ok' })
    const { store, sleep } = makeStore({ healthz })

    const awake = await store.getState().wakeServer({ attempts: 5, delayMs: 10 })

    expect(awake).toBe(true)
    expect(store.getState().serverAwake).toBe(true)
    expect(healthz).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('시도 횟수를 다 쓰면 false (마지막 시도 뒤에는 기다리지 않음)', async () => {
    const healthz = vi.fn().mockRejectedValue(new ApiError('TIMEOUT', 't', 0))
    const { store, sleep } = makeStore({ healthz })

    const awake = await store.getState().wakeServer({ attempts: 2, delayMs: 10 })

    expect(awake).toBe(false)
    expect(store.getState().serverAwake).toBe(false)
    expect(healthz).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
