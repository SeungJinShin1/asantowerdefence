/**
 * 가벼운 이펙트 — 엔진 사건(outbox)에서 만들어져 몇백 ms 뒤 사라진다.
 * 타워마다 명중 모습이 다르다(docs/02 §4): 온천 = 물 튀김, 피리 = 음표, 거북선 = 폭발, 종탑 = 금빛 충격파, 만세 = 섬광.
 */
import { TILE_PX, type TowerId } from '../config/balance'
import type { EngineEvent } from '../engine/state'

export type EffectKind = 'text' | 'spark' | 'splash' | 'note' | 'explosion' | 'shockwave' | 'flash'

export interface Effect {
  kind: EffectKind
  /** 위치(타일 좌표) */
  x: number
  y: number
  age: number
  ttl: number
  color: string
  text?: string
  /** 범위 이펙트 반지름(타일) */
  radius?: number
}

const MAX_EFFECTS = 160

/** 유도 발사체가 터질 때의 타워별 이펙트(피리는 관통이라 명중마다 음표) */
const IMPACT: Record<
  Exclude<TowerId, 'piri'>,
  Pick<Effect, 'kind' | 'ttl' | 'color'> & {
    minRadius: number
  }
> = {
  onsen: { kind: 'splash', ttl: 0.35, color: '#4cc3e6', minRadius: 0.5 },
  geobukseon: { kind: 'explosion', ttl: 0.45, color: '#ff9f1c', minRadius: 0.7 },
  bell: { kind: 'shockwave', ttl: 0.5, color: '#ffd43b', minRadius: 0.8 },
  mansae: { kind: 'flash', ttl: 0.2, color: '#ff922b', minRadius: 0.32 },
}

export class EffectLayer {
  private effects: Effect[] = []

  get count(): number {
    return this.effects.length
  }

  /** 테스트·디버그용 읽기 전용 목록 */
  get list(): readonly Effect[] {
    return this.effects
  }

  add(effect: Effect): void {
    if (this.effects.length >= MAX_EFFECTS) this.effects.shift()
    this.effects.push(effect)
  }

  fromEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'impact': {
        if (event.tower === 'piri') break
        const def = IMPACT[event.tower]
        this.add({
          kind: def.kind,
          x: event.pos.x,
          y: event.pos.y,
          age: 0,
          ttl: def.ttl,
          color: def.color,
          radius: Math.max(event.radius, def.minRadius),
        })
        break
      }
      case 'hit':
        // 관통(피리)은 지나가며 맞힐 때마다 음표가 튄다. 나머지 타워는 impact 에서 그린다
        if (event.tower === 'piri') {
          this.add({
            kind: 'note',
            x: event.pos.x,
            y: event.pos.y,
            age: 0,
            ttl: 0.45,
            color: '#f7d154',
          })
        }
        break
      case 'enemy_killed':
        this.add({
          kind: 'text',
          x: event.pos.x,
          y: event.pos.y,
          age: 0,
          ttl: 0.9,
          color: '#f5c542',
          text: `+${event.coins}`,
        })
        if (event.enemy === 'golden_slime') {
          this.add({
            kind: 'spark',
            x: event.pos.x,
            y: event.pos.y,
            age: 0,
            ttl: 0.8,
            color: '#ffe066',
          })
        }
        if (event.enemy === 'boss_mid' || event.enemy === 'boss_final') {
          this.add({
            kind: 'explosion',
            x: event.pos.x,
            y: event.pos.y,
            age: 0,
            ttl: 0.9,
            color: '#ff6b6b',
            radius: 1.6,
          })
        }
        break
      default:
        break
    }
  }

  update(dt: number): void {
    for (const e of this.effects) e.age += dt
    this.effects = this.effects.filter((e) => e.age < e.ttl)
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const e of this.effects) {
      ctx.save()
      drawEffect(ctx, e)
      ctx.restore()
    }
  }
}

