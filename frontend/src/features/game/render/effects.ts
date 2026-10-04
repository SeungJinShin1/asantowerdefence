/** 가벼운 이펙트(명중 링, 코인 팝업, 반짝임). 엔진 사건(outbox)에서 만들어져 몇백 ms 뒤 사라진다. */
import { TILE_PX } from '../config/balance'
import type { EngineEvent } from '../engine/state'
import { TOWER_COLORS } from './sprites'

export interface Effect {
  kind: 'ring' | 'text' | 'spark'
  x: number
  y: number
  age: number
  ttl: number
  color: string
  text?: string
}

export class EffectLayer {
  private effects: Effect[] = []

  get count(): number {
    return this.effects.length
  }

  add(effect: Effect): void {
    if (this.effects.length > 120) this.effects.shift()
    this.effects.push(effect)
  }

  fromEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'hit':
        this.add({
          kind: 'ring',
          x: event.pos.x,
          y: event.pos.y,
          age: 0,
          ttl: 0.25,
          color: TOWER_COLORS[event.tower],
        })
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
      const t = e.age / e.ttl
      const px = e.x * TILE_PX
      const py = e.y * TILE_PX
      ctx.save()
      ctx.globalAlpha = 1 - t
      if (e.kind === 'ring') {
        ctx.strokeStyle = e.color
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(px, py, 6 + t * 22, 0, Math.PI * 2)
        ctx.stroke()
      } else if (e.kind === 'text') {
        ctx.fillStyle = e.color
        ctx.font = 'bold 20px sans-serif'
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = 3
        ctx.strokeText(e.text ?? '', px, py - 10 - t * 30)
        ctx.fillText(e.text ?? '', px, py - 10 - t * 30)
      } else {
        ctx.fillStyle = e.color
        for (let i = 0; i < 6; i += 1) {
          const ang = (i / 6) * Math.PI * 2
          const r = 8 + t * 28
          ctx.beginPath()
          ctx.arc(px + Math.cos(ang) * r, py + Math.sin(ang) * r, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    }
  }
}
