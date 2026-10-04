/**
 * 게임 루프 — 고정 타임스텝(1/60) 순수 업데이트. 렌더(rAF)는 이 step 을 누적 시간만큼 반복 호출한다.
 * 일시정지(퀴즈 중)에는 시뮬레이션 시각이 흐르지 않는다. 사건은 state.outbox 로 내보낸다.
 */
import {
  LEARN_BONUS,
  MAX_LIVES,
  QUIZ_INTERVAL_SEC,
  START_COINS,
  TOWERS,
  type TowerId,
} from '../config/balance'
import { EVENT_PARAMS } from '../config/events'
import { type MapDef, mapForTopic } from '../config/maps'
import { WAVE_PREP_SEC, type WaveDef, wavesFor } from '../config/waves'
import { baseDamageOf, createEnemy, killCoins, speedOf, vanishesAtBase } from './enemy'
import { grantCoins, grantFullHealthBonus, grantWaveClearBonus, startDoubleCoin } from './events'
import { type PathData, buildPath, positionAt, reachedBase } from './path'
import { createProjectile, stepProjectile } from './projectile'
import { type Rng, mathRng } from './rng'
import { buildSpawnQueue, peekBoss, takeDue } from './spawner'
import type { EnemyState, GameState } from './state'
import { selectTarget } from './tower'

export interface GameOptions {
  stage: number
  topicId: string
  wavesPerStage: number
  /** 학습 카드를 끝까지 읽어 +50 을 받았는지 */
  learnBonus?: boolean
  map?: MapDef
  rng?: Rng
}

export interface GameContext {
  map: MapDef
  path: PathData
  waves: readonly WaveDef[]
  rng: Rng
}

export interface Game {
  state: GameState
  ctx: GameContext
}

export function createGame(options: GameOptions): Game {
  const map = options.map ?? mapForTopic(options.topicId)
  const booth = options.wavesPerStage === 3
  const state: GameState = {
    stage: options.stage,
    wavesPerStage: options.wavesPerStage,
    topicId: options.topicId,
    time: 0,
    wave: 0,
    wavePhase: 'prep',
    phaseTimer: 0,
    coins: START_COINS + (options.learnBonus ? LEARN_BONUS : 0),
    lives: MAX_LIVES,
    kills: 0,
    wavesCleared: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    spawnQueue: [],
    nextId: 1,
    paused: false,
    quizTimer: booth ? QUIZ_INTERVAL_SEC.booth : QUIZ_INTERVAL_SEC.full,
    quizIntervalSec: booth ? QUIZ_INTERVAL_SEC.booth : QUIZ_INTERVAL_SEC.full,
    pendingQuiz: null,
    doubleCoinUntil: 0,
    bossBonusDamage: 0,
    comboMilestoneGiven: false,
    rushFiredWave: 0,
    emergencyFiredWave: 0,
    status: 'playing',
    outbox: [],
  }
  const ctx: GameContext = {
    map,
    path: buildPath(map.waypoints),
    waves: wavesFor(options.wavesPerStage),
    rng: options.rng ?? mathRng,
  }
  return { state, ctx }
}

export const nextId = (state: GameState): number => state.nextId++

/** 다음 웨이브 시작(준비 시간 건너뛰기에도 사용) */
export function startNextWave(state: GameState, ctx: GameContext): void {
  if (state.status !== 'playing' || state.wave >= state.wavesPerStage) return
  state.wave += 1
  const def = ctx.waves[state.wave - 1]!
  state.spawnQueue = buildSpawnQueue(def, ctx.rng)
  state.wavePhase = 'spawning'
  state.phaseTimer = 0
  state.outbox.push({ type: 'wave_started', wave: state.wave })
  if (def.rush && state.rushFiredWave !== state.wave) {
    state.rushFiredWave = state.wave
    requestQuiz(state, 'rush', EVENT_PARAMS.HISTORY_RUSH.count)
  }
}

export function requestQuiz(
  state: GameState,
  kind: 'normal' | 'emergency' | 'rush',
  count = 1,
): void {
  state.pendingQuiz = kind
  state.paused = true
  state.outbox.push({ type: 'quiz_requested', kind, count })
}

/** 처치 처리(투사체 명중·디버그 공용): 코인·카운트·보스 이벤트 */
export function handleKill(state: GameState, ctx: GameContext, enemy: EnemyState): void {
  enemy.alive = false
  state.kills += 1
  const coins = grantCoins(state, killCoins(enemy.type))
  state.outbox.push({
    type: 'enemy_killed',
    enemy: enemy.type,
    coins,
    pos: positionAt(ctx.path, enemy.dist),
  })
  if (enemy.type === 'golden_slime')
    state.outbox.push({ type: 'game_event', id: 'GOLDEN_SLIME', coins })
  if (enemy.type === 'boss_mid') {
    state.outbox.push({ type: 'boss_defeated', boss: 'mid' })
    startDoubleCoin(state)
  }
  if (enemy.type === 'boss_final') state.outbox.push({ type: 'boss_defeated', boss: 'final' })
}

function spawn(state: GameState, enemyType: EnemyState['type']): EnemyState {
  const enemy = createEnemy(nextId(state), enemyType, state.stage, state.time)
  state.enemies.push(enemy)
  return enemy
}

