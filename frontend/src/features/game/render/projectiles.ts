/**
 * 타워별 발사체 그리기 (docs/02 §4) — 무엇을 쏘는지 한눈에 다르게 보이도록 한다.
 *  온천 = 물방울 줄기 / 피리 = 소리 파동(호 3겹) / 거북선 = 대포알 + 연기 / 종탑 = 종소리 파동 / 만세 = 화살
 * 엔진 상태(ProjectileState)를 읽기만 하는 순수 렌더 코드.
 */
import { TILE_PX } from '../config/balance'
import type { ProjectileState } from '../engine/state'

/** 아이들 눈에 잘 띄도록 발사체를 기본보다 크게 그린다 */
const BASE_SCALE = 1.35

/** 진행 방향(라디안). 관통은 고정 방향, 유도는 마지막으로 아는 대상 위치를 향한다 */
export function projectileAngle(p: ProjectileState): number {
  if (p.targetId === null) return Math.atan2(p.dir.y, p.dir.x)
  const dx = p.lastTargetPos.x - p.pos.x
  const dy = p.lastTargetPos.y - p.pos.y
  if (dx === 0 && dy === 0) return Math.atan2(p.dir.y, p.dir.x)
  return Math.atan2(dy, dx)
}

function drawWater(ctx: CanvasRenderingContext2D): void {
  // 뒤따르는 물방울 3개 → 물줄기처럼 보인다
  const trail: readonly (readonly [number, number, number])[] = [
    [-9, 4.5, 0.55],
    [-17, 3.5, 0.4],
    [-24, 2.5, 0.25],
  ]
  for (const [x, r, alpha] of trail) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#8fdcf0'
    ctx.beginPath()
    ctx.arc(x, 0, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = '#4cc3e6'
  ctx.beginPath()
  ctx.arc(0, 0, 6.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(2, -2, 2, 0, Math.PI * 2)
  ctx.fill()
}

function drawSoundWave(ctx: CanvasRenderingContext2D): void {
  // 앞으로 퍼지는 호 3겹
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = 1 - i * 0.28
    ctx.strokeStyle = i === 0 ? '#f7d154' : '#c9a227'
    ctx.lineWidth = 5 - i
    ctx.beginPath()
    ctx.arc(-i * 10, 0, 12 + i * 4, -0.8, 0.8)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawCannonball(ctx: CanvasRenderingContext2D): void {
  // 연기 꼬리
  const smoke: readonly (readonly [number, number, number])[] = [
    [-12, 6, 0.35],
    [-22, 7.5, 0.22],
    [-33, 9, 0.12],
  ]
  for (const [x, r, alpha] of smoke) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#6b6b6b'
    ctx.beginPath()
    ctx.arc(x, 0, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // 불꽃
  ctx.fillStyle = '#ff9f1c'
  ctx.beginPath()
  ctx.arc(-8, 0, 5, 0, Math.PI * 2)
  ctx.fill()
  // 포탄
  ctx.fillStyle = '#1d2433'
  ctx.beginPath()
  ctx.arc(0, 0, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#0b0f18'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.arc(3, -3, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

function drawBellWave(ctx: CanvasRenderingContext2D, time: number): void {
  // 금빛 구슬 + 울리는 고리 2개(시간에 따라 커졌다 작아진다)
  const pulse = (Math.sin(time * 18) + 1) / 2
  ctx.strokeStyle = '#ffd43b'
  ctx.lineWidth = 3
  ctx.globalAlpha = 0.75
  ctx.beginPath()
  ctx.arc(0, 0, 10 + pulse * 3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.4
  ctx.beginPath()
  ctx.arc(0, 0, 15 + pulse * 4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#f59f00'
  ctx.beginPath()
  ctx.arc(0, 0, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff3bf'
  ctx.beginPath()
  ctx.arc(-1.5, -1.5, 2, 0, Math.PI * 2)
  ctx.fill()
}

function drawArrow(ctx: CanvasRenderingContext2D): void {
  // 화살대
  ctx.strokeStyle = '#7a4a1e'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-14, 0)
  ctx.lineTo(8, 0)
  ctx.stroke()
  // 화살촉
  ctx.fillStyle = '#dfe6ee'
  ctx.beginPath()
  ctx.moveTo(14, 0)
  ctx.lineTo(6, -4.5)
  ctx.lineTo(6, 4.5)
  ctx.closePath()
  ctx.fill()
  // 깃
  ctx.strokeStyle = '#e03131'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-14, 0)
  ctx.lineTo(-18, -4)
  ctx.moveTo(-14, 0)
  ctx.lineTo(-18, 4)
  ctx.stroke()
}

/** 발사체 1개를 타워 종류에 맞는 모양으로 그린다(진행 방향으로 회전) */
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  p: ProjectileState,
  time: number,
): void {
  ctx.save()
  ctx.translate(p.pos.x * TILE_PX, p.pos.y * TILE_PX)
  ctx.rotate(projectileAngle(p))
  // 폭탄 업그레이드로 폭발 범위가 커지면 발사체도 조금 크게
  const scale = BASE_SCALE * (1 + Math.min(Math.max(p.splashRadius - 0.6, 0), 1.5) * 0.25)
  ctx.scale(scale, scale)
  switch (p.tower) {
    case 'onsen':
      drawWater(ctx)
      break
    case 'piri':
      drawSoundWave(ctx)
      break
    case 'geobukseon':
      drawCannonball(ctx)
      break
    case 'bell':
      drawBellWave(ctx, time)
      break
    case 'mansae':
      drawArrow(ctx)
      break
  }
  ctx.restore()
}
