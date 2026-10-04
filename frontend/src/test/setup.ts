import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest globals 를 끄면 Testing Library 의 자동 cleanup 이 동작하지 않으므로 직접 등록한다
afterEach(() => {
  cleanup()
})
