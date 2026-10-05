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
export const START_COINS = 150
export const LEARN_BONUS = 50
export const MAX_LIVES = 10
/**
 * 단계별 난이도 배율(인덱스 = stage − 1). 1단계는 온천 타워 하나뿐인 첫 판이라 확실히 쉽게,
 * 5단계는 "깰듯 말듯"하게. 보스는 일반 몬스터보다 더 가파르게 약하게 시작한다.
 */
export const STAGE_SCALE = {
  /** 일반 몬스터 체력 */
  hp: [1.0, 1.3, 1.7, 2.2, 2.5],
  /** 보스 체력 */
  bossHp: [0.55, 0.9, 1.5, 2.2, 2.6],
  /** 웨이브 몬스터 수 */
  count: [0.6, 0.9, 1.0, 1.15, 1.2],
} as const

export function stageScale(stage: number): { hp: number; bossHp: number; count: number } {
  const i = Math.min(Math.max(Math.round(stage) - 1, 0), STAGE_SCALE.hp.length - 1)
  return { hp: STAGE_SCALE.hp[i]!, bossHp: STAGE_SCALE.bossHp[i]!, count: STAGE_SCALE.count[i]! }
}
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
  /** 건설 메뉴에 보여 주는 한 줄 설명(무엇을 쏘고 무엇에 강한지) */
  tagline: string
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

/**
 * 타워 5종 — 나중에 열리는 타워일수록 비싸고 확실히 강하다(초당 피해: 7 → 12 → 33 → 20(광역) → 44).
 * 역할도 다르다: 온천=감속, 피리=관통, 거북선=한 방·보스, 종탑=광역, 만세=장거리 연사.
 */
export const TOWERS: Record<TowerId, TowerSpec> = {
  onsen: {
    id: 'onsen',
    name: '온천 타워',
    tagline: '물줄기 · 적을 느리게',
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
    tagline: '소리 파동 · 여러 마리 관통',
    cost: 70,
    range: 3.0,
    damage: 12,
    fireRate: 1.0,
    targeting: 'nearest_base',
    projectile: 'pierce',
    projectileSpeed: 11,
    unlockStage: 2,
    pierce: 3,
  },
  geobukseon: {
    id: 'geobukseon',
    name: '거북선 타워',
    tagline: '대포 · 한 방이 강하고 보스에 강함',
    cost: 100,
    range: 2.6,
    damage: 55,
    fireRate: 0.6,
    targeting: 'max_hp',
    projectile: 'cannon',
    projectileSpeed: 9,
    unlockStage: 3,
    splashRadius: 0.5,
    bossBonus: 0.5,
  },
  bell: {
    id: 'bell',
    name: '종탑 타워',
    tagline: '종소리 · 넓게 퍼지는 충격',
    cost: 120,
    range: 2.4,
    damage: 22,
    fireRate: 0.9,
    targeting: 'nearest_base',
    projectile: 'splash',
    projectileSpeed: 9,
    unlockStage: 4,
    splashRadius: 1.2,
  },
  mansae: {
    id: 'mansae',
    name: '만세 망루',
    tagline: '화살 연사 · 멀리 빠르게',
    cost: 150,
    range: 3.5,
    damage: 11,
    fireRate: 4.0,
    targeting: 'nearest_base',
    projectile: 'rapid',
    projectileSpeed: 14,
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
