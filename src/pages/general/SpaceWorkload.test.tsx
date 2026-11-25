// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceWorkload from './SpaceWorkload'
import { removeTimeOffRange, spaceAwayRanges, spacePeopleHours, spacePeopleLoad, spacePersonTasks } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../lib/api/spaces', () => ({
  listSpaceMembers: vi.fn(async () => [
    { user_id: 'ana', first_name: 'Ana', last_name: 'Cruz', role: 'member' },
    { user_id: 'ben', first_name: 'Ben', last_name: 'Reyes', role: 'coordinator' },
    { user_id: 'cy', first_name: 'Cy', last_name: 'Lim', role: 'member' },
  ]),
}))
vi.mock('../../lib/api/general', () => ({
  listSpaceTeams: vi.fn(async () => [{ id: 'web', name: 'Web team' }]),
  listSpaceTeamMembers: vi.fn(async () => [{ team_id: 'web', user_id: 'ana' }]),
}))
vi.mock('./spaceOutlet', () => ({ useSpaceOutlet: () => ({ all: [{ id: 'p1', name: 'Login work' }] }) }))
vi.mock('../../lib/api/workload', () => ({
  spacePeopleLoad: vi.fn(),
  spacePeopleHours: vi.fn(),
  spacePersonTasks: vi.fn(async () => [
    { task_id: 't1', project_id: 'p1', title: 'Build the form', minutes: 360, unestimated: false },
  ]),
  spaceWorkloadSummary: vi.fn(async () => ({ unestimated_tasks: 3, people_without_hours: 1 })),
  estimateAccuracy: vi.fn(async () => [{ user_id: 'ben', ratio: 1.2, tasks: 5 }]),
  spaceAwayRanges: vi.fn(async () => [
    { user_id: 'ben', first_day: '2026-11-26', last_day: '2026-11-27', part_day: false, added_by: 'pm' },
    { user_id: 'ana', first_day: '2026-12-01', last_day: '2026-12-01', part_day: true, added_by: null },
  ]),
  removeTimeOffRange: vi.fn(async () => 2),
}))
const nav = vi.hoisted(() => ({ role: 'pm' as string | null }))
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({ currentSpace: { id: 's1', my_role: nav.role, archived_at: null } }),
}))
vi.mock('../../components/general/MarkAwayDialog', () => ({
  MarkAwayDialog: (p: { open: boolean; name: string; initial?: { from: string; to: string } }) =>
    p.open ? <div data-testid="mark-away">{p.name} {p.initial ? `${p.initial.from}..${p.initial.to}` : 'new'}</div> : null,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'pm' } }) }))
vi.mock('../../components/general/WorkTaskOverlay', () => ({
  WorkTaskOverlay: (p: { projectId: string; taskId: string; viewerId?: string; onClose: () => void }) => (
    <div data-testid="task-overlay">
      {p.projectId}/{p.taskId}/{p.viewerId}
      <button type="button" onClick={p.onClose}>Close task</button>
    </div>
  ),
}))

const hours = (user_id: string, weekly: number | null, off = 0) =>
  ({ user_id, weekly_minutes: weekly, own_weekly_minutes: weekly, available_minutes: weekly == null ? null : weekly - off, time_off_minutes: weekly == null ? null : off })

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-25T02:00:00Z')) // Wednesday 25 Nov in Manila
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.mocked(spacePeopleHours).mockImplementation(async (_s, from) =>
    from === '2026-11-23' ? [hours('ana', 960), hours('ben', 960, 240), hours('cy', null)] : [hours('ana', 960), hours('ben', 960), hours('cy', null)])
  vi.mocked(spacePeopleLoad).mockImplementation(async (_s, from) => from === '2026-11-23'
    ? [
        { user_id: 'ana', project_id: 'p1', load_minutes: 600, unestimated: 0 },
        { user_id: 'ben', project_id: 'p1', load_minutes: 420, unestimated: 0 },
        { user_id: 'ben', project_id: null, load_minutes: 360, unestimated: 0 },
        { user_id: 'cy', project_id: 'p1', load_minutes: 300, unestimated: 1 },
      ]
    : [{ user_id: 'ana', project_id: 'p1', load_minutes: 1080, unestimated: 0 }])
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function render(entry = '/spaces/s1/workload') {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/spaces/:spaceId/workload" element={<SpaceWorkload />} /></Routes>
    </MemoryRouter>,
  ))
  await act(async () => {})
}
const cell = (user: string, week: number) => document.querySelector<HTMLElement>(`[data-person="${user}"] [data-week="${week}"]`)

it('four weeks from this week', async () => {
  await render()
  const heads = [...document.querySelectorAll('[data-week-head]')].map((h) => h.textContent)
  expect(heads).toEqual(['Mon 23 Nov', 'Mon 30 Nov', 'Mon 7 Dec', 'Mon 14 Dec'])
  expect(spacePeopleLoad).toHaveBeenCalledWith('s1', '2026-11-23', '2026-11-27')
  expect(spacePeopleHours).toHaveBeenCalledWith('s1', '2026-12-14', '2026-12-18')
})

