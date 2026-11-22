// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkloadPlanDialog } from './WorkloadPlanDialog'
import { applyBreakdown, breakdownContext, spacePeopleHours, spacePeopleLoad } from '../../lib/api/workload'
import { draftBreakdown } from '../../lib/api/workAi'
import type { PlanRow } from '../../../supabase/functions/_shared/workloadPlan.ts'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({
  breakdownContext: vi.fn(),
  spacePeopleLoad: vi.fn(),
  spacePeopleHours: vi.fn(),
  applyBreakdown: vi.fn(),
}))
vi.mock('../../lib/api/workAi', () => ({ draftBreakdown: vi.fn() }))

const candidate = (id: string, tag: string) => ({ user_id: id, name: id.toUpperCase(), tags: [tag], position_ids: [] })

const context = (over: Record<string, unknown> = {}) => ({
  parent: {
    id: 'parent', project_id: 'p', title: 'Develop Login Module', description: '', task_flow: 'planned', team_id: 't',
    routing_state: 'released', starts_at: '2026-11-22T16:00:00Z', due_at: '2026-11-27T15:59:00Z', has_subtasks: false,
    allow_subtasks: true, allow_dependencies: true, holder_ids: ['a', 'b', 'c'],
  },
  blocked: null,
  positions: [],
  tags: ['Auth', 'Testing', 'UI'],
  candidates: [candidate('a', 'Auth'), candidate('b', 'UI'), candidate('c', 'Testing')],
  ...over,
})

const row = (key: string, title: string, minutes: number, tag: string, dependsOn: string[] = []): PlanRow =>
  ({ key, title, description: '', minutes, tags: [tag], position: null, dependsOn, owner: null, pinned: false })

const login = () => [
  row('contract', 'Define sign-in contract', 120, 'Auth'),
  row('design', 'Design login page states', 120, 'UI'),
  row('cases', 'Prepare test cases', 180, 'Testing'),
  row('auth', 'Auth and session handling', 360, 'Auth', ['contract']),
  row('interface', 'Build interface and validation', 480, 'UI', ['contract']),
  row('integration', 'Integrate front and back', 240, 'Testing', ['auth', 'interface']),
  row('e2e', 'End-to-end checks', 300, 'Testing', ['integration']),
]

const loads = (a = 360) => [
  { user_id: 'a', project_id: 'p', load_minutes: a, unestimated: 0 },
  { user_id: 'b', project_id: 'p', load_minutes: 240, unestimated: 2 },
  { user_id: 'c', project_id: null, load_minutes: 120, unestimated: 1 },
]
const hours = (a = 960) => ['a', 'b', 'c'].map(id =>
  ({ user_id: id, weekly_minutes: 960, available_minutes: id === 'a' ? a : 960, time_off_minutes: 0 }))

let container: HTMLDivElement
let root: Root
const onSaved = vi.fn()
const onClose = vi.fn()

