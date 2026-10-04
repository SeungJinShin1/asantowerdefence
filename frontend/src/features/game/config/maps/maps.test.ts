import { describe, expect, it } from 'vitest'

import { buildPath, tileKey } from '../../engine/path'
import { canBuildAt } from '../../engine/tower'
import { MAPS, mapForTopic } from './index'

const TOPIC_IDS = ['onyang', 'maengsaseong', 'yisunsin', 'gongseri', 'seonjang']

describe('maps — docs/02 §3 규칙', () => {
  it('주제 5개 모두 맵이 있고, 모르는 주제는 온양 맵으로 대체', () => {
    expect(Object.keys(MAPS)).toEqual(TOPIC_IDS)
    expect(mapForTopic('nope')).toBe(MAPS.onyang)
  })

  it.each(TOPIC_IDS)('%s: 16×9, 축 정렬 경로, 왼쪽 입구 → 오른쪽 성, 막힌 타일은 경로 밖', (id) => {
    const map = MAPS[id]!
    expect([map.cols, map.rows]).toEqual([16, 9])
    expect(map.topicId).toBe(id)
    const w = map.waypoints
    expect(w.length).toBeGreaterThanOrEqual(2)
    expect(w[0]!.x).toBe(0)
    expect(w.at(-1)!.x).toBe(15)
    for (let i = 1; i < w.length; i += 1) {
      const a = w[i - 1]!
      const b = w[i]!
      expect(a.x === b.x || a.y === b.y).toBe(true) // 축 정렬
      expect(a.x !== b.x || a.y !== b.y).toBe(true) // 길이 0 구간 없음
    }
    for (const p of [...w, ...(map.blocked ?? [])]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(16)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(9)
    }
    const path = buildPath(w)
    for (const b of map.blocked ?? []) expect(path.tiles.has(tileKey(b.x, b.y))).toBe(false)
    // 지을 수 있는 타일이 충분히 남는다(최소 60칸)
    let buildable = 0
    for (let y = 0; y < 9; y += 1)
      for (let x = 0; x < 16; x += 1) if (canBuildAt(map, path, [], { x, y })) buildable += 1
    expect(buildable).toBeGreaterThanOrEqual(60)
    expect(path.totalLength).toBeGreaterThanOrEqual(18)
  })
})
