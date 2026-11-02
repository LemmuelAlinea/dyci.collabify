// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MilestonesView } from './MilestonesView'
import type { Milestone, MilestoneSource, WorkItem } from '../../lib/work/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const show = vi.fn()
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show }) }))

const ms = (over: Partial<Milestone>): Milestone => ({
  id: 'm', name: 'Milestone', description: '', due_on: '2099-01-01', reached_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})
const item = (id: string, milestone: string, status: WorkItem['status']): WorkItem => ({
  id, title: `Task ${id}`, status, due_at: null, done_at: null, sprint_id: null, milestone_id: milestone, rank: 1,
  holders: [], holderIds: [], teamId: null, kind: 'task', created_at: '2026-10-01T00:00:00Z',
})

const alpha = ms({ id: 'a', name: 'Alpha', due_on: '2099-01-01' })
const beta = ms({ id: 'b', name: 'Beta', due_on: '2099-02-01' })
const gamma = ms({ id: 'c', name: 'Gamma', due_on: null, created_at: '2026-10-02T00:00:00Z' })

const addDependency = vi.fn(async () => {})
const removeDependency = vi.fn(async () => {})
const setReached = vi.fn(async () => {})

function sourceOf(over: Partial<MilestoneSource> = {}): MilestoneSource {
  return {
    milestones: [gamma, beta, alpha],
    items: [],
    groups: [],
    canManage: true,
    canTag: true,
    sprints: [],
    canMarkReached: true,
    readOnlyReason: '',
    openTask: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    setReached,
    tag: vi.fn(),
    linkSprint: vi.fn(),
    dependencies: [{ milestone_id: 'b', depends_on_id: 'a' }],
    canLink: true,
    allowLinks: true,
    addDependency,
    removeDependency,
    ...over,
  } as unknown as MilestoneSource
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const render = (source: MilestoneSource) => act(async () => root.render(<MilestonesView source={source} />))
const card = (name: string) =>
  [...host.querySelectorAll<HTMLElement>('li[id^="milestone-"]')].find((li) => li.querySelector('h4')?.textContent === name)!
const picker = (name: string) => card(name).querySelector<HTMLSelectElement>('select[aria-label="Wait for another milestone"]')
const choose = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('lists undated milestones last and says they have no due date', async () => {
  await render(sourceOf())
  const names = [...host.querySelectorAll('li[id^="milestone-"] h4')].map((h) => h.textContent)
  expect(names).toEqual(['Alpha', 'Beta', 'Gamma'])
  expect(card('Gamma').textContent).toContain('No due date')
  // Never late or at risk, however long it has been.
  expect(card('Gamma').textContent).toContain('Upcoming')
})

it('names the milestone a card waits for', async () => {
  await render(sourceOf())
  expect(card('Beta').textContent).toContain('Waiting for Alpha')
  expect(card('Alpha').textContent).not.toMatch(/Waiting for (Beta|Gamma)/)
})

it('offers the Waiting for control to a manager and adds the link they pick', async () => {
  await render(sourceOf())
  const select = picker('Gamma')!
  // Neither itself nor a milestone that already waits for it can be picked.
  expect([...select.options].map((o) => o.textContent)).toEqual(['Add a milestone to wait for', 'Alpha', 'Beta'])
  await choose(select, 'a')
  expect(addDependency).toHaveBeenCalledWith('c', 'a')
})

it('does not offer a milestone that would loop back', async () => {
  await render(sourceOf())
  // Beta waits for Alpha, so Alpha may not wait for Beta.
  expect([...picker('Alpha')!.options].map((o) => o.textContent)).toEqual(['Add a milestone to wait for', 'Gamma'])
})

it('removes a link from the card', async () => {
  await render(sourceOf())
  const stop = card('Beta').querySelector<HTMLButtonElement>('button[aria-label="Stop waiting for Alpha"]')!
  await act(async () => stop.click())
  expect(removeDependency).toHaveBeenCalledWith('b', 'a')
})

it('shows the database message when a link is refused', async () => {
  addDependency.mockRejectedValueOnce(new Error('That would make the milestones wait for each other.'))
  await render(sourceOf())
  await choose(picker('Gamma')!, 'a')
  expect(show).toHaveBeenCalledWith('That would make the milestones wait for each other.', 'error')
})

it('hides the picker when dependencies are off, but keeps removing existing links', async () => {
  await render(sourceOf({ allowLinks: false }))
  expect(picker('Gamma')).toBeNull()
  expect(card('Beta').querySelector('button[aria-label="Stop waiting for Alpha"]')).not.toBeNull()
})

it('shows the links but no controls to somebody who cannot manage them', async () => {
  await render(sourceOf({ canLink: false }))
  expect(card('Beta').textContent).toContain('Waiting for Alpha')
  expect(picker('Gamma')).toBeNull()
  expect(card('Beta').querySelector('button[aria-label="Stop waiting for Alpha"]')).toBeNull()
})

it('shows Ready to mark reached in manual mode once every tagged task is done', async () => {
  await render(sourceOf({ completion: 'manual', items: [item('t1', 'a', 'done')] }))
  expect(card('Alpha').textContent).toContain('Ready to mark reached')
  await render(sourceOf({ completion: 'automatic', items: [item('t1', 'a', 'done')] }))
  expect(card('Alpha').textContent).not.toContain('Ready to mark reached')
  expect(card('Alpha').textContent).toContain('Reached')
})