beforeEach(() => {
  vi.mocked(breakdownContext).mockReset().mockResolvedValue(context() as never)
  vi.mocked(draftBreakdown).mockReset().mockResolvedValue({ result: 'ok', rows: login() })
  vi.mocked(spacePeopleLoad).mockReset().mockResolvedValue(loads())
  vi.mocked(spacePeopleHours).mockReset().mockResolvedValue(hours())
  vi.mocked(applyBreakdown).mockReset().mockResolvedValue(['s1'])
  onSaved.mockReset()
  onClose.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)
const click = async (label: string) => {
  const b = button(label)
  if (!b) throw new Error(`No button "${label}"`)
  await act(async () => b.click())
}
const field = <T extends HTMLElement>(label: string) => {
  const el = document.querySelector<T>(`[aria-label="${label}"]`)
  if (!el) throw new Error(`No field "${label}"`)
  return el
}
const type = async (label: string, value: string) => {
  const el = field<HTMLInputElement>(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const choose = async (label: string, value: string) => {
  const el = field<HTMLSelectElement>(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const count = (needle: string) => text().split(needle).length - 1

async function openAndDraft() {
  await act(async () => root.render(
    <WorkloadPlanDialog parentId="parent" projectId="p" spaceId="s" onClose={onClose} onSaved={onSaved} />))
  await click('Draft the breakdown')
}

it('no writes before Create', async () => {
  await openAndDraft()
  expect(draftBreakdown).toHaveBeenCalledWith('p', 'parent', '2026-11-23', '2026-11-27')
  expect(spacePeopleLoad).toHaveBeenCalledWith('s', '2026-11-23', '2026-11-27', ['a', 'b', 'c'])
  await type('Hours for Prepare test cases', '4')
  await choose('Owner of Prepare test cases', 'b')
  await click('Rebalance')
  expect(applyBreakdown).not.toHaveBeenCalled()
})

it('shows the defense totals', async () => {
  await openAndDraft()
  expect(text()).toContain('Mon 23 Nov')
  expect(text()).toContain('Fri 27 Nov')
  expect(count('14 / 16 h')).toBe(3)
  expect(text()).toContain('Can start now')
  expect(text()).toContain('After Define sign-in contract')
  expect(text()).toContain('3 open tasks in this space have no estimate.')
  expect(field<HTMLSelectElement>('Owner of Auth and session handling').value).toBe('a')
  expect(field<HTMLSelectElement>('Owner of End-to-end checks').value).toBe('c')
  expect(button('Create and assign 7 subtasks')).toBeTruthy()
})

it('bottleneck row explains', async () => {
  vi.mocked(spacePeopleLoad).mockResolvedValue(loads(600))
  vi.mocked(spacePeopleHours).mockResolvedValue(hours(720))
  await openAndDraft()
  expect(text()).toContain('Only A is tagged Auth, and has 2 h free.')
  expect(field<HTMLSelectElement>('Owner of Auth and session handling').value).toBe('')
})

it('pinned owner survives Rebalance', async () => {
  await openAndDraft()
  await choose('Owner of Build interface and validation', 'c')
  expect(text()).toContain('You chose C.')
  await click('Rebalance')
  expect(field<HTMLSelectElement>('Owner of Build interface and validation').value).toBe('c')
  expect(text()).toContain('You chose C.')
})

it('edits refresh totals and warnings before Rebalance', async () => {
  await openAndDraft()
  expect(count('Only C is tagged Testing.')).toBe(3)
  // C: 2 h existing + 10 + 4 + 5 = 21 / 16 h.
  await type('Hours for Prepare test cases', '10')
  expect(text()).toContain('21 / 16 h')
  expect(text()).toContain('5 h over available hours.')
  expect(count('C is 5 h over available hours.')).toBe(3)
  expect(text()).not.toContain('Only C is tagged Testing.')
  expect(text()).not.toContain('has the most room')
  expect(text()).toContain('Rebalance to see why each owner fits.')
  // B's design row pinned to C: B 4 + 8 = 12 / 16 h, C 23 / 16 h.
  await choose('Owner of Design login page states', 'c')
  expect(text()).toContain('12 / 16 h')
  expect(text()).toContain('23 / 16 h')
  expect(count('C is 7 h over available hours.')).toBe(4)
  expect(text()).toContain('You chose C.')
  expect(applyBreakdown).not.toHaveBeenCalled()
})

it('warns on a pinned owner with no weekly hours', async () => {
  vi.mocked(spacePeopleHours).mockResolvedValue(hours().map(h => (h.user_id === 'b' ? { ...h, weekly_minutes: null, available_minutes: null, time_off_minutes: null } : h)) as never)
  await openAndDraft()
  expect(text()).toContain('Not set')
  // The allocator leaves B's two UI rows unassigned for that reason.
  expect(count('B has no weekly hours set.')).toBe(2)
  await choose('Owner of Prepare test cases', 'b')
  expect(text()).toContain('You chose B.')
  // The pinned row warns live; the other notes are dropped until Rebalance.
  expect(count('B has no weekly hours set.')).toBe(1)
  expect(field<HTMLSelectElement>('Owner of Prepare test cases').closest('li')!.textContent).toContain('B has no weekly hours set.')
})

it('removing a prerequisite clears links', async () => {
  await openAndDraft()
  await click('Remove Define sign-in contract')
  expect(text()).not.toContain('After Define sign-in contract')
  await click('Create and assign 6 subtasks')
  const rows = vi.mocked(applyBreakdown).mock.calls[0][3]
  expect(rows.map(r => r.key)).toEqual(['design', 'cases', 'auth', 'interface', 'integration', 'e2e'])
  expect(rows.find(r => r.key === 'auth')!.depends_on).toEqual([])
  expect(rows.find(r => r.key === 'interface')!.depends_on).toEqual([])
  expect(rows.find(r => r.key === 'integration')!.depends_on).toEqual(['auth', 'interface'])
  const auth = rows.find(r => r.key === 'auth')!
  expect(auth).toMatchObject({ owner: 'a', shown_load_minutes: 360, starts_on: '2026-11-23', due_on: '2026-11-27', minutes: 360 })
  expect(rows.find(r => r.owner === null)).toBeUndefined()
})

it('stale save keeps edits', async () => {
  vi.mocked(applyBreakdown).mockRejectedValue({ message: "B's work changed since you reviewed it. Review again." })
  await openAndDraft()
  await type('Hours for Prepare test cases', '3.5')
  await click('Create and assign 7 subtasks')
  expect(text()).toContain("B's work changed since you reviewed it. Review again.")
  expect(field<HTMLInputElement>('Hours for Prepare test cases').value).toBe('3.5')
  expect(document.querySelectorAll('[aria-label^="Owner of "]').length).toBe(7)
  expect(onSaved).not.toHaveBeenCalled()

  // Review again reloads the people's numbers without asking the AI again.
  vi.mocked(spacePeopleLoad).mockClear()
  await click('Review again')
  expect(draftBreakdown).toHaveBeenCalledTimes(1)
  expect(breakdownContext).toHaveBeenCalledTimes(2)
  expect(spacePeopleLoad).toHaveBeenCalledTimes(1)
  expect(text()).not.toContain("B's work changed since you reviewed it.")
  expect(field<HTMLInputElement>('Hours for Prepare test cases').value).toBe('3.5')
})

it('button disabled while saving', async () => {
  vi.mocked(applyBreakdown).mockReturnValue(new Promise(() => {}))
  await openAndDraft()
  await click('Create and assign 7 subtasks')
  expect(button('Create and assign 7 subtasks')!.disabled).toBe(true)
  expect(applyBreakdown).toHaveBeenCalledTimes(1)
})

it('shows why a parent is blocked', async () => {
  vi.mocked(breakdownContext).mockResolvedValue(context({ blocked: 'This task is done. Reopen it to break it down.' }) as never)
  await act(async () => root.render(
    <WorkloadPlanDialog parentId="parent" projectId="p" spaceId="s" onClose={onClose} onSaved={onSaved} />))
  expect(text()).toContain('This task is done. Reopen it to break it down.')
  expect(button('Draft the breakdown')).toBeUndefined()
})
