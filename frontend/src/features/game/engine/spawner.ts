/**
 * 스포너 — docs/02 §2 웨이브 구성표대로 시간 기반 스폰 목록을 만든다. 순수 함수.
 * 황금 슬라임은 웨이브당 60% 확률로 1마리를 임의 시점에 섞고, 보스는 마지막 스폰 뒤 BOSS_DELAY_SEC 에 등장한다.
 */
import { GOLDEN_SLIME_CHANCE } from '../config/balance'
import { BOSS_DELAY_SEC, GROUP_GAP_SEC, type WaveDef } from '../config/waves'
import type { Rng } from './rng'
import type { SpawnEntry } from './state'

export interface SpawnOptions {
  goldenChance?: number
}

export function buildSpawnQueue(wave: WaveDef, rng: Rng, options: SpawnOptions = {}): SpawnEntry[] {
  const goldenChance = options.goldenChance ?? GOLDEN_SLIME_CHANCE
  const entries: SpawnEntry[] = []
  let t = 0
  wave.groups.forEach((group, gi) => {
    if (gi > 0) t += GROUP_GAP_SEC
    for (let i = 0; i < group.count; i += 1) {
      entries.push({ at: round(t), enemy: group.enemy })
      if (i < group.count - 1) t += group.intervalSec
    }
  })
  const lastSpawnAt = entries.length ? entries[entries.length - 1]!.at : 0

  if (rng.next() < goldenChance) {
    entries.push({ at: round(rng.next() * lastSpawnAt), enemy: 'golden_slime' })
  }

  entries.sort((a, b) => a.at - b.at)

  if (wave.boss) {
    entries.push({
      at: round(lastSpawnAt + BOSS_DELAY_SEC),
      enemy: wave.boss === 'mid' ? 'boss_mid' : 'boss_final',
      isBoss: true,
    })
  }
  return entries
}

/** timer(웨이브 스폰 시작 뒤 흐른 시간) 이하인 항목을 꺼낸다. 보스 항목은 그 앞의 일반 항목이 모두 나간 뒤에만 */
export function takeDue(
  queue: SpawnEntry[],
  timer: number,
): { due: SpawnEntry[]; rest: SpawnEntry[] } {
  const due: SpawnEntry[] = []
  let i = 0
  while (i < queue.length && queue[i]!.at <= timer) {
    due.push(queue[i]!)
    i += 1
  }
  return { due, rest: queue.slice(i) }
}

/** 큐의 맨 앞이 보스이면 그 항목(긴급 퀴즈 트리거 지점) */
export function peekBoss(queue: SpawnEntry[], timer: number): SpawnEntry | null {
  const head = queue[0]
  return head && head.isBoss && head.at <= timer ? head : null
}

const round = (v: number) => Math.round(v * 1000) / 1000
