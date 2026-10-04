/** 1단계 온양온천 — 김이 오르는 온천 마을. S자 경로. */
import type { MapDef } from './types'

export const ONYANG_MAP: MapDef = {
  topicId: 'onyang',
  name: '온양온천 마을',
  cols: 16,
  rows: 9,
  waypoints: [
    { x: 0, y: 4 },
    { x: 3, y: 4 },
    { x: 3, y: 1 },
    { x: 7, y: 1 },
    { x: 7, y: 7 },
    { x: 11, y: 7 },
    { x: 11, y: 3 },
    { x: 15, y: 3 },
  ],
  blocked: [
    { x: 1, y: 1 },
    { x: 13, y: 7 },
  ],
  palette: {
    ground: '#cfe6b8',
    groundAlt: '#c2dca9',
    path: '#d9b48f',
    pathEdge: '#b98f66',
    buildable: 'rgba(255, 255, 255, 0.35)',
    accent: '#7fc8c2',
    accentAlt: '#f3f7f6',
    sky: '#e8f4ff',
  },
  decor: 'onsen',
}
