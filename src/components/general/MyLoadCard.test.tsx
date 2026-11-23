// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MyLoadCard } from './MyLoadCard'
import { estimateAccuracy, myTimer, setSpaceWeeklyMinutes, spacePeopleHours, spacePeopleLoad } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({
  spacePeopleLoad: vi.fn(),
  spacePeopleHours: vi.fn(),
  estimateAccuracy: vi.fn(async () => []),
  myTimer: vi.fn(async () => null),
  setSpaceWeeklyMinutes: vi.fn(async () => {}),
}))

const hours = (weekly: number | null) =>
  [{ user_id: 'me', weekly_minutes: weekly, available_minutes: weekly, time_off_minutes: weekly == null ? null : 0 }]

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-25T02:00:00Z')) // Wednesday 25 Nov in Manila
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.mocked(estimateAccuracy).mockResolvedValue([])
  vi.mocked(myTimer).mockResolvedValue(null)
  vi.mocked(spacePeopleHours).mockImplementation(async (space) => hours(space === 's1' ? 960 : null))
  vi.mocked(spacePeopleLoad).mockImplementation(async (space, from) => space === 's1' && from === '2026-11-23'
    ? [{ user_id: 'me', project_id: 'p1', load_minutes: 840, unestimated: 2 }]
    : [])
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function render(spaces = [{ id: 's1', name: 'Capstone 2' }]) {
  await act(async () => root.render(<MemoryRouter><MyLoadCard spaces={spaces} userId="me" /></MemoryRouter>))
  await act(async () => {})
}
const block = (id: string) => host.querySelector<HTMLElement>(`[data-load-space="${id}"]`)

it('card per work space', async () => {
  await render([{ id: 's1', name: 'Capstone 2' }, { id: 's2', name: 'Thesis' }])
  expect(block('s1')!.textContent).toContain('Capstone 2')
  expect(block('s2')!.textContent).toContain('Thesis')
  expect(block('s1')!.textContent).toContain('14 / 16 h this week')
  expect(block('s1')!.textContent).toContain('2 tasks this week have no estimate')
  expect(spacePeopleLoad).toHaveBeenCalledWith('s1', '2026-11-23', '2026-11-27', ['me'])
  expect(host.querySelector('a[href="/settings#time-off"]')?.textContent).toBe('Add time off')
})

it('four weeks of bars', async () => {
  await render()
  expect(block('s1')!.querySelectorAll('[data-load-week]')).toHaveLength(4)
  expect(block('s1')!.querySelector('[data-load-week="0"] [data-tone]')!.getAttribute('data-tone')).toBe('warning')
  expect(spacePeopleHours).toHaveBeenCalledWith('s1', '2026-12-14', '2026-12-18', ['me'])
})

it('no hours set card', async () => {
  await render([{ id: 's2', name: 'Thesis' }])
  expect(block('s2')!.textContent).toContain('Not set')
  expect(block('s2')!.textContent).not.toMatch(/0 \/ 0 h/)
  const input = block('s2')!.querySelector<HTMLInputElement>('input[aria-label="Weekly hours in Thesis"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '16')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...block('s2')!.querySelectorAll('button')].find((b) => b.textContent === 'Set weekly hours')!.click())
  expect(setSpaceWeeklyMinutes).toHaveBeenCalledWith('s2', 'me', 960)
})

it('accuracy line shown', async () => {
  vi.mocked(estimateAccuracy).mockResolvedValue([{ user_id: 'me', ratio: 1.2, tasks: 6 }])
  await render()
  expect(estimateAccuracy).toHaveBeenCalledWith('s1', ['me'])
  expect(block('s1')!.textContent).toContain('Your tasks usually take about 1.2× the estimate.')
})

it('no accuracy below five', async () => {
  await render()
  expect(block('s1')!.textContent).not.toContain('usually take')
})

it('running timer link', async () => {
  vi.mocked(myTimer).mockResolvedValue({ task_id: 't1', project_id: 'p1', title: 'Build the form', started_at: '2026-11-25T01:00:00Z' })
  await render()
  const link = [...host.querySelectorAll('a')].find((a) => a.textContent?.includes('Timer running on Build the form'))
  expect(link?.getAttribute('href')).toBe('/projects/p1?task=t1')
})

it('no card without a work space', async () => {
  await render([])
  expect(host.innerHTML).toBe('')
  expect(spacePeopleLoad).not.toHaveBeenCalled()
  expect(myTimer).not.toHaveBeenCalled()
})
