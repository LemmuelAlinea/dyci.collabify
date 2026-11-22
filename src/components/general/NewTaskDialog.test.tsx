// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewTaskDialog } from './TasksTab'
import type { GeneralProjectState } from './useGeneralProject'
import { createMemberTask, createOpenTask, createTask } from '../../lib/api/general'
import { DEFAULT_TASK_RULES } from '../../lib/general/taskRules'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../lib/api/general', () => ({
  createTask: vi.fn(async () => 'new-task'),
  createMemberTask: vi.fn(async () => 'member-task'),
  createOpenTask: vi.fn(async () => 'open-task'),
  updateTask: vi.fn(async () => {}),
}))
vi.mock('../../lib/api/workAi', () => ({ suggestEstimateFromText: vi.fn() }))
const holderHours = vi.hoisted(() => ({ labels: new Map<string, { text: string; tone: string }>(), calls: [] as unknown[] }))
vi.mock('../../lib/work/useHolderHours', () => ({
  useHolderHours: (opts: unknown) => { holderHours.calls.push(opts); return holderHours.labels },
}))

const reload = vi.fn(async () => {})
const onCreated = vi.fn()
const ROLES: Record<string, string> = { me: 'member', b: 'member', c: 'coordinator', q: 'qa', s: 'stakeholder' }

function makeState(role: string, project: Record<string, unknown> = {}) {
  return {
    project: {
      id: 'p1', class_board_id: null, taskFlow: 'open',
      taskRules: { ...DEFAULT_TASK_RULES, defaultPriority: 'high', allowMultipleAssignees: true },
      memberRules: { manageMilestones: false, createTasks: true },
      ...project,
    },
    myRole: role,
    viewerId: 'me',
    readOnly: false,
    teams: [],
    members: Object.keys(ROLES).map((id) => ({ user_id: id, profile: { status: 'active' } })),
    roleOf: (id: string) => ROLES[id] ?? null,
    nameOf: (id: string) => `Person ${id}`,
    can: () => true,
    reload,
  } as unknown as GeneralProjectState
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

const open = (state: GeneralProjectState) =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <NewTaskDialog open onClose={() => {}} state={state} sprintId={null} onCreated={onCreated} />
      </MemoryRouter>,
    ),
  )
const label = (text: string) =>
  [...document.body.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(text))
