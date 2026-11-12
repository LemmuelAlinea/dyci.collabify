// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { TeachingRedirect } from './TeachingRedirect'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const auth = vi.hoisted(() => ({ role: 'member' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { role: auth.role } }) }))

function Where() {
  const l = useLocation()
  return <p>{`at ${l.pathname}${l.search}`}</p>
}

function render(role: string, entry: string, to: string) {
  auth.role = role
  const el = document.createElement('div')
  act(() => {
    createRoot(el).render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/teaching/old" element={<TeachingRedirect to={to} page={<p>old page</p>} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  return el.textContent
}

it('sends a member to the new page and keeps the query', () => {
  expect(render('member', '/teaching/old?status=accepted', '/waiting')).toBe('at /waiting?status=accepted')
})

it('merges the query into a target that has its own', () => {
  expect(render('member', '/teaching/old?x=1', '/waiting?section=reassignments')).toBe(
    'at /waiting?section=reassignments&x=1',
  )
})

it('shows the old page to an admin', () => {
  expect(render('admin', '/teaching/old?status=accepted', '/waiting')).toBe('old page')
})