function drawEffect(ctx: CanvasRenderingContext2D, e: Effect): void {
  const t = Math.min(e.age / e.ttl, 1)
  const px = e.x * TILE_PX
  const py = e.y * TILE_PX
  const radiusPx = (e.radius ?? 0.5) * TILE_PX
  ctx.globalAlpha = 1 - t

  switch (e.kind) {
    case 'text':
      ctx.fillStyle = e.color
      ctx.font = 'bold 20px sans-serif'
      ctx.textAlign = 'center'
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 3
      ctx.strokeText(e.text ?? '', px, py - 10 - t * 30)
      ctx.fillText(e.text ?? '', px, py - 10 - t * 30)
      break

    case 'spark':
      ctx.fillStyle = e.color
      for (let i = 0; i < 6; i += 1) {
        const ang = (i / 6) * Math.PI * 2
        const r = 8 + t * 28
        ctx.beginPath()
        ctx.arc(px + Math.cos(ang) * r, py + Math.sin(ang) * r, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      break

    case 'splash': {
      // 물 튀김: 퍼지는 물 고리 + 사방으로 튀는 물방울
      ctx.strokeStyle = e.color
      ctx.lineWidth = 4 * (1 - t) + 1
      ctx.beginPath()
      ctx.arc(px, py, 6 + t * radiusPx, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#bdeaf7'
      for (let i = 0; i < 6; i += 1) {
        const ang = (i / 6) * Math.PI * 2 + 0.4
        const r = 6 + t * radiusPx * 1.1
        ctx.beginPath()
        ctx.arc(
          px + Math.cos(ang) * r,
          py + Math.sin(ang) * r - t * 6,
          3 * (1 - t) + 1,
          0,
          Math.PI * 2,
        )
        ctx.fill()
      }
      break
    }

    case 'note':
      // 음표가 통통 튀어 오른다
      ctx.fillStyle = e.color
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 3
      ctx.font = 'bold 22px sans-serif'
      ctx.textAlign = 'center'
      ctx.strokeText('♪', px + Math.sin(t * 6) * 4, py - 8 - t * 26)
      ctx.fillText('♪', px + Math.sin(t * 6) * 4, py - 8 - t * 26)
      break

    case 'explosion': {
      // 폭발: 불덩이(밝은 속 + 주황 겉) + 사방으로 튀는 불꽃
      const r = radiusPx * (0.35 + 0.65 * t)
      ctx.fillStyle = e.color
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff3bf'
      ctx.beginPath()
      ctx.arc(px, py, r * 0.55 * (1 - t), 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#5c2b00'
      ctx.lineWidth = 3
      for (let i = 0; i < 8; i += 1) {
        const ang = (i / 8) * Math.PI * 2
        const from = r * 0.9
        const to = r * (1.15 + t * 0.5)
        ctx.beginPath()
        ctx.moveTo(px + Math.cos(ang) * from, py + Math.sin(ang) * from)
        ctx.lineTo(px + Math.cos(ang) * to, py + Math.sin(ang) * to)
        ctx.stroke()
      }
      break
    }

    case 'shockwave':
      // 종소리: 금빛 고리가 두 겹으로 넓게 퍼진다
      ctx.strokeStyle = e.color
      ctx.lineWidth = 6 * (1 - t) + 1
      ctx.beginPath()
      ctx.arc(px, py, 4 + t * radiusPx, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = (1 - t) * 0.6
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(px, py, 4 + t * radiusPx * 0.6, 0, Math.PI * 2)
      ctx.stroke()
      break

    case 'flash': {
      // 화살 명중: 작은 십자 섬광
      const len = radiusPx * (0.5 + t)
      ctx.strokeStyle = e.color
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px - len, py)
      ctx.lineTo(px + len, py)
      ctx.moveTo(px, py - len)
      ctx.lineTo(px, py + len)
      ctx.stroke()
      break
    }
  }
}
