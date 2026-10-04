/** 2단계 고불 맹사성 — 은행나무 노란 잎이 흩날리는 맹씨행단 마당. U자 경로. */
import type { MapDef } from './types'

export const MAENGSASEONG_MAP: MapDef = {
  topicId: 'maengsaseong',
  name: '맹씨행단 마당',
  cols: 16,
  rows: 9,
  waypoints: [
    { x: 0, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 7 },
    { x: 10, y: 7 },
    { x: 10, y: 2 },
    { x: 15, y: 2 },
  ],
  blocked: [
    { x: 2, y: 5 },
    { x: 13, y: 6 },
  ],
  palette: {
    ground: '#e9dcb0',
    groundAlt: '#e2d3a2',
    path: '#cfa978',
    pathEdge: '#a67f52',
    buildable: 'rgba(255, 255, 255, 0.35)',
    accent: '#f2c230',
    accentAlt: '#fff3c4',
    sky: '#fff7e0',
  },
  decor: 'ginkgo',
}
