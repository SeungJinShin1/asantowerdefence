import { describe, expect, it } from 'vitest'

import { fakeCanvas } from '@/test/fakeCanvas'

import { EffectLayer } from './effects'

const pos = { x: 3, y: 2 }

describe('EffectLayer — 타워마다 다른 명중 이펙트', () => {
  it('impact: 온천=물 튀김, 거북선=폭발, 종탑=충격파, 만세=섬광 (색도 모두 다르다)', () => {
    const layer = new EffectLayer()
    layer.fromEvent({ type: 'impact', pos, tower: 'onsen', radius: 0.6 })
    layer.fromEvent({ type: 'impact', pos, tower: 'geobukseon', radius: 0.5 })
    layer.fromEvent({ type: 'impact', pos, tower: 'bell', radius: 1.7 })
    layer.fromEvent({ type: 'impact', pos, tower: 'mansae', radius: 0 })
    expect(layer.list.map((e) => e.kind)).toEqual(['splash', 'explosion', 'shockwave', 'flash'])
    expect(new Set(layer.list.map((e) => e.color)).size).toBe(4)
    expect(layer.list[1]!.radius).toBe(0.7) // 폭발은 최소 반지름을 보장해 눈에 띄게
    expect(layer.list[2]!.radius).toBe(1.7) // 폭탄 업그레이드로 커진 범위는 그대로 보여 준다
  })

  it('피리는 관통하며 맞힐 때마다 음표가 튀고, 다른 타워의 hit 은 따로 그리지 않는다', () => {
    const layer = new EffectLayer()
    layer.fromEvent({ type: 'hit', pos, tower: 'piri', damage: 12 })
    layer.fromEvent({ type: 'hit', pos, tower: 'geobukseon', damage: 55 })
    layer.fromEvent({ type: 'impact', pos, tower: 'piri', radius: 0 })
    expect(layer.list.map((e) => e.kind)).toEqual(['note'])
  })

  it('처치: 코인 글자, 황금 슬라임은 반짝임, 보스는 큰 폭발', () => {
    const layer = new EffectLayer()
    layer.fromEvent({ type: 'enemy_killed', enemy: 'slime', coins: 5, pos })
    expect(layer.list.map((e) => e.kind)).toEqual(['text'])
    expect(layer.list[0]!.text).toBe('+5')
    layer.fromEvent({ type: 'enemy_killed', enemy: 'golden_slime', coins: 50, pos })
    layer.fromEvent({ type: 'enemy_killed', enemy: 'boss_final', coins: 120, pos })
    expect(layer.list.map((e) => e.kind)).toEqual(['text', 'text', 'spark', 'text', 'explosion'])
    expect(layer.list[4]!.radius).toBeGreaterThan(1)
  })

  it('update 는 수명이 끝난 이펙트를 지우고, 개수는 상한을 넘지 않는다', () => {
    const layer = new EffectLayer()
    layer.fromEvent({ type: 'impact', pos, tower: 'mansae', radius: 0 }) // 0.2초
    layer.fromEvent({ type: 'impact', pos, tower: 'bell', radius: 1.2 }) // 0.5초
    layer.update(0.25)
    expect(layer.list.map((e) => e.kind)).toEqual(['shockwave'])
    layer.update(0.4)
    expect(layer.count).toBe(0)
    for (let i = 0; i < 500; i += 1)
      layer.fromEvent({ type: 'impact', pos, tower: 'onsen', radius: 0.6 })
    expect(layer.count).toBeLessThanOrEqual(160)
  })

  it('draw 는 모든 종류를 오류 없이 그리고 save/restore 가 짝이 맞는다', () => {
    const layer = new EffectLayer()
    layer.fromEvent({ type: 'impact', pos, tower: 'onsen', radius: 0.6 })
    layer.fromEvent({ type: 'impact', pos, tower: 'geobukseon', radius: 0.5 })
    layer.fromEvent({ type: 'impact', pos, tower: 'bell', radius: 1.2 })
    layer.fromEvent({ type: 'impact', pos, tower: 'mansae', radius: 0 })
    layer.fromEvent({ type: 'hit', pos, tower: 'piri', damage: 12 })
    layer.fromEvent({ type: 'enemy_killed', enemy: 'golden_slime', coins: 50, pos })
    layer.update(0.05)
    const { ctx, calls } = fakeCanvas()
    expect(() => layer.draw(ctx)).not.toThrow()
    expect(calls.filter((c) => c === 'save')).toHaveLength(layer.count)
    expect(calls.filter((c) => c === 'restore')).toHaveLength(layer.count)
  })
})
