/** 맵 정의 — docs/02 §3. 격자 16×9, 경로는 타일 좌표 웨이포인트(시작: 왼쪽 가장자리, 끝: 성). */

export interface TilePoint {
  x: number
  y: number
}

export interface MapPalette {
  /** 바탕(잔디·땅) */
  ground: string
  groundAlt: string
  /** 경로 */
  path: string
  pathEdge: string
  /** 건설 가능 타일 하이라이트 */
  buildable: string
  /** 장식 도형 색 */
  accent: string
  accentAlt: string
  sky: string
}

export interface MapDef {
  topicId: string
  name: string
  cols: number
  rows: number
  /** 경로 웨이포인트(타일 좌표, 타일 중심 기준). 첫 점이 입구, 마지막 점이 성 */
  waypoints: TilePoint[]
  /** 추가로 건설을 막는 타일(장식물 자리 등) */
  blocked?: TilePoint[]
  palette: MapPalette
  /** 배경 장식 종류(렌더가 해석) */
  decor: 'onsen' | 'ginkgo' | 'sea' | 'church' | 'market'
}
