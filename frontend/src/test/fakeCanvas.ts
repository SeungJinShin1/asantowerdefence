/** 테스트용 가짜 Canvas 2D 컨텍스트: 어떤 메서드든 받아서 이름만 기록한다(jsdom 은 canvas 를 그리지 못한다). */
export interface FakeCanvas {
  ctx: CanvasRenderingContext2D
  /** 호출된 메서드 이름(순서대로) */
  calls: string[]
}

export function fakeCanvas(): FakeCanvas {
  const calls: string[] = []
  const props: Record<string, unknown> = {}
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      return () => {
        calls.push(prop)
      }
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}
