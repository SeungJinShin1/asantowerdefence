/** 5단계 선장 4·4 만세운동 — 장터 골목, 초가·장독, 태극기 물결. S자 경로. */
import type { MapDef } from './types'

export const SEONJANG_MAP: MapDef = {
  topicId: 'seonjang',
  name: '선장 장터',
  cols: 16,
  rows: 9,
  waypoints: [
    { x: 0, y: 5 },
    { x: 3, y: 5 },
    { x: 3, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 7 },
    { x: 12, y: 7 },
    { x: 12, y: 4 },
    { x: 15, y: 4 },
  ],
  blocked: [
    { x: 1, y: 7 },
    { x: 6, y: 5 },
    { x: 14, y: 1 },
  ],
  palette: {
    ground: '#e6d7bd',
    groundAlt: '#dccbb0',
    path: '#c4a07a',
    pathEdge: '#9a7a58',
    buildable: 'rgba(255, 255, 255, 0.35)',
    accent: '#7a4b2b',
    accentAlt: '#f5efe6',
    sky: '#fdf6ec',
  },
  decor: 'market',
}
