/** 시드 고정 난수(mulberry32). 엔진은 Math.random 을 직접 쓰지 않고 이 인터페이스를 주입받는다. */

export interface Rng {
  /** [0, 1) */
  next(): number
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export const mathRng: Rng = { next: () => Math.random() }