it('bar tones', async () => {
  await render()
  expect(cell('ana', 0)!.textContent).toContain('10 / 16 h')
  expect(cell('ana', 0)!.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('success')
  expect(cell('ben', 0)!.textContent).toContain('13 / 12 h')
  expect(cell('ben', 0)!.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('danger')
  expect(cell('ana', 1)!.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('danger')
  expect(cell('ben', 0)!.querySelector('[data-time-off]')).not.toBeNull()
})

it('no hours set', async () => {
  await render()
  expect(cell('cy', 0)!.textContent).toContain('Not set')
  expect(cell('cy', 0)!.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('pending')
  expect(document.body.textContent).not.toContain('NaN')
})

it('pm sees folded other work', async () => {
  await render()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-person="ben"] button[aria-expanded]')!.click())
  await act(async () => {})
  expect(spacePersonTasks).toHaveBeenCalledWith('s1', 'ben', '2026-11-23', '2026-11-27')
  expect(document.body.textContent).toContain('Build the form')
  expect(document.body.textContent).toContain('Login work')
  expect(document.body.textContent).toContain('Other work in this space · 6 h')
})

it('a task in the list opens over the page', async () => {
  await render('/spaces/s1/workload?status=over')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-person="ben"] button[aria-expanded]')!.click())
  await act(async () => {})
  await act(async () => document.querySelector<HTMLButtonElement>('[data-open-task="t1"]')!.click())
  const overlay = document.querySelector('[data-testid="task-overlay"]')!
  expect(overlay.textContent).toContain('p1/t1/pm')
  // The row and the filters stay as they were behind it.
  expect(document.querySelector('[data-person="ben"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[aria-pressed="true"]')!.textContent).toContain('Over')
  const close = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Close task')!
  await act(async () => close.click())
  expect(document.querySelector('[data-testid="task-overlay"]')).toBeNull()
  expect(document.body.textContent).toContain('Build the form')
})

it('expand loads tasks once', async () => {
  await render()
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-person="ana"] button[aria-expanded]')!
  await act(async () => toggle().click())
  await act(async () => toggle().click())
  await act(async () => toggle().click())
  expect(spacePersonTasks).toHaveBeenCalledTimes(1)
})

it('member own row only', async () => {
  vi.mocked(spacePeopleHours).mockImplementation(async () => [hours('cy', null)])
  vi.mocked(spacePeopleLoad).mockImplementation(async () => [])
  await render()
  expect(document.querySelectorAll('[data-person]').length).toBe(1)
})

it('moves a week with the arrows', async () => {
  await render()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click())
  await act(async () => {})
  expect(document.querySelector('[data-week-head]')!.textContent).toBe('Mon 30 Nov')
})

const rows = () => [...document.querySelectorAll('[data-person]')].map((r) => r.getAttribute('data-person'))
const stat = (label: string) => [...document.querySelectorAll('[data-summary] > *')].find((el) => el.textContent?.startsWith(label.toUpperCase()) || el.textContent?.startsWith(label))!

it('sums the week in the summary strip', async () => {
  await render()
  // Ana 10 of 16 h, Ben 13 of 12 h (away 26–27 Nov), Cy with no hours.
  expect(stat('Team load').textContent).toContain('100%')
  expect(stat('Over').textContent).toContain('1')
  expect(stat('Near full').textContent).toContain('0')
  expect(stat('Has room').textContent).toContain('2')
  expect(stat('Away').textContent).toContain('1')
  expect(stat('No estimate').textContent).toContain('3')
})

it('a summary count filters the list', async () => {
  await render()
  await act(async () => (stat('Over') as HTMLButtonElement).click())
  expect(rows()).toEqual(['ben'])
  await act(async () => (stat('Over') as HTMLButtonElement).click())
  expect(rows()).toHaveLength(3)
})

it('searches names', async () => {
  await render()
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search people"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ana')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(rows()).toEqual(['ana'])
})

