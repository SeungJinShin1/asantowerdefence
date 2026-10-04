import { describe, expect, it } from 'vitest'

import { ONYANG_MAP } from '../config/maps/onyang'
import { buildPath, headingAt, positionAt, progressOf, reachedBase, tileKey } from './path'

const square = buildPath([
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 2 },
])

describe('buildPath', () => {
  it('타일 중심 좌표·구간 길이·총 길이·지나는 타일을 만든다', () => {
    expect(square.points[0]).toEqual({ x: 0.5, y: 0.5 })
    expect(square.segmentLengths).toEqual([3, 2])
    expect(square.cumulative).toEqual([0, 3, 5])
    expect(square.totalLength).toBe(5)
    expect(square.tiles.size).toBe(6) // (0,0)(1,0)(2,0)(3,0)(3,1)(3,2)
    expect(square.tiles.has(tileKey(3, 1))).toBe(true)
    expect(square.tiles.has(tileKey(1, 1))).toBe(false)
  })

  it('웨이포인트가 1개면 오류', () => {
    expect(() => buildPath([{ x: 0, y: 0 }])).toThrow()
  })

  it('온양 맵은 왼쪽 가장자리에서 시작해 오른쪽 가장자리에서 끝난다', () => {
    const path = buildPath(ONYANG_MAP.waypoints)
    expect(ONYANG_MAP.waypoints[0]!.x).toBe(0)
    expect(ONYANG_MAP.waypoints.at(-1)!.x).toBe(ONYANG_MAP.cols - 1)
    expect(path.totalLength).toBeGreaterThan(20)
    for (const key of path.tiles) {
      const [x, y] = key.split(',').map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(ONYANG_MAP.cols)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(ONYANG_MAP.rows)
    }
  })
})

describe('positionAt / progressOf / reachedBase / headingAt', () => {
  it('거리에 따라 구간을 따라 보간한다', () => {
    expect(positionAt(square, 0)).toEqual({ x: 0.5, y: 0.5 })
    expect(positionAt(square, 1.5)).toEqual({ x: 2, y: 0.5 })
    expect(positionAt(square, 3)).toEqual({ x: 3.5, y: 0.5 })
    expect(positionAt(square, 4)).toEqual({ x: 3.5, y: 1.5 })
    expect(positionAt(square, 99)).toEqual({ x: 3.5, y: 2.5 })
    expect(positionAt(square, -1)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('진행률과 성 도달 판정', () => {
    expect(progressOf(square, 2.5)).toBeCloseTo(0.5)
    expect(progressOf(square, 10)).toBe(1)
    expect(reachedBase(square, 4.99)).toBe(false)
    expect(reachedBase(square, 5)).toBe(true)
  })

  it('이동 방향: 오른쪽 구간은 1, 수직 구간은 0', () => {
    expect(headingAt(square, 1)).toBe(1)
    expect(headingAt(square, 4)).toBe(0)
    const leftward = buildPath([
      { x: 5, y: 0 },
      { x: 0, y: 0 },
    ])
    expect(headingAt(leftward, 2)).toBe(-1)
  })
})
