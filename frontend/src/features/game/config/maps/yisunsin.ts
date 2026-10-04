/** 3단계 충무공 이순신 — 바다·포구, 파도, 망루. 지그재그 경로. */
import type { MapDef } from './types'

export const YISUNSIN_MAP: MapDef = {
  topicId: 'yisunsin',
  name: '포구와 바다',
  cols: 16,
  rows: 9,
  waypoints: [
    { x: 0, y: 7 },
    { x: 4, y: 7 },
    { x: 4, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 6 },
    { x: 12, y: 6 },
    { x: 12, y: 3 },
    { x: 15, y: 3 },
  ],
  blocked: [
    { x: 1, y: 1 },
    { x: 14, y: 7 },
  ],
  palette: {
    ground: '#cfe3ea',
    groundAlt: '#c2d9e2',
    path: '#d9c39a',
    pathEdge: '#b39b70',
    buildable: 'rgba(255, 255, 255, 0.35)',
    accent: '#3c7bb3',
    accentAlt: '#e8f3fb',
    sky: '#dff1ff',
  },
  decor: 'sea',
}
