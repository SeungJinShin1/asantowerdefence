import { GONGSERI_MAP } from './gongseri'
import { MAENGSASEONG_MAP } from './maengsaseong'
import { ONYANG_MAP } from './onyang'
import { SEONJANG_MAP } from './seonjang'
import type { MapDef } from './types'
import { YISUNSIN_MAP } from './yisunsin'

export type { MapDef, MapPalette, TilePoint } from './types'

/** 주제별 맵 (docs/02 §2 스테이지 표 순서) */
export const MAPS: Record<string, MapDef> = {
  onyang: ONYANG_MAP,
  maengsaseong: MAENGSASEONG_MAP,
  yisunsin: YISUNSIN_MAP,
  gongseri: GONGSERI_MAP,
  seonjang: SEONJANG_MAP,
}

export function mapForTopic(topicId: string): MapDef {
  return MAPS[topicId] ?? ONYANG_MAP
}
