/** 4단계 공세리 성당 — 언덕 위 붉은 벽돌 성당, 보호수. 굽이진 경로. */
import type { MapDef } from './types'

export const GONGSERI_MAP: MapDef = {
  topicId: 'gongseri',
  name: '성당 언덕',
  cols: 16,
  rows: 9,
  waypoints: [
    { x: 0, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 1 },
    { x: 10, y: 1 },
    { x: 10, y: 5 },
    { x: 15, y: 5 },
  ],
  blocked: [
    { x: 4, y: 3 },
    { x: 13, y: 2 },
    { x: 13, y: 7 },
  ],
  palette: {
    ground: '#d8e4c2',
    groundAlt: '#cddbb4',
    path: '#c98b6b',
    pathEdge: '#9c664a',
    buildable: 'rgba(255, 255, 255, 0.35)',
    accent: '#4e8a4a',
    accentAlt: '#f6e7d8',
    sky: '#f3f7ea',
  },
  decor: 'church',
}
