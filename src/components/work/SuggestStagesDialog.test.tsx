// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SuggestStagesDialog } from './SuggestStagesDialog'
import { applyStagePlan, stagePlanContext } from '../../lib/api/workload'
import { draftStagePlan } from '../../lib/api/workAi'
import type { StageContext, StageDraft } from '../../../supabase/functions/_shared/stagePlan.ts'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({ stagePlanContext: vi.fn(), applyStagePlan: vi.fn() }))
vi.mock('../../lib/api/workAi', () => ({ draftStagePlan: vi.fn() }))

const terms = { singular: 'Phase', plural: 'Phases' }

const slot = (i: number, over: Partial<StageContext['stages'][number]> = {}) => ({
  key: `s${i + 1}`,
  id: i === 0 ? 'old' : null,
  starts_on: ['2026-11-30', '2026-12-14', '2026-12-28'][i],
  ends_on: ['2026-12-13', '2026-12-27', '2027-01-10'][i],
  capacity_minutes: i === 2 ? 6000 : 12000,
  milestone_id: null,
  milestone_lost: null,
  buffer: i === 2,
  ...over,
})

const task = (n: number, minutes: number | null) => ({
  id: `id${n}`, key: `t${n}`, title: `Task ${n}`, description: '', minutes, priority: 'normal' as const, rank: n,
  due_on: null, milestone_id: null, depends_on: [], sprint_id: null, dated: false, subtasks: 0,
})

const context = (over: Partial<StageContext> = {}): StageContext => ({
  blocked: null,
  project: {
    id: 'p', name: 'Collabify', description: '', starts_on: '2026-11-15', ends_on: '2027-01-10',
    organization: 'sequential', term_singular: 'Phase', term_plural: 'Phases',
  },
  length_days: 14,
  suggested_length_days: 14,
  window: { from: '2026-11-30', to: '2027-01-10' },
  running: [],
  stages: [slot(0), slot(1), slot(2)],
  tasks: [task(1, 3720), task(2, 9000), task(3, null), task(4, 3600)],
  milestones: [],
  total_minutes: 16320,
  unestimated: 3,
  planning_count: 4,
  left_out: 0,
  outside_count: 0,
  shown: 'abc',
  ...over,
})

const draft = (over: Partial<StageDraft> = {}): StageDraft => ({
  context: context(),
  names: [
    { name: 'Sign-in and setup', goal: 'People can sign in.' },
    { name: 'Task board', goal: 'The board works.' },
    { name: 'Testing and fixes', goal: '' },
  ],
  placement: [
    { task_id: 'id1', stage: 0, flag: null },
    { task_id: 'id2', stage: 1, flag: null },
    { task_id: 'id3', stage: 0, flag: null },
    { task_id: 'id4', stage: null, flag: 'wont_fit' },
  ],
  note: null,
  ...over,
})

let container: HTMLDivElement
let root: Root
const onApplied = vi.fn()
const onClose = vi.fn()

