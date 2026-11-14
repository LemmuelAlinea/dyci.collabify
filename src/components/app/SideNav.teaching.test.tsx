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
const headed = vi.hoisted(() =>
  vi.fn<() => Promise<{ office_id: string; office_name: string } | null>>(async () => null),
)

vi.mock('../../hooks/useProjectLooks', () => ({ useProjectLooks: () => ({}) }))
vi.mock('../../hooks/useAdmission', () => ({ useAdmission: () => true }))
vi.mock('../../hooks/useConversations', () => ({ useUnreadTotal: () => 0 }))
vi.mock('../../hooks/usePendingInvitations', () => ({ usePendingInvitations: () => ({ invitations: [] }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => undefined }))
vi.mock('../../lib/api/waiting', () => ({ teachingWaitingCount: waiting }))
vi.mock('../../lib/api/officeHeads', () => ({ myHeadedOffice: headed }))
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
const hrefs = () => [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))
const projectNames = ['Capstone draft', 'Lab two', 'Lab three', 'Lab one', 'Network plan']

it('opens the rail on the class card, as a student has it, with All classes', async () => {
  await show('/home')
  expect(hrefs()).toContain('/classes/k1')
  const all = [...host.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'All classes')
  expect(all?.getAttribute('href')).toBe('/classes')
  // The card comes before Main's Home row.
  const order = hrefs()
  expect(order.indexOf('/classes/k1')).toBeLessThan(order.indexOf('/home', 1))
})

it('lists no projects under a class, in a class or on one of its projects', async () => {
  for (const at of ['/classes/k1', '/class-projects/p4/boards/b1', '/class-projects/q1']) {
    await show(at)
    for (const name of projectNames) expect(links().some((l) => l.includes(name))).toBe(false)
    expect(host.querySelector('ul[aria-label^="Projects in"]')).toBeNull()
  }
})

it('has no New class row; a class starts from All classes', async () => {
  await show('/home')
  expect(links()).not.toContain('New class')
  expect(hrefs()).not.toContain('/classes?new=1')
})

it('badges Waiting on you with what waits across every class', async () => {
  await show('/home')
  expect(waiting).toHaveBeenCalledWith('me')
  const badge = host.querySelector('[data-badge="waiting"]')
  expect(badge?.textContent).toBe('4')
  expect(badge?.closest('a')?.getAttribute('href')).toBe('/waiting')
})

it('keeps the classes on the collapsed rail, with no projects', async () => {
  await show('/classes/k1', true)
  for (const name of projectNames) expect(links().some((l) => l.includes(name))).toBe(false)
  expect(links()).not.toContain('New class')
})

it('never asks what is waiting for a student, and gives them no class list', async () => {
  who.profile = { id: 'me', role: 'student', status: 'active' }
  await show('/classes/k1')
  expect(waiting).not.toHaveBeenCalled()
  expect(host.querySelector('[data-badge="waiting"]')).toBeNull()
  expect(links()).not.toContain('New class')
})

it('adds My office to the rail once the head read answers, without changing the rail', async () => {
  let answer: (office: { office_id: string; office_name: string } | null) => void = () => {}
  headed.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
  await show('/home')
  // Still asking: the teaching rail, and no My office yet.
  expect(links()).not.toContain('My office')
  expect(hrefs()).toContain('/waiting')
  const before = links()
  await act(async () => answer({ office_id: 'o1', office_name: 'IT services' }))
  expect(headed).toHaveBeenCalledTimes(1)
  const entry = [...host.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'My office')
  expect(entry?.getAttribute('href')).toBe('/office')
  expect(links().filter((l) => l !== 'My office')).toEqual(before)
})

it('leaves My office out for a member who heads nothing, or when the read fails', async () => {
  await show('/home')
  expect(links()).not.toContain('My office')
  headed.mockRejectedValueOnce(new Error('offline'))
  await show('/waiting')
  expect(links()).not.toContain('My office')
  expect(hrefs()).toContain('/waiting')
})

it('never asks a student whether they head an office', async () => {
  who.profile = { id: 'me', role: 'student', status: 'active' }
  await show('/home')
  expect(headed).not.toHaveBeenCalled()
  expect(links()).not.toContain('My office')
})
