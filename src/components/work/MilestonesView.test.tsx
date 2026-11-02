// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MilestonesView } from './MilestonesView'
import { StatusPill } from './MilestoneBits'
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
  // Automatic: the database stamps it; finished work without the stamp is ready too.
  await render(sourceOf({ completion: 'automatic', items: [item('t1', 'a', 'done')] }))
  expect(card('Alpha').textContent).toContain('Ready to mark reached')
  await render(sourceOf({
    completion: 'automatic',
    milestones: [gamma, beta, { ...alpha, reached_at: '2026-10-05T00:00:00Z', reached_auto: true }],
    items: [item('t1', 'a', 'done')],
  }))
  expect(card('Alpha').textContent).not.toContain('Ready to mark reached')
  expect(card('Alpha').textContent).toContain('Reached automatically')
})

it('shows Waiting, not Ready, while a finished milestone waits for another, in both modes', async () => {
  for (const completion of ['automatic', 'manual'] as const) {
    await render(sourceOf({ completion, items: [item('t1', 'b', 'done')] }))
    const pill = [...card('Beta').querySelectorAll('span')].find((s) => s.textContent === 'Waiting')
    expect(pill).toBeDefined()
    expect(card('Beta').textContent).not.toContain('Ready to mark reached')
  }
})

it('hides Mark reached while the milestone waits for one that is not reached', async () => {
  await render(sourceOf({ completion: 'manual', items: [item('t1', 'b', 'done'), item('t2', 'a', 'done')] }))
  // The card's own button: Alpha is ready, Beta waits for it.
  const buttonIn = (name: string) => [...card(name).querySelectorAll('button')].some((b) => b.textContent?.includes('Mark reached'))
  expect(buttonIn('Alpha')).toBe(true)
  expect(buttonIn('Beta')).toBe(false)
  // The card menu.
  const menuOf = async (name: string) => {
    await act(async () => card(name).querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click())
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    return items
  }
  expect(await menuOf('Alpha')).toContain('Mark reached')
  expect(await menuOf('Beta')).not.toContain('Mark reached')
})

it('offers only reached milestones to wait for once a milestone is reached', async () => {
  const reachedGamma = { ...gamma, reached_at: '2026-10-05T00:00:00Z' }
  const reachedBeta = { ...beta, reached_at: '2026-10-04T00:00:00Z' }
  await render(sourceOf({ milestones: [reachedGamma, reachedBeta, alpha], dependencies: [] }))
  expect([...picker('Gamma')!.options].map((o) => o.textContent)).toEqual(['Add a milestone to wait for', 'Beta'])
  // An open milestone may still wait for any of them.
  expect([...picker('Alpha')!.options].map((o) => o.textContent)).toEqual(['Add a milestone to wait for', 'Beta', 'Gamma'])
})

it('labels the link chips Depends on, and keeps one Waiting for line', async () => {
  await render(sourceOf())
  expect(card('Beta').textContent).toContain('Depends on:')
  expect(card('Beta').textContent).not.toContain('Waiting for:')
  expect(card('Beta').textContent?.match(/Waiting for/g)).toHaveLength(1)
})

it('gives ready its own tone, apart from at risk', async () => {
  await act(async () => root.render(<><StatusPill status="ready" /><StatusPill status="at_risk" /><StatusPill status="waiting" /></>))
  const [ready, atRisk, waiting] = [...host.querySelectorAll('span')]
  expect(ready.className).not.toBe(atRisk.className)
  expect(ready.className).not.toMatch(/warning/)
  expect(waiting.className).toMatch(/pending-soft/)
  expect(waiting.textContent).toBe('Waiting')
})