beforeEach(() => {
  vi.mocked(stagePlanContext).mockReset().mockResolvedValue(context())
  vi.mocked(draftStagePlan).mockReset().mockResolvedValue({ result: 'ok', ...draft() })
  vi.mocked(applyStagePlan).mockReset().mockResolvedValue({ created: 2, updated: 1, deleted: 0, moved: 4 })
  onApplied.mockReset()
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
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)
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
const choose = async (label: string, value: string) => {
  const el = field<HTMLSelectElement>(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const type = async (label: string, value: string) => {
  const el = field<HTMLInputElement>(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function open(organization: 'sequential' | 'streams' = 'sequential') {
  await act(async () => root.render(
    <SuggestStagesDialog
      open
      onClose={onClose}
      projectId="p"
      terms={terms}
      teams={[{ id: 'team1', name: 'Frontend' }]}
      organization={organization}
      onApplied={onApplied}
    />))
}

async function review() {
  await open()
  await click('Suggest phases')
}

it('shows the numbers before suggesting', async () => {
  await open()
  expect(stagePlanContext).toHaveBeenCalledWith('p', null, null)
  expect(text()).toContain('272 h of work · 100 h a week · ends 10 Jan')
  expect(text()).toContain('3 tasks have no estimate')
  expect(text()).toContain('4 tasks are still in planning. Send them from Plan & route to include them.')
  expect(draftStagePlan).not.toHaveBeenCalled()
})

it('streams asks for a team first', async () => {
  await open('streams')
  expect(stagePlanContext).not.toHaveBeenCalled()
  expect(button('Suggest phases')?.disabled).toBe(true)
  await choose('Team', 'team1')
  expect(stagePlanContext).toHaveBeenCalledWith('p', 'team1', null)
  expect(button('Suggest phases')?.disabled).toBe(false)
})

it('changing the length reloads', async () => {
  await open()
  await choose('Length', '21')
  expect(stagePlanContext).toHaveBeenLastCalledWith('p', null, 21)
  await click('Suggest phases')
  expect(draftStagePlan).toHaveBeenCalledWith('p', null, 21)
})

it('review shows phases, hours and flags', async () => {
  await review()
  expect(text()).toContain('Suggested: 3 phases of 2 weeks')
  expect(text()).toContain('62 / 200 h')
  expect(text()).toContain('(buffer)')
  expect(field<HTMLInputElement>('Phase 3 name').value).toBe('Testing and fixes')
  expect(text()).toContain("Won't fit before the project ends")
  expect(text()).toContain("60 h won't fit before 10 Jan. This task stays in the backlog.")
})

it('moving a task updates the totals and the over tone', async () => {
  await review()
  expect(document.querySelectorAll('[data-over]')).toHaveLength(0)
  await choose('Phase for Task 4', '1')
  expect(text()).toContain('210 / 200 h')
  expect(document.querySelectorAll('[data-over]')).toHaveLength(1)
})

it('apply sends the plan and the fingerprint', async () => {
  await review()
  await type('Phase 1 name', 'Setup')
  await click('Apply')
  expect(applyStagePlan).toHaveBeenCalledWith('p', null, [
    { id: 'old', name: 'Setup', goal: 'People can sign in.', starts_on: '2026-11-30', ends_on: '2026-12-13' },
    { id: null, name: 'Task board', goal: 'The board works.', starts_on: '2026-12-14', ends_on: '2026-12-27' },
    { id: null, name: 'Testing and fixes', goal: '', starts_on: '2026-12-28', ends_on: '2027-01-10' },
  ], [
    { id: 'id1', stage: 0 },
    { id: 'id2', stage: 1 },
    { id: 'id3', stage: 0 },
    { id: 'id4', stage: null },
  ], 'abc')
  expect(onApplied).toHaveBeenCalledWith('Phases updated')
})

it('a stale refusal stays in view', async () => {
  vi.mocked(applyStagePlan).mockRejectedValue(
    new Error('Something changed while you were reviewing. Suggest again to see the latest.'))
  await review()
  await click('Apply')
  expect(text()).toContain('Something changed while you were reviewing. Suggest again to see the latest.')
  expect(onApplied).not.toHaveBeenCalled()
  expect(button('Apply')).toBeDefined()
})

it('a running stage and a lost milestone link are named', async () => {
  const ctx = context({
    running: [{ id: 'r', name: 'Phase 1', ends_on: '2026-11-27', task_count: 8 }],
    stages: [slot(0, { milestone_lost: 'Beta' }), slot(1), slot(2)],
  })
  vi.mocked(draftStagePlan).mockResolvedValue({ result: 'ok', ...draft({ context: ctx }) })
  await review()
  expect(text()).toContain('Phase 1 is running and keeps its 8 tasks')
  expect(text()).toContain('Sign-in and setup no longer counts toward Beta')
})

it('tasks a dropped phase would send back are named', async () => {
  vi.mocked(draftStagePlan).mockResolvedValue({ result: 'ok', ...draft({ context: context({ outside_count: 2 }) }) })
  await review()
  expect(text()).toContain(
    "2 tasks in planned phases aren't part of this plan (done, waiting for review or past the 200 limit). A phase this plan drops sends them to the backlog.")
})

it("copy uses the project's stage word", async () => {
  const ctx = context({ window: { from: '2026-11-30', to: null } })
  vi.mocked(draftStagePlan).mockResolvedValue({
    result: 'ok',
    ...draft({
      context: ctx,
      placement: [
        { task_id: 'id1', stage: 0, flag: 'over_hours' },
        { task_id: 'id2', stage: 1, flag: null },
        { task_id: 'id3', stage: 0, flag: null },
        { task_id: 'id4', stage: null, flag: 'wont_fit' },
      ],
    }),
  })
  await review()
  expect(text()).toContain("Over this phase's hours")
  expect(text()).toContain("Won't fit in these phases")
  expect(text()).toContain("60 h won't fit in these phases.")
  expect(text()).not.toMatch(/stage/i)
})

it('a failed draft shows its message', async () => {
  vi.mocked(draftStagePlan).mockResolvedValue({ result: 'failed', message: 'That is 12 in an hour. Try again later.' })
  await review()
  expect(text()).toContain('That is 12 in an hour. Try again later.')
})

it('blocked shows and disables', async () => {
  vi.mocked(stagePlanContext).mockResolvedValue(context({ blocked: 'The project ends before another stage could start.' }))
  await open()
  expect(text()).toContain('The project ends before another stage could start.')
  expect(button('Suggest phases')?.disabled).toBe(true)
})
