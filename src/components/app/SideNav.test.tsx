// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SideNav } from './SideNav'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const looks = vi.hoisted(() => vi.fn<(ids: readonly string[]) => Record<string, unknown>>())
vi.mock('../../hooks/useProjectLooks', () => ({ useProjectLooks: looks }))
vi.mock('../../hooks/useAdmission', () => ({ useAdmission: () => true }))
vi.mock('../../hooks/useConversations', () => ({ useUnreadTotal: () => 0 }))
vi.mock('../../hooks/usePendingInvitations', () => ({ usePendingInvitations: () => ({ invitations: [] }) }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', role: 'student', status: 'active' } }),
}))

const work = (id: string, name: string, updated_at: string) => ({
  id, name, updated_at, my_level: 'member', archived_at: null,
})
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({
    spaces: [],
    invitations: [],
    myProjects: [work('w1', 'Alpha', '2026-10-03'), work('w2', 'Beta', '2026-10-02')],
    classProjects: [{ id: 'c1', title: 'Gamma', updated_at: '2026-10-01' }],
  }),
}))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  looks.mockReturnValue({})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const show = () => act(async () => root.render(<MemoryRouter><SideNav /></MemoryRouter>))
/** The tile at the start of a Quick access row. */
const tile = (name: string) => {
  const link = [...host.querySelectorAll('a')].find((a) => a.textContent?.trim().endsWith(name))!
  return link.querySelector<HTMLElement>('span[aria-hidden]')!
}

it('draws the letter for a work project with no look and for a class project', async () => {
  await show()
  expect(tile('Alpha').textContent).toBe('A')
  expect(tile('Alpha').className).toContain('border-line')
  expect(tile('Alpha').querySelector('svg')).toBeNull()
  expect(tile('Gamma').textContent).toBe('G')
  expect(tile('Gamma').className).toContain('bg-amber-400/18')
})

it('draws the mark for a work project that has a look', async () => {
  looks.mockReturnValue({ w2: { color: 'teal', icon: 'monitor' } })
  await show()
  expect(tile('Beta').className).toContain('bg-swatch-teal')
  expect(tile('Beta').querySelector('svg')).not.toBeNull()
  expect(tile('Alpha').querySelector('svg')).toBeNull()
})

it('never gives a class project a look, even one with the same id', async () => {
  looks.mockReturnValue({ c1: { color: 'rose', icon: 'bell' } })
  await show()
  expect(tile('Gamma').className).not.toContain('swatch')
})

it('asks for the looks of the work projects only, in one call', async () => {
  await show()
  const asked = looks.mock.calls.map(([ids]) => [...ids])
  expect(asked.every((ids) => ids.join() === 'w1,w2')).toBe(true)
})
