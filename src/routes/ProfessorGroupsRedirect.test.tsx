// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ classes: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'member' } }) }))
vi.mock('../lib/api/classes', () => ({ listProfessorClasses: m.classes }))

import { ProfessorGroupsRedirect } from './ProfessorGroupsRedirect'

function Where() {
  const l = useLocation()
  return <p>{`at ${l.pathname}${l.search}`}</p>
}

async function land(classes: Promise<{ id: string }[]>) {
  m.classes.mockReturnValue(classes)
  const el = document.createElement('div')
  await act(async () => {
    createRoot(el).render(
      <MemoryRouter initialEntries={['/groups']}>
        <Routes>
          <Route path="/groups" element={<ProfessorGroupsRedirect />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  return el.textContent
}

it("opens the only taught class's Groups tab", async () => {
  expect(await land(Promise.resolve([{ id: 'c1' }]))).toBe('at /classes/c1?tab=settings&section=groups')
})

it('opens the Classes page for several classes', async () => {
  expect(await land(Promise.resolve([{ id: 'c1' }, { id: 'c2' }]))).toBe('at /classes')
})

it('opens the Classes page when the classes cannot load', async () => {
  expect(await land(Promise.reject(new Error('offline')))).toBe('at /classes')
})
