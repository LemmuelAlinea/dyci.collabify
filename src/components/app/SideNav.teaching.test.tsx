// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SideNav } from './SideNav'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const who = vi.hoisted(() => ({
  profile: { id: 'me', role: 'member', status: 'active', can_teach: true, can_manage_projects: false } as Record<
    string,
    unknown
  >,
}))
const waiting = vi.hoisted(() => vi.fn(async () => 4))

vi.mock('../../hooks/useProjectLooks', () => ({ useProjectLooks: () => ({}) }))
vi.mock('../../hooks/useAdmission', () => ({ useAdmission: () => true }))
vi.mock('../../hooks/useConversations', () => ({ useUnreadTotal: () => 0 }))
vi.mock('../../hooks/usePendingInvitations', () => ({ usePendingInvitations: () => ({ invitations: [] }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => undefined }))
vi.mock('../../lib/api/waiting', () => ({ teachingWaitingCount: waiting }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: who.profile }) }))

const space = (id: string, name: string, class_id: string) => ({
  id, name, class_id, kind: 'education', my_level: 'owner', archived_at: null,
})
const project = (id: string, title: string, class_id: string, updated_at: string) => ({
  id, title, class_id, updated_at, archived_at: null,
})
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({
    spaces: [space('s1', 'IT 301 · BSIT 3A', 'k1'), space('s2', 'IT 302 · BSIT 3B', 'k2')],
    invitations: [],
    currentSpaceId: null,
    myProjects: [],
    classProjects: [
      project('p1', 'Capstone draft', 'k1', '2026-10-05'),
      project('p2', 'Lab two', 'k1', '2026-10-04'),
      project('p3', 'Lab three', 'k1', '2026-10-03'),
      project('p4', 'Lab one', 'k1', '2026-10-01'),
      project('q1', 'Network plan', 'k2', '2026-10-02'),
    ],
  }),
}))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // No storage in this environment: nothing is folded.
  }
  who.profile = { id: 'me', role: 'member', status: 'active', can_teach: true, can_manage_projects: false }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const show = (at: string, collapsed = false) =>
  act(async () =>
    root.render(
      <MemoryRouter key={at} initialEntries={[at]}>
        <SideNav collapsed={collapsed} />
      </MemoryRouter>,
    ),
  )
const links = () => [...host.querySelectorAll('a')].map((a) => a.textContent?.trim() ?? '')
const projectsUnder = (name: string) =>
  [...(host.querySelector(`ul[aria-label="Projects in ${name}"]`)?.querySelectorAll('a') ?? [])].map(
    (a) => a.textContent?.trim().slice(1),
  )

it('lists the taught classes with their sections and opens the class in view onto its projects', async () => {
  await show('/classes/k1')
  expect(links()).toContain('IIT 301 · BSIT 3A')
  expect(links()).toContain('IIT 302 · BSIT 3B')
  expect(projectsUnder('IT 301 · BSIT 3A')).toEqual(['Capstone draft', 'Lab two', 'Lab three'])
  expect(host.querySelector('ul[aria-label="Projects in IT 302 · BSIT 3B"]')).toBeNull()
})

it('keeps the class open on one of its projects, and keeps that project listed past the cap', async () => {
  await show('/class-projects/p4/boards/b1')
  expect(projectsUnder('IT 301 · BSIT 3A')).toEqual(['Capstone draft', 'Lab two', 'Lab one'])
  await show('/class-projects/q1')
  expect(projectsUnder('IT 302 · BSIT 3B')).toEqual(['Network plan'])
  expect(host.querySelector('ul[aria-label="Projects in IT 301 · BSIT 3A"]')).toBeNull()
})

it('opens no class anywhere else, and ends the list with New class', async () => {
  await show('/home')
  expect(host.querySelector('ul[aria-label^="Projects in"]')).toBeNull()
  const add = [...host.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'New class')
  expect(add?.getAttribute('href')).toBe('/classes?new=1')
})

it('badges Waiting on you with what waits across every class', async () => {
  await show('/home')
  expect(waiting).toHaveBeenCalledWith('me')
  const badge = host.querySelector('[data-badge="waiting"]')
  expect(badge?.textContent).toBe('4')
  expect(badge?.closest('a')?.getAttribute('href')).toBe('/waiting')
})

it('keeps only the class letters on the collapsed rail', async () => {
  await show('/classes/k1', true)
  const named = [...host.querySelectorAll('a[aria-label]')].map((a) => a.getAttribute('aria-label'))
  expect(named).toContain('IT 301 · BSIT 3A')
  expect(host.querySelector('ul[aria-label^="Projects in"]')).toBeNull()
  expect(links()).not.toContain('New class')
})

it('never asks what is waiting for a student, and gives them no class list', async () => {
  who.profile = { id: 'me', role: 'student', status: 'active' }
  await show('/classes/k1')
  expect(waiting).not.toHaveBeenCalled()
  expect(host.querySelector('[data-badge="waiting"]')).toBeNull()
  expect(links()).not.toContain('New class')
})
