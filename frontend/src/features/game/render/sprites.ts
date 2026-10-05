/**
 * 스프라이트 — docs/02 §4·§5, assets/prompts/gemini_image_prompts.md 파일명 규칙.
 * 이미지는 /assets/towers/tower_<id>.png, /assets/enemies/enemy_<id>.png, boss_mid.png, boss_final.png.
 * 로드 실패·미도착이면 폴백: 타워 = 색 사각형 + 이름 첫 글자, 몬스터 = 색 원 + 눈 두 개 (docs/05 "이미지 자산이 아직 없을 때").
 */
import { ENEMIES, type EnemyId, TOWERS, type TowerId } from '../config/balance'

export const TOWER_COLORS: Record<TowerId, string> = {
  onsen: '#4fb3a9',
  piri: '#c9a227',
  geobukseon: '#2f4f8f',
  bell: '#b5503c',
  mansae: '#d7a86e',
}

export const ENEMY_COLORS: Record<EnemyId, string> = {
  slime: '#5d6b86',
  bat: '#9b8bc4',
  golem: '#7d8a7a',
  ghost: '#2b2b3a',
  dokkaebi: '#d98b3f',
  golden_slime: '#f4c430',
  boss_mid: '#3f4a6b',
  boss_final: '#5a3d7a',
}

export const BASE_SPRITE_URL = '/assets/base/base_castle.png'

/** 원본 그림이 왼쪽을 보는 스프라이트(규칙은 오른쪽). 좌우 반전을 반대로 적용한다. 이미지를 바꾸면 여기만 고친다 */
export const FACES_LEFT: ReadonlySet<string> = new Set(['slime', 'golem'])

export function spriteUrl(kind: 'tower' | 'enemy', id: string): string {
  if (kind === 'tower') return `/assets/towers/tower_${id}.png`
  if (id.startsWith('boss_')) return `/assets/enemies/${id}.png`
  return `/assets/enemies/enemy_${id}.png`
}

interface Entry {
  img: HTMLImageElement
  ready: boolean
  failed: boolean
}

/** 이미지 캐시. 처음 요청할 때 로드를 시작하고 준비되기 전에는 null 을 돌려준다 */
export class SpriteCache {
  private readonly entries = new Map<string, Entry>()

  get(url: string): HTMLImageElement | null {
    let entry = this.entries.get(url)
    if (!entry) {
      if (typeof Image === 'undefined') return null
      const img = new Image()
      const created: Entry = { img, ready: false, failed: false }
      img.onload = () => {
        created.ready = true
      }
      img.onerror = () => {
        created.failed = true
      }
      img.src = url
      this.entries.set(url, created)
      entry = created
    }
    return entry.ready && !entry.failed ? entry.img : null
  }

  preload(urls: string[]): void {
    urls.forEach((u) => this.get(u))
  }
}

export function allSpriteUrls(stage: number): string[] {
  const towers = (Object.keys(TOWERS) as TowerId[]).map((id) => spriteUrl('tower', id))
  const enemies = (Object.keys(ENEMIES) as EnemyId[]).map((id) => spriteUrl('enemy', id))
  return [...towers, ...enemies, `/assets/enemies/boss_mid_s${stage}.png`, BASE_SPRITE_URL]
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawTowerSprite(
  ctx: CanvasRenderingContext2D,
  cache: SpriteCache,
  type: TowerId,
  level: number,
  cx: number,
  cy: number,
  size: number,
): void {
  const img = cache.get(spriteUrl('tower', type))
  if (img) {
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
  } else {
    ctx.fillStyle = TOWER_COLORS[type]
    roundRect(ctx, cx - size * 0.36, cy - size * 0.36, size * 0.72, size * 0.72, size * 0.14)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(size * 0.36)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(TOWERS[type].name.charAt(0), cx, cy + 1)
  }
  // 레벨 표시: 업그레이드 3회까지는 별, 그 이상은 ★N
  if (level > 1) {
    const stars = level - 1
    ctx.fillStyle = '#ffd43b'
    ctx.font = `bold ${Math.round(size * 0.26)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 3
    const label = stars <= 3 ? '★'.repeat(stars) : `★${stars}`
    ctx.strokeText(label, cx, cy - size * 0.42)
    ctx.fillText(label, cx, cy - size * 0.42)
  }
}

export function drawEnemySprite(
  ctx: CanvasRenderingContext2D,
  cache: SpriteCache,
  type: EnemyId,
  cx: number,
  cy: number,
  size: number,
  heading: -1 | 0 | 1,
  alpha: number,
  stage?: number,
): void {
  // 스테이지별 중간보스 변형(boss_mid_s1~5)이 있으면 우선, 없으면 기본 이미지 (docs/02 §5)
  let spriteId: string = type
  let img: HTMLImageElement | null = null
  if (type === 'boss_mid' && stage) {
    spriteId = `boss_mid_s${stage}`
    img = cache.get(spriteUrl('enemy', spriteId))
  }
  if (!img) {
    spriteId = type
    img = cache.get(spriteUrl('enemy', type))
  }
  ctx.save()
  ctx.globalAlpha = alpha
  if (img) {
    ctx.translate(cx, cy)
    const movingLeft = heading < 0
    if (movingLeft !== FACES_LEFT.has(spriteId)) ctx.scale(-1, 1) // 규칙: 원본은 오른쪽을 본다
    ctx.drawImage(img, -size / 2, -size / 2, size, size)
  } else {
    const r = size * 0.4
    ctx.fillStyle = ENEMY_COLORS[type]
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 2
    ctx.stroke()
    const dir = heading < 0 ? -1 : 1
    ctx.fillStyle = '#fff'
    for (const dx of [-0.3, 0.3]) {
      ctx.beginPath()
      ctx.arc(cx + dx * r + dir * r * 0.15, cy - r * 0.2, r * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#222'
    for (const dx of [-0.3, 0.3]) {
      ctx.beginPath()
      ctx.arc(cx + dx * r + dir * r * 0.25, cy - r * 0.2, r * 0.1, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}
