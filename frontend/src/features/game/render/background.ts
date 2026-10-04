/**
 * 배경 — docs/02 §3: 외부 이미지 없이 주제별 팔레트·간단한 도형으로 그린다.
 * 매 프레임 다시 그리지 않도록 오프스크린 캔버스에 한 번만 그려 둔다.
 */
import { TILE_PX } from '../config/balance'
import type { MapDef } from '../config/maps'
import type { PathData } from '../engine/path'
import { tileKey } from '../engine/path'

export interface BackgroundLayer {
  canvas: HTMLCanvasElement
}

export function createBackgroundLayer(map: MapDef, path: PathData): BackgroundLayer | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = map.cols * TILE_PX
  canvas.height = map.rows * TILE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintGround(ctx, map)
  paintPath(ctx, map, path)
  paintDecor(ctx, map, path)
  paintBase(ctx, path)
  return { canvas }
}

function paintGround(ctx: CanvasRenderingContext2D, map: MapDef): void {
  for (let y = 0; y < map.rows; y += 1) {
    for (let x = 0; x < map.cols; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? map.palette.ground : map.palette.groundAlt
      ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX)
    }
  }
}

function paintPath(ctx: CanvasRenderingContext2D, map: MapDef, path: PathData): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pts = path.points.map((p) => ({ x: p.x * TILE_PX, y: p.y * TILE_PX }))
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }
  stroke(map.palette.pathEdge, TILE_PX * 0.9)
  stroke(map.palette.path, TILE_PX * 0.74)
  // 발자국 점선
  ctx.setLineDash([6, 18])
  stroke('rgba(255,255,255,0.35)', 3)
  ctx.setLineDash([])
}

function paintBase(ctx: CanvasRenderingContext2D, path: PathData): void {
  const end = path.points[path.points.length - 1]!
  const cx = end.x * TILE_PX
  const cy = end.y * TILE_PX
  // 돌담 + 기와지붕 + 금빛 책(아산 역사 기록의 성)
  ctx.fillStyle = '#9a9a9a'
  ctx.fillRect(cx - 26, cy - 10, 52, 34)
  ctx.fillStyle = '#6b4a2b'
  ctx.fillRect(cx - 9, cy + 2, 18, 22)
  ctx.fillStyle = '#3b3b4f'
  ctx.beginPath()
  ctx.moveTo(cx - 34, cy - 8)
  ctx.lineTo(cx, cy - 30)
  ctx.lineTo(cx + 34, cy - 8)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#f5c542'
  ctx.beginPath()
  ctx.ellipse(cx, cy - 36, 14, 8, 0, 0, Math.PI * 2)
  ctx.fill()
}

function paintDecor(ctx: CanvasRenderingContext2D, map: MapDef, path: PathData): void {
  // 경로가 아닌 곳 중 일부에 주제별 장식(막힌 타일은 크게)
  const blocked = map.blocked ?? []
  const spots: { x: number; y: number; big: boolean }[] = blocked.map((b) => ({ ...b, big: true }))
  for (let y = 0; y < map.rows; y += 1) {
    for (let x = 0; x < map.cols; x += 1) {
      if (path.tiles.has(tileKey(x, y))) continue
      if (blocked.some((b) => b.x === x && b.y === y)) continue
      if ((x * 7 + y * 13) % 9 === 0) spots.push({ x, y, big: false })
    }
  }
  for (const s of spots) {
    const cx = s.x * TILE_PX + TILE_PX / 2
    const cy = s.y * TILE_PX + TILE_PX / 2
    drawDecor(ctx, map, cx, cy, s.big ? 1.0 : 0.55)
  }
}

function drawDecor(
  ctx: CanvasRenderingContext2D,
  map: MapDef,
  cx: number,
  cy: number,
  scale: number,
): void {
  const a = map.palette.accent
  const b = map.palette.accentAlt
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  switch (map.decor) {
    case 'onsen': // 온천 웅덩이 + 김
      ctx.fillStyle = a
      ctx.beginPath()
      ctx.ellipse(0, 6, 22, 12, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = b
      ctx.lineWidth = 3
      for (const dx of [-8, 0, 8]) {
        ctx.beginPath()
        ctx.moveTo(dx, 0)
        ctx.quadraticCurveTo(dx + 5, -10, dx, -20)
        ctx.stroke()
      }
      break
    case 'ginkgo': // 은행나무
      ctx.fillStyle = '#8a5a2b'
      ctx.fillRect(-3, 0, 6, 22)
      ctx.fillStyle = a
      ctx.beginPath()
      ctx.arc(0, -6, 18, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'sea': // 파도
      ctx.strokeStyle = a
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(-22, 0)
      ctx.quadraticCurveTo(-11, -12, 0, 0)
      ctx.quadraticCurveTo(11, 12, 22, 0)
      ctx.stroke()
      break
    case 'church': // 보호수(둥근 나무)
      ctx.fillStyle = '#6b4a2b'
      ctx.fillRect(-3, 4, 6, 18)
      ctx.fillStyle = a
      ctx.beginPath()
      ctx.arc(0, -4, 16, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'market': // 장독
      ctx.fillStyle = a
      ctx.beginPath()
      ctx.ellipse(0, 4, 14, 18, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = b
      ctx.fillRect(-10, -16, 20, 5)
      break
  }
  ctx.restore()
}