function stepSpawning(state: GameState): void {
  const boss = peekBoss(state.spawnQueue, state.phaseTimer)
  if (boss) {
    if (state.emergencyFiredWave !== state.wave) {
      state.emergencyFiredWave = state.wave
      requestQuiz(state, 'emergency')
      return
    }
    state.spawnQueue = state.spawnQueue.slice(1)
    spawn(state, boss.enemy)
    state.outbox.push({ type: 'boss_spawned', boss: boss.enemy === 'boss_mid' ? 'mid' : 'final' })
    state.wavePhase = 'fighting'
    return
  }
  const { due, rest } = takeDue(
    state.spawnQueue.filter((e) => !e.isBoss),
    state.phaseTimer,
  )
  due.forEach((entry) => spawn(state, entry.enemy))
  state.spawnQueue = [...rest, ...state.spawnQueue.filter((e) => e.isBoss)]
  if (state.spawnQueue.length === 0) state.wavePhase = 'fighting'
}

function stepEnemies(state: GameState, ctx: GameContext, dt: number): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    enemy.dist += speedOf(enemy, state.time) * dt
    if (reachedBase(ctx.path, enemy.dist)) {
      enemy.reached = true
      enemy.alive = false
      const damage = vanishesAtBase(enemy.type) ? 0 : baseDamageOf(enemy.type)
      state.lives = Math.max(0, state.lives - damage)
      state.outbox.push({ type: 'enemy_reached', enemy: enemy.type, damage })
      if (state.lives === 0 && state.status === 'playing') {
        state.status = 'lost'
        state.outbox.push({ type: 'stage_failed' })
      }
    }
  }
}

function stepTowers(state: GameState, ctx: GameContext, dt: number): void {
  for (const tower of state.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt)
    if (tower.cooldown > 0) continue
    const target = selectTarget(tower, state.enemies, ctx.path, state.time)
    if (!target) continue
    state.projectiles.push(createProjectile(nextId(state), tower, target, ctx.path))
    tower.cooldown = 1 / towerFireRate(tower.type)
  }
}

/** 공격 속도는 레벨과 무관(docs/02 §4: 레벨은 피해·사거리만) */
const towerFireRate = (type: TowerId): number => TOWERS[type].fireRate

function stepProjectiles(state: GameState, ctx: GameContext, dt: number): void {
  for (const p of state.projectiles) {
    const hits = stepProjectile(p, state.enemies, ctx.path, state.time, dt, state.bossBonusDamage)
    for (const hit of hits) {
      const enemy = state.enemies.find((e) => e.id === hit.enemyId)
      if (!enemy) continue
      state.outbox.push({ type: 'hit', pos: hit.pos, tower: p.tower, damage: hit.damage })
      if (enemy.isBoss && state.bossBonusDamage > 0) state.bossBonusDamage = 0 // 보스 첫 피격에 소모
      if (hit.killed) handleKill(state, ctx, enemy)
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.alive)
}

function stepWaveProgress(state: GameState, ctx: GameContext): void {
  if (state.wavePhase !== 'fighting') return
  if (state.enemies.some((e) => e.alive) || state.spawnQueue.length > 0) return
  // 웨이브 종료
  state.wavesCleared += 1
  const bonus = grantWaveClearBonus(state, state.wave)
  state.outbox.push({ type: 'wave_cleared', wave: state.wave, bonus })
  if (state.wave >= state.wavesPerStage) {
    state.status = 'won'
    state.wavePhase = 'done'
    const full = grantFullHealthBonus(state) > 0
    state.outbox.push({ type: 'stage_won', fullHealth: full })
    return
  }
  state.wavePhase = 'prep'
  state.phaseTimer = 0
  void ctx
}

export function step(state: GameState, ctx: GameContext, dt: number): void {
  if (state.paused || state.status !== 'playing') return
  state.time += dt
  state.phaseTimer += dt

  if (state.wavePhase === 'prep') {
    if (state.phaseTimer >= WAVE_PREP_SEC) startNextWave(state, ctx)
    // 준비 시간에도 이미 나온 투사체·몬스터는 없다(웨이브 종료 조건) — 바로 반환
    return
  }

  // 퀴즈 트리거(웨이브 진행 중에만)
  state.quizTimer -= dt
  if (state.quizTimer <= 0) {
    state.quizTimer = state.quizIntervalSec
    requestQuiz(state, 'normal')
    return
  }

  if (state.wavePhase === 'spawning') {
    stepSpawning(state)
    if (state.paused) return
  }
  stepEnemies(state, ctx, dt)
  if (state.status !== 'playing') return
  stepTowers(state, ctx, dt)
  stepProjectiles(state, ctx, dt)
  state.enemies = state.enemies.filter((e) => e.alive)
  stepWaveProgress(state, ctx)
}

/** 누적 실시간을 고정 타임스텝으로 쪼개 여러 번 step 한다(렌더 루프용). 한 프레임 최대 0.25초까지만 따라잡는다 */
export function advance(state: GameState, ctx: GameContext, elapsedSec: number, dt: number): void {
  let remaining = Math.min(elapsedSec, 0.25)
  while (remaining >= dt && !state.paused && state.status === 'playing') {
    step(state, ctx, dt)
    remaining -= dt
  }
}

export function drainOutbox(state: GameState): GameState['outbox'] {
  const events = state.outbox
  state.outbox = []
  return events
}