it('a project filter shows that project and the rest as elsewhere', async () => {
  await render('/spaces/s1/workload?project=p1')
  expect(cell('ben', 0)!.textContent).toContain('7 / 12 h')
  expect(cell('ben', 0)!.textContent).toContain('+6 h elsewhere')
  // The tone is still Ben's whole week.
  expect(cell('ben', 0)!.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('danger')
})

it('filters by role from the link and shows the role', async () => {
  await render('/spaces/s1/workload?role=coordinator')
  expect(rows()).toEqual(['ben'])
  expect(document.querySelector('[data-person="ben"] [data-role]')!.textContent).toBe('Coordinator')
})

it('filters by team from the link', async () => {
  await render('/spaces/s1/workload?team=web')
  expect(rows()).toEqual(['ana'])
})

it('sorts by most loaded first', async () => {
  await render()
  expect(rows()).toEqual(['ben', 'ana', 'cy'])
})

it('sorts by most free hours', async () => {
  await render('/spaces/s1/workload?sort=free')
  // Ana has 6 h free, Ben is 1 h over, Cy holds 5 h with no hours set.
  expect(rows()).toEqual(['ana', 'ben', 'cy'])
})

it('says when no one matches and clears the filters', async () => {
  await render('/spaces/s1/workload?q=zzz')
  expect(document.body.textContent).toContain('No one matches these filters.')
  const clear = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Clear filters')
  await act(async () => clear.at(-1)!.click())
  expect(rows()).toHaveLength(3)
})

it('retries a row whose tasks failed to load', async () => {
  vi.mocked(spacePersonTasks).mockRejectedValueOnce(new Error('offline'))
  await render()
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-person="ana"] button[aria-expanded]')!
  await act(async () => toggle().click())
  await act(async () => {})
  expect(document.body.textContent).toContain('Could not load these tasks.')
  await act(async () => toggle().click())
  await act(async () => toggle().click())
  await act(async () => {})
  expect(spacePersonTasks).toHaveBeenCalledTimes(2)
  expect(document.body.textContent).toContain('Build the form')
})

it('shows no empty message while tasks load', async () => {
  vi.mocked(spacePersonTasks).mockReturnValueOnce(new Promise(() => {}))
  await render()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-person="ana"] button[aria-expanded]')!.click())
  expect(document.body.textContent).not.toContain('No estimated work this week.')
  expect(document.body.textContent).toContain('Loading')
})

it('loads the open row again for a new week', async () => {
  await render()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-person="ana"] button[aria-expanded]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click())
  await act(async () => {})
  expect(spacePersonTasks).toHaveBeenLastCalledWith('s1', 'ana', '2026-11-30', '2026-12-04')
})

it('keeps each space apart', async () => {
  const { useNavigate } = await import('react-router-dom')
  function Go() { const go = useNavigate(); return <button type="button" onClick={() => go('/spaces/s2/workload')}>Go</button> }
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/spaces/s1/workload']}>
      <Go />
      <Routes><Route path="/spaces/:spaceId/workload" element={<SpaceWorkload />} /></Routes>
    </MemoryRouter>,
  ))
  await act(async () => {})
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Go')!.click())
  await act(async () => {})
  expect(spacePeopleLoad).toHaveBeenCalledWith('s2', '2026-11-23', '2026-11-27')
})

it('expanded row shows accuracy', async () => {
  await render()
  const open = (user: string) => document.querySelector<HTMLButtonElement>(`[data-person="${user}"] button[aria-expanded]`)!
  await act(async () => open('ben').click())
  await act(async () => {})
  expect(document.body.textContent).toContain('Usually takes about 1.2× the estimate.')
  await act(async () => open('ana').click())
  await act(async () => {})
  expect(document.body.textContent).not.toContain('Usually takes about')
})

const open = (user: string) => document.querySelector<HTMLButtonElement>(`[data-person="${user}"] button[aria-expanded]`)!
const buttonIn = (el: Element, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === text)

it('away range shown on row', async () => {
  nav.role = 'member'
  await render()
  expect(spaceAwayRanges).toHaveBeenCalledWith('s1')
  expect(document.querySelector('[data-person="ben"]')!.textContent).toContain('Away 26–27 Nov')
  expect(document.querySelector('[data-person="ana"]')!.textContent).toContain('Away 1 Dec (part day)')
  nav.role = 'pm'
})

it('mark away planner only', async () => {
  nav.role = 'member'
  await render()
  await act(async () => open('ben').click())
  expect(buttonIn(document.body, 'Mark away')).toBeUndefined()
  nav.role = 'coordinator'
  await act(async () => open('ben').click())
  await act(async () => open('ben').click())
  await act(async () => buttonIn(document.body, 'Mark away')!.click())
  expect(document.querySelector('[data-testid="mark-away"]')!.textContent).toBe('Ben Reyes 2026-11-26..2026-11-27')
  nav.role = 'pm'
})

it('planner removes planner range', async () => {
  await render()
  await act(async () => open('ben').click())
  await act(async () => buttonIn(document.body, 'Remove')!.click())
  expect(removeTimeOffRange).toHaveBeenCalledWith('ben', '2026-11-26', '2026-11-27')
  await act(async () => open('ben').click())
  await act(async () => open('ana').click())
  expect(buttonIn(document.body, 'Remove')).toBeUndefined()
})

it('away param opens dialog', async () => {
  await render('/spaces/s1/workload?away=ben')
  expect(document.querySelector('[data-testid="mark-away"]')!.textContent).toBe('Ben Reyes 2026-11-26..2026-11-27')
})
