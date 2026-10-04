import { useCallback, useEffect, useRef, useState } from 'react'

import type { Toast } from './components/EventToast'

export const TOAST_MS = 2200

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-3), { ...toast, id }])
    const timer = setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, TOAST_MS)
    timers.current.push(timer)
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return { toasts, push }
}
