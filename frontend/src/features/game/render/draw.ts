/** 한 프레임 그리기: 배경(캐시) → 건설 하이라이트 → 사거리 → 타워 → 발사체(타워별 모양) → 몬스터(+체력바) → 이펙트 */
import { ENEMIES, TILE_PX, type TowerId } from '../config/balance'
import { isTargetable } from '../engine/enemy'
import type { GameContext } from '../engine/loop'
import { headingAt, positionAt } from '../engine/path'
import type { GameState } from '../engine/state'
import { canBuildAt, towerStats } from '../engine/tower'
import type { BackgroundLayer } from './background'
import type { EffectLayer } from './effects'
import { drawProjectile } from './projectiles'
import {
  BASE_SPRITE_URL,
  type SpriteCache,
  TOWER_COLORS,
  drawEnemySprite,
  drawTowerSprite,
} from './sprites'

export interface FrameParams {
  state: GameState
  gameCtx: GameContext
  sprites: SpriteCache
  background: BackgroundLayer | null
  effects: EffectLayer
  hoverTile: { x: number; y: number } | null
  selectedTowerId: number | null
  buildType: TowerId | null
}

export function drawFrame(ctx: CanvasRenderingContext2D, p: FrameParams): void {
  const { state, gameCtx } = p
  const w = gameCtx.map.cols * TILE_PX
  const h = gameCtx.map.rows * TILE_PX
  if (p.background) ctx.drawImage(p.background.canvas, 0, 0)
  else {
    ctx.fillStyle = gameCtx.map.palette.ground
    ctx.fillRect(0, 0, w, h)
  }

  // 건설 모드: 지을 수 있는 타일 표시 + 마우스 위치 미리보기
  if (p.buildType) {
    for (let y = 0; y < gameCtx.map.rows; y += 1) {
      for (let x = 0; x < gameCtx.map.cols; x += 1) {
        if (!canBuildAt(gameCtx.map, gameCtx.path, state.towers, { x, y })) continue
        ctx.fillStyle = gameCtx.map.palette.buildable
        ctx.fillRect(x * TILE_PX + 4, y * TILE_PX + 4, TILE_PX - 8, TILE_PX - 8)
      }
    }
    if (p.hoverTile) {
      const ok = canBuildAt(gameCtx.map, gameCtx.path, state.towers, p.hoverTile)
      const cx = p.hoverTile.x * TILE_PX + TILE_PX / 2
      const cy = p.hoverTile.y * TILE_PX + TILE_PX / 2
      drawRange(
        ctx,
        cx,
        cy,
        towerStats(p.buildType).range,
        ok ? TOWER_COLORS[p.buildType] : '#e03131',
      )
      ctx.globalAlpha = 0.6
      drawTowerSprite(ctx, p.sprites, p.buildType, 1, cx, cy, TILE_PX)
      ctx.globalAlpha = 1
    }
  }

  // 선택된 타워의 사거리
  const selected = state.towers.find((t) => t.id === p.selectedTowerId)
  if (selected) {
    drawRange(
      ctx,
      selected.tile.x * TILE_PX + TILE_PX / 2,
      selected.tile.y * TILE_PX + TILE_PX / 2,
      towerStats(selected.type, selected.upgrades).range,
      TOWER_COLORS[selected.type],
    )
  }

  // 성(기지) 이미지가 있으면 배경의 도형 위에 덧그린다
  const baseImg = p.sprites.get(BASE_SPRITE_URL)
  if (baseImg) {
    const end = gameCtx.path.points[gameCtx.path.points.length - 1]!
    const baseSize = TILE_PX * 1.6
    ctx.drawImage(
      baseImg,
      end.x * TILE_PX - baseSize / 2,
      end.y * TILE_PX - baseSize * 0.7,
      baseSize,
      baseSize,
    )
  }

  for (const tower of state.towers) {
    drawTowerSprite(
      ctx,
      p.sprites,
      tower.type,
      tower.level,
      tower.tile.x * TILE_PX + TILE_PX / 2,
      tower.tile.y * TILE_PX + TILE_PX / 2,
      TILE_PX,
    )
  }

  // 타워마다 다른 발사체(물줄기·소리 파동·대포알·종소리·화살)
  for (const proj of state.projectiles) drawProjectile(ctx, proj, state.time)

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    const pos = positionAt(gameCtx.path, enemy.dist)
    const size = ENEMIES[enemy.type].size * TILE_PX
    const alpha = isTargetable(enemy, state.time) ? 1 : 0.35
    const cx = pos.x * TILE_PX
    const cy = pos.y * TILE_PX
    drawEnemySprite(
      ctx,
      p.sprites,
      enemy.type,
      cx,
      cy,
      size,
      headingAt(gameCtx.path, enemy.dist),
      alpha,
      state.stage,
    )
    // 체력바
    const ratio = enemy.hp / enemy.maxHp
    const bw = size * 0.8
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(cx - bw / 2, cy - size / 2 - 8, bw, 5)
    ctx.fillStyle = ratio > 0.5 ? '#51cf66' : ratio > 0.25 ? '#fcc419' : '#ff6b6b'
    ctx.fillRect(cx - bw / 2, cy - size / 2 - 8, bw * ratio, 5)
    if (enemy.slowUntil > state.time) {
      ctx.fillStyle = 'rgba(79,179,169,0.9)'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('❄', cx + size / 2, cy - size / 2)
    }
  }

  p.effects.draw(ctx)

  // 건설 모드가 아닐 때 타워 위 호버 외곽선
  if (p.hoverTile && !p.buildType) {
    const hovered = state.towers.find(
      (t) => t.tile.x === p.hoverTile!.x && t.tile.y === p.hoverTile!.y,
    )
    if (hovered) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 2
      ctx.strokeRect(
        p.hoverTile.x * TILE_PX + 2,
        p.hoverTile.y * TILE_PX + 2,
        TILE_PX - 4,
        TILE_PX - 4,
      )
    }
  }
}

function drawRange(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rangeTiles: number,
  color: string,
): void {
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, rangeTiles * TILE_PX, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.6
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}
