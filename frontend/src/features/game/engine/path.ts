/**
 * 경로 — 웨이포인트(타일 좌표)를 따라 거리 기반으로 이동한다. 순수 함수.
 * 몬스터 위치는 "경로 시작점에서 진행한 거리(타일)" 하나로 표현하므로 결정적이고 테스트하기 쉽다.
 */
import type { TilePoint } from '../config/maps'

export interface Vec {
  x: number
  y: number
}

export interface PathData {
  /** 타일 중심 좌표(타일 단위) */
  points: Vec[]
  /** 각 구간 길이(타일) */
  segmentLengths: number[]
  /** 누적 길이 — cumulative[i] = points[0..i] 까지의 거리 */
  cumulative: number[]
  totalLength: number
  /** 경로가 지나는 타일 집합("x,y") */
  tiles: Set<string>
}

export const tileKey = (x: number, y: number): string => `${x},${y}`

export function buildPath(waypoints: TilePoint[]): PathData {
  if (waypoints.length < 2) throw new Error('경로에는 웨이포인트가 2개 이상 필요해요.')
  const points: Vec[] = waypoints.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }))
  const segmentLengths: number[] = []
  const cumulative: number[] = [0]
  const tiles = new Set<string>()

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    segmentLengths.push(length)
    cumulative.push(cumulative[i]! + length)
    // 축 정렬 구간이라고 가정하고 지나는 타일을 모두 기록
    const wa = waypoints[i]!
    const wb = waypoints[i + 1]!
    const dx = Math.sign(wb.x - wa.x)
    const dy = Math.sign(wb.y - wa.y)
    let x = wa.x
    let y = wa.y
    tiles.add(tileKey(x, y))
    while (x !== wb.x || y !== wb.y) {
      x += dx
      y += dy
      tiles.add(tileKey(x, y))
    }
  }

  return {
    points,
    segmentLengths,
    cumulative,
    totalLength: cumulative[cumulative.length - 1]!,
    tiles,
  }
}

/** 시작점에서 dist 만큼 진행한 지점의 좌표(타일 단위). 범위를 벗어나면 양 끝으로 고정 */
export function positionAt(path: PathData, dist: number): Vec {
  if (dist <= 0) return { ...path.points[0]! }
  if (dist >= path.totalLength) return { ...path.points[path.points.length - 1]! }
  let i = 0
  while (i < path.segmentLengths.length - 1 && dist > path.cumulative[i + 1]!) i += 1
  const a = path.points[i]!
  const b = path.points[i + 1]!
  const seg = path.segmentLengths[i]!
  const t = seg === 0 ? 0 : (dist - path.cumulative[i]!) / seg
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** 진행률 0..1 */
export function progressOf(path: PathData, dist: number): number {
  if (path.totalLength === 0) return 1
  return Math.min(Math.max(dist / path.totalLength, 0), 1)
}

/** dist 만큼 진행한 뒤 성에 닿았는지 */
export function reachedBase(path: PathData, dist: number): boolean {
  return dist >= path.totalLength
}

/** 이동 방향(렌더가 좌우 반전에 쓴다): -1 왼쪽, 1 오른쪽, 0 수직 */
export function headingAt(path: PathData, dist: number): -1 | 0 | 1 {
  let i = 0
  while (i < path.segmentLengths.length - 1 && dist > path.cumulative[i + 1]!) i += 1
  const dx = path.points[i + 1]!.x - path.points[i]!.x
  return dx > 0 ? 1 : dx < 0 ? -1 : 0
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
