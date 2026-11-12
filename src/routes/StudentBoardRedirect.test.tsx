// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { StudentBoardRedirect } from './StudentBoardRedirect'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

function Where() {
  const l = useLocation()
  return <p>{`at ${l.pathname}${l.search}`}</p>
}

function render(entry: string) {
  const el = document.createElement('div')
  act(() => {
    createRoot(el).render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/class-projects/:projectId/boards/:boardId" element={<StudentBoardRedirect />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  return el.textContent
}

it('keeps a files link and its folder on the way to the project', () => {
  expect(render('/class-projects/p1/boards/b1?tab=files&path=report%2Fdrafts')).toBe(
    'at /class-projects/p1?tab=files&path=report%2Fdrafts',
  )
})

it('drops a board-page tab the project does not have', () => {
  expect(render('/class-projects/p1/boards/b1?tab=grade')).toBe('at /class-projects/p1')
})

it('lands on the project with no query when there was none', () => {
  expect(render('/class-projects/p1/boards/b1')).toBe('at /class-projects/p1')
})
