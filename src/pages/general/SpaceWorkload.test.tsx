// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceWorkload from './SpaceWorkload'
import { spacePeopleHours, spacePeopleLoad, spacePersonTasks } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../lib/api/spaces', () => ({
  listSpaceMembers: vi.fn(async () => [
    { user_id: 'ana', first_name: 'Ana', last_name: 'Cruz' },
    { user_id: 'ben', first_name: 'Ben', last_name: 'Reyes' },
    { user_id: 'cy', first_name: 'Cy', last_name: 'Lim' },
  ]),
}))
vi.mock('./spaceOutlet', () => ({ useSpaceOutlet: () => ({ all: [{ id: 'p1', name: 'Login work' }] }) }))
vi.mock('../../lib/api/workload', () => ({
  spacePeopleLoad: vi.fn(),
  spacePeopleHours: vi.fn(),
  spacePersonTasks: vi.fn(async () => [
    { task_id: 't1', project_id: 'p1', title: 'Build the form', minutes: 360, unestimated: false },
  ]),
  spaceWorkloadSummary: vi.fn(async () => ({ unestimated_tasks: 3, people_without_hours: 1 })),
}))

const hours = (user_id: string, weekly: number | null, off = 0) =>
  ({ user_id, weekly_minutes: weekly, available_minutes: weekly == null ? null : weekly - off, time_off_minutes: weekly == null ? null : off })

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

async function render() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/spaces/s1/workload']}>
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

it('counts what is unknown in the footer', async () => {
  await render()
  expect(document.body.textContent).toContain('3 tasks have no estimate · 1 person has no weekly hours set')
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
