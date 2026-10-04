/** 라우터가 필요한 컴포넌트 테스트용 렌더 헬퍼. 현재 경로를 확인할 수 있게 location 표시 노드를 함께 그린다. */
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

export function renderAt(path: string, routes: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {routes}
      <LocationProbe />
    </MemoryRouter>,
  )
}

export { Route, Routes }
