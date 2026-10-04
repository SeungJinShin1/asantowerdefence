/**
 * 캔버스 — 내부 해상도 1024×576 고정, CSS 로 화면 폭에 맞춰 스케일(docs/02 §1).
 * rAF 마다 컨트롤러를 tick 하고 한 프레임을 그린다. 포인터 좌표는 타일 좌표로 바꿔 컨트롤러에 넘긴다.
 */
import { type PointerEvent, useEffect, useRef } from 'react'

import { CANVAS_HEIGHT, CANVAS_WIDTH, TILE_PX } from '../config/balance'
import type { GameController } from '../controller'
import { drawFrame } from '../render/draw'

export interface GameCanvasProps {
  controller: GameController
  onTileClick?: (tile: { x: number; y: number }) => void
}

export function GameCanvas({ controller, onTileClick }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof requestAnimationFrame !== 'function') return
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      ctx = null
    }
    let last = performance.now()
    let frame = 0
    const loop = (now: number) => {
      const elapsed = Math.min((now - last) / 1000, 0.25)
      last = now
      controller.tick(elapsed)
      if (ctx) {
        drawFrame(ctx, {
          state: controller.state,
          gameCtx: controller.game.ctx,
          sprites: controller.sprites,
          background: controller.background,
          effects: controller.effects,
          hoverTile: controller.hoverTile,
          selectedTowerId: controller.selectedTowerId,
          buildType: controller.buildType,
        })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [controller])

  const tileFromEvent = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH
    const y = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT
    const tile = { x: Math.floor(x / TILE_PX), y: Math.floor(y / TILE_PX) }
    if (
      tile.x < 0 ||
      tile.y < 0 ||
      tile.x >= CANVAS_WIDTH / TILE_PX ||
      tile.y >= CANVAS_HEIGHT / TILE_PX
    )
      return null
    return tile
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      role="img"
      aria-label="타워디펜스 게임 화면"
      className="block aspect-video w-full touch-none rounded-2xl bg-emerald-50 shadow-inner"
      onPointerMove={(e) => {
        controller.setHover(tileFromEvent(e))
      }}
      onPointerLeave={() => {
        controller.setHover(null)
      }}
      onPointerDown={(e) => {
        const tile = tileFromEvent(e)
        if (tile) onTileClick?.(tile)
      }}
    />
  )
}
