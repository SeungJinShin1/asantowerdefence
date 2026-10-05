/** 게임 상태 타입 — 엔진은 이 구조만 읽고 쓴다(DOM·Canvas 없음). 렌더는 읽기만 한다. */
import type { EnemyId, TowerId } from '../config/balance'
import type { GameEventId } from '../config/events'
import type { UpgradeLevels } from '../config/upgrades'
import type { Vec } from './path'

export interface EnemyState {
  id: number
  type: EnemyId
  hp: number
  maxHp: number
  /** 경로 시작점에서 진행한 거리(타일) */
  dist: number
  spawnedAt: number
  slowUntil: number
  slowFactor: number
  alive: boolean
  reached: boolean
  isBoss: boolean
}

export interface TowerState {
  id: number
  type: TowerId
  tile: { x: number; y: number }
  /** 표시용 레벨 = 1 + 업그레이드 총 횟수 */
  level: number
  /** 옵션별 업그레이드 단계(위력·연사·폭탄·관통·쌍발·사거리) */
  upgrades: UpgradeLevels
  /** 다음 발사까지 남은 시간(초) */
  cooldown: number
  /** 지금까지 투자한 코인(판매 환급 기준) */
  invested: number
}

export interface ProjectileState {
  id: number
  tower: TowerId
  pos: Vec
  speed: number
  damage: number
  /** 유도 대상(관통 투사체는 null — 직선 비행) */
  targetId: number | null
  /** 마지막으로 알고 있던 대상 위치(대상이 사라져도 그 자리로 날아가 터진다) */
  lastTargetPos: Vec
  dir: Vec
  pierceLeft: number
  hitIds: number[]
  splashRadius: number
  slow: { factor: number; durationSec: number } | null
  bossBonus: number
  traveled: number
  maxTravel: number
  alive: boolean
}

export interface SpawnEntry {
  /** 웨이브 스폰 시작 기준 시각(초) */
  at: number
  enemy: EnemyId
  isBoss?: boolean
}

export type QuizTriggerKind = 'normal' | 'emergency' | 'rush'
export type WavePhase = 'prep' | 'spawning' | 'boss_pending' | 'fighting' | 'cleared' | 'done'
export type GameStatus = 'playing' | 'won' | 'lost'

export type EngineEvent =
  | { type: 'wave_started'; wave: number }
  | { type: 'wave_cleared'; wave: number; bonus: number }
  | { type: 'enemy_killed'; enemy: EnemyId; coins: number; pos: Vec }
  | { type: 'enemy_reached'; enemy: EnemyId; damage: number }
  | { type: 'boss_spawned'; boss: 'mid' | 'final' }
  | { type: 'boss_defeated'; boss: 'mid' | 'final' }
  | { type: 'quiz_requested'; kind: QuizTriggerKind; count: number }
  | { type: 'game_event'; id: GameEventId; coins?: number; until?: number }
  | { type: 'hit'; pos: Vec; tower: TowerId; damage: number }
  /** 유도 발사체가 도착해 터진 지점(타워별 명중 이펙트용). radius = 폭발 반지름(타일) */
  | { type: 'impact'; pos: Vec; tower: TowerId; radius: number }
  | { type: 'stage_won'; fullHealth: boolean }
  | { type: 'stage_failed' }

export interface GameState {
  stage: number
  wavesPerStage: number
  topicId: string
  /** 시뮬레이션 시각(초). 일시정지 중에는 흐르지 않는다 */
  time: number
  /** 현재 웨이브(1부터). 시작 전 0 */
  wave: number
  wavePhase: WavePhase
  /** 현재 단계에서 흐른 시간(초): prep 카운트다운, 스폰 타이머 등 */
  phaseTimer: number
  coins: number
  lives: number
  kills: number
  wavesCleared: number
  enemies: EnemyState[]
  towers: TowerState[]
  projectiles: ProjectileState[]
  spawnQueue: SpawnEntry[]
  nextId: number
  paused: boolean
  /** 이번 웨이브에서 지금까지 나온 몬스터 수(퀴즈 페이싱 기준) */
  spawnedThisWave: number
  /** 아직 남은 일반 퀴즈 지점(스폰 수, 오름차순) */
  quizMarks: number[]
  /** 마지막 퀴즈 뒤 흐른 시간(초) — 스폰이 끝난 뒤 보조 출제용 */
  sinceQuizSec: number
  quizFallbackSec: number
  /** 지금까지 요청한 퀴즈 수(러시 묶음은 1회) */
  quizzesAsked: number
  pendingQuiz: QuizTriggerKind | null
  doubleCoinUntil: number
  /** 긴급 퀴즈 정답 보상: 다음 보스 첫 피격에 더해지는 피해 */
  bossBonusDamage: number
  comboMilestoneGiven: boolean
  rushFiredWave: number
  emergencyFiredWave: number
  status: GameStatus
  /** 엔진 → 화면/서버로 전달할 사건. 화면이 매 프레임 비운다 */
  outbox: EngineEvent[]
}
