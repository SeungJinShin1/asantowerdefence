/**
 * 게임 컨트롤러 — 엔진(순수 상태)과 React 사이의 다리.
 * - rAF 루프가 tick() 을 부르면 고정 타임스텝으로 엔진을 진행하고 outbox 를 비워 훅으로 넘긴다
 * - HUD 는 getSnapshot()/subscribe() 로(useSyncExternalStore) 값이 바뀔 때만 다시 그린다
 * - 테스트는 tick(seconds) 를 직접 불러 결정적으로 진행시킬 수 있다
 */
import { useSyncExternalStore } from 'react'

import { SIM_DT, type TowerId } from './config/balance'
import { WAVE_PREP_SEC } from './config/waves'
import {
  type ActionResult,
  type QuizOutcome,
  applyQuizOutcome,
  placeTower,
  resumeAfterQuiz,
  sellTowerById,
  setPaused,
  upgradeTowerById,
} from './engine/actions'
import {
  type Game,
  type GameOptions,
  advance,
  createGame,
  drainOutbox,
  startNextWave,
} from './engine/loop'
import type { EngineEvent, GameStatus, QuizTriggerKind, WavePhase } from './engine/state'
import { type BackgroundLayer, createBackgroundLayer } from './render/background'
import { EffectLayer } from './render/effects'
import { SpriteCache, allSpriteUrls } from './render/sprites'

export interface HudSnapshot {
  coins: number
  lives: number
  wave: number
  wavesPerStage: number
  wavePhase: WavePhase
  prepLeft: number
  paused: boolean
  pendingQuiz: QuizTriggerKind | null
  status: GameStatus
  doubleCoinLeft: number
  kills: number
  wavesCleared: number
  selectedTowerId: number | null
  buildType: TowerId | null
  towerCount: number
}

export interface ControllerHooks {
  onEvent?: (event: EngineEvent) => void
}

export class GameController {
  readonly game: Game
  readonly sprites = new SpriteCache()
  readonly effects = new EffectLayer()
  readonly background: BackgroundLayer | null
  hoverTile: { x: number; y: number } | null = null
  selectedTowerId: number | null = null
  buildType: TowerId | null = null

  private readonly listeners = new Set<() => void>()
  private readonly hooks: ControllerHooks
  private snapshot: HudSnapshot

  constructor(options: GameOptions, hooks: ControllerHooks = {}) {
    this.hooks = hooks
    this.game = createGame(options)
    this.background = createBackgroundLayer(this.game.ctx.map, this.game.ctx.path)
    this.sprites.preload(allSpriteUrls(options.stage))
    this.snapshot = this.computeSnapshot()
  }

  get state() {
    return this.game.state
  }

  /** 실시간 elapsedSec 만큼 진행(고정 타임스텝 1/60 으로 쪼갬) */
  tick(elapsedSec: number): void {
    advance(this.game.state, this.game.ctx, elapsedSec, SIM_DT)
    this.effects.update(elapsedSec)
    this.flush()
  }

  /** outbox 를 비워 이펙트·훅으로 전달하고 HUD 갱신 */
  flush(): void {
    const events = drainOutbox(this.game.state)
    for (const event of events) {
      this.effects.fromEvent(event)
      this.hooks.onEvent?.(event)
    }
    this.refresh()
  }

  // ---------- React 구독 ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): HudSnapshot => this.snapshot

  private refresh(): void {
    const next = this.computeSnapshot()
    if (!shallowEqual(next, this.snapshot)) {
      this.snapshot = next
      this.listeners.forEach((fn) => fn())
    }
  }

  private computeSnapshot(): HudSnapshot {
    const s = this.game.state
    return {
      coins: s.coins,
      lives: s.lives,
      wave: s.wave,
      wavesPerStage: s.wavesPerStage,
      wavePhase: s.wavePhase,
      prepLeft: s.wavePhase === 'prep' ? Math.max(0, Math.ceil(WAVE_PREP_SEC - s.phaseTimer)) : 0,
      paused: s.paused,
      pendingQuiz: s.pendingQuiz,
      status: s.status,
      doubleCoinLeft: Math.max(0, Math.ceil(s.doubleCoinUntil - s.time)),
      kills: s.kills,
      wavesCleared: s.wavesCleared,
      selectedTowerId: this.selectedTowerId,
      buildType: this.buildType,
      towerCount: s.towers.length,
    }
  }

  // ---------- 플레이어 액션 ----------

  setHover(tile: { x: number; y: number } | null): void {
    this.hoverTile = tile
  }

  setBuildType(type: TowerId | null): void {
    this.buildType = type
    if (type) this.selectedTowerId = null
    this.refresh()
  }

  select(towerId: number | null): void {
    this.selectedTowerId = towerId
    if (towerId !== null) this.buildType = null
    this.refresh()
  }

  /** 캔버스 타일 클릭: 건설 모드면 건설, 아니면 그 자리의 타워 선택 */
  handleTileClick(tile: { x: number; y: number }): ActionResult {
    if (this.buildType) {
      const result = placeTower(this.game.state, this.game.ctx, this.buildType, tile)
      this.refresh()
      return result
    }
    const tower = this.game.state.towers.find((t) => t.tile.x === tile.x && t.tile.y === tile.y)
    this.select(tower ? tower.id : null)
    return { ok: true }
  }

  upgradeSelected(): ActionResult {
    if (this.selectedTowerId === null) return { ok: false, reason: '타워를 먼저 골라 주세요.' }
    const result = upgradeTowerById(this.game.state, this.selectedTowerId)
    this.refresh()
    return result
  }

  sellSelected(): ActionResult {
    if (this.selectedTowerId === null) return { ok: false, reason: '타워를 먼저 골라 주세요.' }
    const result = sellTowerById(this.game.state, this.selectedTowerId)
    this.selectedTowerId = null
    this.refresh()
    return result
  }

  skipPrep(): void {
    if (this.game.state.wavePhase === 'prep' && this.game.state.status === 'playing') {
      startNextWave(this.game.state, this.game.ctx)
      this.flush()
    }
  }

  togglePause(): void {
    setPaused(this.game.state, !this.game.state.paused)
    this.refresh()
  }

  applyQuiz(outcome: QuizOutcome): void {
    applyQuizOutcome(this.game.state, outcome)
    this.flush()
  }

  resumeQuiz(): void {
    resumeAfterQuiz(this.game.state)
    this.refresh()
  }
}

function shallowEqual(a: HudSnapshot, b: HudSnapshot): boolean {
  for (const key of Object.keys(a) as (keyof HudSnapshot)[]) {
    if (a[key] !== b[key]) return false
  }
  return true
}

export function useHud(controller: GameController): HudSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}
