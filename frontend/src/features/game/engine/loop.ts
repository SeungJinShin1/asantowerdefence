/**
 * 게임 루프 — 고정 타임스텝(1/60) 순수 업데이트. 렌더(rAF)는 이 step 을 누적 시간만큼 반복 호출한다.
 * 일시정지(퀴즈 중)에는 시뮬레이션 시각이 흐르지 않는다. 사건은 state.outbox 로 내보낸다.
 *
 * 퀴즈 페이싱(docs/02 §6): 웨이브 시작 1문제 + 몬스터 12마리마다 1문제(config/waves.quizMarksFor),
 * 보스 직전 긴급 퀴즈, 러시 웨이브는 시작 퀴즈 대신 연속 2문제. 스폰이 끝난 뒤 오래 조용하면 보조 출제.
 */
import { LEARN_BONUS, MAX_LIVES, START_COINS } from '../config/balance'
import { type MapDef, mapForTopic } from '../config/maps'
import {
  QUIZ_PACING,
  WAVE_PREP_SEC,
  type WaveDef,
  quizMarksFor,
  waveForStage,
  wavesFor,
} from '../config/waves'
import { baseDamageOf, createEnemy, killCoins, speedOf, vanishesAtBase } from './enemy'
import { grantCoins, grantFullHealthBonus, grantWaveClearBonus, startDoubleCoin } from './events'
import { type PathData, buildPath, positionAt, reachedBase } from './path'
import { createProjectile, stepProjectile } from './projectile'
import { type Rng, mathRng } from './rng'
import { buildSpawnQueue, peekBoss, takeDue } from './spawner'
import type { EnemyState, GameState } from './state'
import { selectTargets, statsOf } from './tower'

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

/** 한 프레임에 따라잡는 최대 시뮬레이션 시간(초). ×8 배속에서도 프레임당 8스텝 정도만 돈다 */
export const MAX_CATCH_UP_SEC = 0.5

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
    spawnedThisWave: 0,
    quizMarks: [],
    sinceQuizSec: 0,
    quizFallbackSec: booth ? QUIZ_PACING.fallbackSec.booth : QUIZ_PACING.fallbackSec.full,
    quizzesAsked: 0,
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

/** 다음 웨이브 시작(준비 시간 건너뛰기에도 사용). 시작하자마자 첫 퀴즈(또는 러시)를 낸다 */
export function startNextWave(state: GameState, ctx: GameContext): void {
  if (state.status !== 'playing' || state.wave >= state.wavesPerStage) return
  state.wave += 1
  const def = waveForStage(ctx.waves[state.wave - 1]!, state.stage) // 단계별 수량 배율
  state.spawnQueue = buildSpawnQueue(def, ctx.rng)
  state.wavePhase = 'spawning'
  state.phaseTimer = 0
  state.spawnedThisWave = 0
  state.quizMarks = quizMarksFor(def)
  state.sinceQuizSec = 0
  state.outbox.push({ type: 'wave_started', wave: state.wave })
  if (def.rush && state.rushFiredWave !== state.wave) {
    state.rushFiredWave = state.wave
    requestQuiz(state, 'rush', QUIZ_PACING.rushCount) // 시작 퀴즈 자리를 러시(2문제)가 차지한다
    return
  }
  checkQuizMarks(state)
}

export function requestQuiz(
  state: GameState,
  kind: 'normal' | 'emergency' | 'rush',
  count = 1,
): void {
  state.pendingQuiz = kind
  state.paused = true
  state.sinceQuizSec = 0
  state.quizzesAsked += 1
  state.outbox.push({ type: 'quiz_requested', kind, count })
}

/** 스폰 수가 다음 퀴즈 지점에 닿았으면 일반 퀴즈 1개 요청 */
function checkQuizMarks(state: GameState): boolean {
  const mark = state.quizMarks[0]
  if (mark === undefined || state.spawnedThisWave < mark) return false
  state.quizMarks.shift()
  requestQuiz(state, 'normal')
  return true
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
  state.spawnedThisWave += due.length
  state.spawnQueue = [...rest, ...state.spawnQueue.filter((e) => e.isBoss)]
  if (state.spawnQueue.length === 0) state.wavePhase = 'fighting'
  if (due.length > 0) checkQuizMarks(state)
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

/** 타워 발사: 연사 옵션은 쿨다운, 쌍발 옵션은 발 수(대상이 모자라면 같은 대상에 한 발 더) */
function stepTowers(state: GameState, ctx: GameContext, dt: number): void {
  for (const tower of state.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt)
    if (tower.cooldown > 0) continue
    const stats = statsOf(tower)
    const targets = selectTargets(tower, state.enemies, ctx.path, state.time, stats.shots)
    if (targets.length === 0) continue
    for (let i = 0; i < stats.shots; i += 1) {
      const target = targets[i] ?? targets[0]!
      state.projectiles.push(createProjectile(nextId(state), tower, target, ctx.path))
    }
    tower.cooldown = 1 / stats.fireRate
  }
}

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
    // 유도 발사체가 도착해 터졌으면 명중 이펙트 지점을 알린다(관통은 hit 마다 그린다)
    if (!p.alive && p.targetId !== null) {
      state.outbox.push({ type: 'impact', pos: p.pos, tower: p.tower, radius: p.splashRadius })
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.alive)
}

function stepWaveProgress(state: GameState): void {
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
}

export function step(state: GameState, ctx: GameContext, dt: number): void {
  if (state.paused || state.status !== 'playing') return
  state.time += dt
  state.phaseTimer += dt

  if (state.wavePhase === 'prep') {
    if (state.phaseTimer >= WAVE_PREP_SEC) startNextWave(state, ctx)
    // 준비 시간에는 몬스터·투사체가 없다(웨이브 종료 조건) — 바로 반환
    return
  }

  // 보조 출제: 스폰이 끝난 뒤(보스전 등) 오래 문제가 없으면 1개
  state.sinceQuizSec += dt
  if (
    state.wavePhase === 'fighting' &&
    state.sinceQuizSec >= state.quizFallbackSec &&
    state.enemies.some((e) => e.alive)
  ) {
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
  stepWaveProgress(state)
}

/** 누적 시뮬레이션 시간을 고정 타임스텝으로 쪼개 여러 번 step 한다(렌더 루프용) */
export function advance(state: GameState, ctx: GameContext, elapsedSec: number, dt: number): void {
  let remaining = Math.min(elapsedSec, MAX_CATCH_UP_SEC)
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