const control = (text: string) => {
  const l = label(text)
  return l ? (document.getElementById(l.htmlFor) as HTMLInputElement | HTMLSelectElement | null) : null
}
const holderBoxes = () => [...document.body.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

it('lets a Member in an open project add a live task with holders and a priority', async () => {
  await open(makeState('member'))
  expect(document.body.textContent).not.toContain('goes to the project manager')
  expect((control('Priority') as HTMLSelectElement).value).toBe('high')
  expect(control('Type')).not.toBeNull()
  const people = holderBoxes().map((b) => b.closest('label')?.textContent?.trim())
  expect(people).toEqual(['Person me', 'Person b', 'Person c'])
  await act(async () => type(control('Title')!, 'Fix login'))
  await act(async () => type(control('Priority')!, 'urgent'))
  await act(async () => holderBoxes()[1].click())
  await act(async () => button('Add task')!.click())
  expect(createOpenTask).toHaveBeenCalledWith({
    projectId: 'p1', title: 'Fix login', description: '', startsAt: null, dueAt: null, teamId: null,
    priority: 'urgent', kind: 'task', taskType: null, holderIds: ['b'], estimateMinutes: null,
  })
  expect(createTask).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('Task added')
  expect(onCreated).toHaveBeenCalledWith('open-task')
})

it('saves an estimate with an open task', async () => {
  await open(makeState('member'))
  await act(async () => type(control('Title')!, 'Fix login'))
  await act(async () => type(control('Estimated effort (hours)')!, '1.5'))
  await act(async () => button('Add task')!.click())
  expect(createOpenTask).toHaveBeenCalledWith(expect.objectContaining({ estimateMinutes: 90 }))
})

it('suggests an estimate from the title before the task exists', async () => {
  const { suggestEstimateFromText } = await import('../../lib/api/workAi')
  vi.mocked(suggestEstimateFromText).mockResolvedValueOnce({ result: 'ok', minutes: 120, reason: 'A small form change.' })
  await open(makeState('member'))
  await act(async () => type(control('Title')!, 'Fix login'))
  await act(async () => button('Suggest estimate')!.click())
  expect(suggestEstimateFromText).toHaveBeenCalledWith('p1', 'Fix login', '')
  expect((control('Estimated effort (hours)') as HTMLInputElement).value).toBe('2')
  expect(document.body.textContent).toContain('A small form change.')
})

it('refuses an estimate that is not hours', async () => {
  await open(makeState('member'))
  await act(async () => type(control('Title')!, 'Fix login'))
  await act(async () => type(control('Estimated effort (hours)')!, '1001'))
  await act(async () => button('Add task')!.click())
  expect(createOpenTask).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Enter the estimate in hours, up to 1000.')
})

it('shows the no-room refusal as the error', async () => {
  vi.mocked(createOpenTask).mockRejectedValueOnce(new Error('Ben has no room this week. Pick someone else or ask a project manager.'))
  await open(makeState('member'))
  await act(async () => type(control('Title')!, 'Fix login'))
  await act(async () => button('Add task')!.click())
  expect(document.body.textContent).toContain('Ben has no room this week. Pick someone else or ask a project manager.')
})

it('shows a planner hours beside each holder', async () => {
  holderHours.labels = new Map([['b', { text: '14 / 16 h this week', tone: 'warning' }]]); holderHours.calls = []
  try {
    await open(makeState('pm', { space_id: 's' }))
    const people = holderBoxes().map((b) => b.closest('label')?.textContent?.trim())
    expect(people).toContain('Person b · 14 / 16 h this week')
    expect(holderHours.calls.at(-1)).toMatchObject({ spaceId: 's', taskId: null, viewer: 'planner' })
  } finally { holderHours.labels = new Map() }
})

it('offers the project manager\'s custom types without changing QA kind', async () => {
  await open(makeState('member', { taskTypes: ['Research'] }))
  await act(async () => type(control('Title')!, 'Survey'))
  await act(async () => type(control('Type')!, 'Research'))
  await act(async () => button('Add task')!.click())
  expect(createOpenTask).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', taskType: 'Research' }))
})

it('offers one holder when the project allows only one', async () => {
  await open(makeState('member', { taskRules: { ...DEFAULT_TASK_RULES, allowMultipleAssignees: false } }))
  expect(holderBoxes()).toHaveLength(0)
  const holder = control('Holder') as HTMLSelectElement
  expect([...holder.options].map((o) => o.textContent)).toEqual(['Nobody yet', 'Person me', 'Person b', 'Person c'])
  await act(async () => type(control('Title')!, 'One'))
  await act(async () => type(holder, 'c'))
  await act(async () => button('Add task')!.click())
  expect(vi.mocked(createOpenTask).mock.calls[0][0].holderIds).toEqual(['c'])
})

it('gives QA a bug with a priority and no holder in an open project', async () => {
  await open(makeState('qa'))
  expect(control('Holder')).toBeNull()
  expect(holderBoxes()).toHaveLength(0)
  expect((control('Type') as HTMLSelectElement).disabled).toBe(true)
  await act(async () => type(control('Title')!, 'Crash'))
  await act(async () => button('Add task')!.click())
  expect(vi.mocked(createOpenTask).mock.calls[0][0]).toMatchObject({ kind: 'bug', holderIds: [], priority: 'high' })
})

it('gives the project manager a priority but no holder in a planned project', async () => {
  await open(makeState('pm', { taskFlow: 'planned' }))
  expect(control('Priority')).not.toBeNull()
  expect(control('Holder')).toBeNull()
  expect(holderBoxes()).toHaveLength(0)
  await act(async () => type(control('Title')!, 'Plan it'))
  await act(async () => type(control('Priority')!, 'low'))
  await act(async () => button('Add task')!.click())
  expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Plan it', priority: 'low' }))
  expect(createOpenTask).not.toHaveBeenCalled()
})

it('keeps a Member in a planned project on the review path, with no priority or holder', async () => {
  await open(makeState('member', { taskFlow: 'planned' }))
  expect(control('Priority')).toBeNull()
  expect(holderBoxes()).toHaveLength(0)
  expect(document.body.textContent).toContain('goes to the project manager and coordinators for review')
  await act(async () => type(control('Title')!, 'Idea'))
  await act(async () => button('Add task')!.click())
  expect(createMemberTask).toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('Sent to planners for review')
})

it('lets a Member add tasks in an open project without the create-tasks switch', async () => {
  await open(makeState('member', { memberRules: { manageMilestones: false, createTasks: false } }))
  await act(async () => type(control('Title')!, 'Allowed'))
  await act(async () => button('Add task')!.click())
  expect(createOpenTask).toHaveBeenCalled()
})

it('gives QA no priority in a planned project', async () => {
  await open(makeState('qa', { taskFlow: 'planned' }))
  expect(control('Priority')).toBeNull()
  await act(async () => type(control('Title')!, 'Bug'))
  await act(async () => button('Add task')!.click())
  expect(vi.mocked(createTask).mock.calls[0][0]).not.toHaveProperty('priority')
})
