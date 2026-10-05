import { describe, expect, it } from 'vitest'

import { BOSS_DELAY_SEC, FULL_WAVES, GROUP_GAP_SEC, totalEnemies } from '../config/waves'
import { createRng, type Rng } from './rng'
import { buildSpawnQueue, peekBoss, takeDue } from './spawner'

const noGolden: Rng = { next: () => 0.99 }
const golden = (where: number): Rng => {
  const values = [0.1, where]
  return { next: () => values.shift() ?? 0.5 }
}

describe('buildSpawnQueue', () => {
  it('웨이브 1: 슬라임 8마리가 1.0초 간격', () => {
    const q = buildSpawnQueue(FULL_WAVES[0]!, noGolden)
    expect(q.map((e) => e.enemy)).toEqual(Array(8).fill('slime'))
    expect(q.map((e) => e.at)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('그룹 사이에는 GROUP_GAP_SEC, 보스는 마지막 스폰 + BOSS_DELAY_SEC', () => {
    const wave3 = FULL_WAVES[2]! // 골렘3(1.6) → 슬라임6(1.0) → 유령4(1.0) → 중간보스
    const q = buildSpawnQueue(wave3, noGolden)
    expect(q).toHaveLength(totalEnemies(wave3) + 1)
    const golemLast = 3.2 // 골렘 3마리: 0, 1.6, 3.2
    const slimeFirst = golemLast + GROUP_GAP_SEC
    expect(q[3]!.at).toBeCloseTo(slimeFirst)
    const last = q[q.length - 2]!
    const boss = q[q.length - 1]!
    expect(boss).toMatchObject({ enemy: 'boss_mid', isBoss: true })
    expect(boss.at).toBeCloseTo(last.at + BOSS_DELAY_SEC)
    expect(q.map((e) => e.at)).toEqual([...q.map((e) => e.at)].sort((a, b) => a - b))
  })

  it('황금 슬라임은 확률에 걸리면 마지막 스폰 전 임의 시점에 1마리 섞인다', () => {
    const q = buildSpawnQueue(FULL_WAVES[0]!, golden(0.5))
    const goldenEntries = q.filter((e) => e.enemy === 'golden_slime')
    expect(goldenEntries).toHaveLength(1)
    expect(goldenEntries[0]!.at).toBeCloseTo(3.5) // 0.5 × 7
    expect(q.map((e) => e.at)).toEqual([...q.map((e) => e.at)].sort((a, b) => a - b))
    expect(buildSpawnQueue(FULL_WAVES[0]!, noGolden).some((e) => e.enemy === 'golden_slime')).toBe(
      false,
    )
  })

  it('시드가 같으면 결과가 같다', () => {
    const a = buildSpawnQueue(FULL_WAVES[4]!, createRng(42))
    const b = buildSpawnQueue(FULL_WAVES[4]!, createRng(42))
    expect(a).toEqual(b)
  })
})

describe('takeDue / peekBoss', () => {
  it('타이머 이하 항목만 꺼내고 나머지를 남긴다', () => {
    const q = buildSpawnQueue(FULL_WAVES[0]!, noGolden)
    const { due, rest } = takeDue(q, 2.5)
    expect(due.map((e) => e.at)).toEqual([0, 1, 2])
    expect(rest).toHaveLength(5)
  })

  it('보스가 맨 앞에 와서 시간이 되면 peekBoss 가 돌려준다', () => {
    const q = buildSpawnQueue(FULL_WAVES[2]!, noGolden)
    const bossAt = q[q.length - 1]!.at
    const { rest } = takeDue(q, bossAt - 0.1)
    expect(rest).toHaveLength(1)
    expect(peekBoss(rest, bossAt - 0.1)).toBeNull()
    expect(peekBoss(rest, bossAt)).toMatchObject({ enemy: 'boss_mid' })
  })
})
