/**
 * 밸런스 상수 — docs/02 §2·§4·§5·§6. 게임 숫자는 이 폴더(config/)에서만 바꾼다.
 * 서버(backend/app/domain/scoring.py)와 겹치는 값(시작 코인·학습 보너스·체력·웨이브 수)은 같은 값을 유지한다.
 */

export const TILE_PX = 64
export const GRID_COLS = 16
export const GRID_ROWS = 9
export const CANVAS_WIDTH = TILE_PX * GRID_COLS // 1024
export const CANVAS_HEIGHT = TILE_PX * GRID_ROWS // 576

export const SIM_DT = 1 / 60
export const START_COINS = 100
export const LEARN_BONUS = 50
export const MAX_LIVES = 10
export const HP_MULT_PER_STAGE = 0.25 // 몬스터 체력 배율 = 1 + 0.25 × (stage − 1)
export const GOLDEN_SLIME_CHANCE = 0.6
export const WAVES_PER_STAGE = { full: 5, booth: 3 } as const

/** 게임 속도 배율(실시간 → 시뮬레이션). 부스에서는 기다림이 없도록 기본 ×2 */
export const GAME_SPEEDS = [1, 2, 4, 8] as const
export type GameSpeed = (typeof GAME_SPEEDS)[number]
export const DEFAULT_GAME_SPEED: GameSpeed = 2

// ---------- 타워 ----------

export type TowerId = 'onsen' | 'piri' | 'geobukseon' | 'bell' | 'mansae'
export type Targeting = 'nearest_base' | 'max_hp'
export type ProjectileKind = 'splash_slow' | 'pierce' | 'cannon' | 'splash' | 'rapid'

export interface TowerSpec {
  id: TowerId
  name: string
  cost: number
  /** 사거리(타일) */
  range: number
  damage: number
  /** 공격 속도(회/초) */
  fireRate: number
  targeting: Targeting
  projectile: ProjectileKind
  projectileSpeed: number
  unlockStage: number
  splashRadius?: number
  pierce?: number
  slow?: { factor: number; durationSec: number }
  bossBonus?: number
}

export const TOWERS: Record<TowerId, TowerSpec> = {
  onsen: {
    id: 'onsen',
    name: '온천 타워',
    cost: 50,
    range: 2.0,
    damage: 6,
    fireRate: 1.2,
    targeting: 'nearest_base',
    projectile: 'splash_slow',
    projectileSpeed: 7,
    unlockStage: 1,
    splashRadius: 0.6,
    slow: { factor: 0.3, durationSec: 1.5 },
  },
  piri: {
    id: 'piri',
    name: '피리 타워',
    cost: 70,
    range: 3.0,
    damage: 8,
    fireRate: 1.0,
    targeting: 'nearest_base',
    projectile: 'pierce',
    projectileSpeed: 9,
    unlockStage: 2,
    pierce: 3,
  },
  geobukseon: {
    id: 'geobukseon',
    name: '거북선 타워',
    cost: 100,
    range: 2.5,
    damage: 30,
    fireRate: 0.5,
    targeting: 'max_hp',
    projectile: 'cannon',
    projectileSpeed: 6,
    unlockStage: 3,
    bossBonus: 0.5,
  },
  bell: {
    id: 'bell',
    name: '종탑 타워',
    cost: 90,
    range: 2.2,
    damage: 12,
    fireRate: 0.8,
    targeting: 'nearest_base',
    projectile: 'splash',
    projectileSpeed: 8,
    unlockStage: 4,
    splashRadius: 1.0,
  },
  mansae: {
    id: 'mansae',
    name: '만세 망루',
    cost: 80,
    range: 3.5,
    damage: 5,
    fireRate: 3.0,
    targeting: 'nearest_base',
    projectile: 'rapid',
    projectileSpeed: 12,
    unlockStage: 5,
  },
}

export const TOWER_ORDER: readonly TowerId[] = ['onsen', 'piri', 'geobukseon', 'bell', 'mansae']

// 업그레이드 옵션은 config/upgrades.ts

export const SELL_REFUND = 0.6

// ---------- 몬스터 ----------

export type EnemyId =
  'slime' | 'bat' | 'golem' | 'ghost' | 'dokkaebi' | 'golden_slime' | 'boss_mid' | 'boss_final'

export interface EnemySpec {
  id: EnemyId
  name: string
  hp: number
  /** 속도(타일/초) */
  speed: number
  coins: number
  damageToBase: number
  boss?: 'mid' | 'final'
  slowImmune?: boolean
  /** 유령: periodSec 마다 hiddenSec 동안 피격 불가 */
  phase?: { periodSec: number; hiddenSec: number }
  /** 황금 슬라임: 성에 닿아도 피해 없이 사라짐 */
  vanishAtBase?: boolean
  /** 렌더 크기(타일 배수) */
  size: number
}

export const ENEMIES: Record<EnemyId, EnemySpec> = {
  slime: {
    id: 'slime',
    name: '먹구름 슬라임',
    hp: 40,
    speed: 1.0,
    coins: 5,
    damageToBase: 1,
    size: 0.8,
  },
  bat: { id: 'bat', name: '안개 박쥐', hp: 25, speed: 1.8, coins: 6, damageToBase: 1, size: 0.7 },
  golem: {
    id: 'golem',
    name: '바위 골렘',
    hp: 120,
    speed: 0.6,
    coins: 12,
    damageToBase: 2,
    slowImmune: true,
    size: 1.0,
  },
  ghost: {
    id: 'ghost',
    name: '잉크 유령',
    hp: 60,
    speed: 1.2,
    coins: 8,
    damageToBase: 1,
    phase: { periodSec: 2, hiddenSec: 0.5 },
    size: 0.8,
  },
  dokkaebi: {
    id: 'dokkaebi',
    name: '지우개 도깨비',
    hp: 20,
    speed: 1.4,
    coins: 3,
    damageToBase: 1,
    size: 0.6,
  },
  golden_slime: {
    id: 'golden_slime',
    name: '황금 슬라임',
    hp: 50,
    speed: 1.5,
    coins: 50,
    damageToBase: 0,
    vanishAtBase: true,
    size: 0.8,
  },
  boss_mid: {
    id: 'boss_mid',
    name: '먹구름 대왕 슬라임',
    hp: 400,
    speed: 0.7,
    coins: 60,
    damageToBase: 3,
    boss: 'mid',
    size: 1.4,
  },
  boss_final: {
    id: 'boss_final',
    name: '망각의 용',
    hp: 900,
    speed: 0.6,
    coins: 120,
    damageToBase: 5,
    boss: 'final',
    size: 1.6,
  },
}
