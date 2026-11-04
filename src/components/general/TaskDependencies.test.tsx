// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskDependencies } from './TaskDependencies'
import { addDependency, removeDependency } from '../../lib/api/general'
import { DEFAULT_TASK_RULES } from '../../lib/general/taskRules'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/general', () => ({ addDependency: vi.fn().mockResolvedValue(undefined), removeDependency: vi.fn().mockResolvedValue(undefined) }))

const t = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, project_id: 'p', created_by: 'pm', team_id: 'a', routing_state: 'released', assignee_ids: [], status: 'todo', stage: 0, parent_id: null, archived_at: null, ...over })
const task = t('main', { assignee_ids: ['worker'] })

function stateWith(over: Record<string, unknown> = {}, rules = DEFAULT_TASK_RULES) {
  return {
    project: { id: 'p', class_board_id: null, stages: ['Todo', 'Doing', 'Done'], taskRules: rules },
    viewerId: 'pm', myRole: 'pm', readOnly: false, can: (p: string) => p === 'manage_tasks',
    teams: [{ id: 'a', leader_id: 'lead' }], teamMembers: [{ team_id: 'a', user_id: 'lead' }],
    tasks: [task, t('blocker'), t('other'), t('sub', { parent_id: 'main' }), t('mom')],
    dependencies: [{ task_id: 'main', depends_on_id: 'blocker' }],
    nameOf: (id: string) => id, leadsUser: () => false,
    ...over,
  } as unknown as GeneralProjectState
}

const run = (action: () => Promise<void>) => action()
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(state: GeneralProjectState, current: unknown = task) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<TaskDependencies state={state} task={current as never} busy={false} act={run} />))
}
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.mocked(addDependency).mockClear(); vi.mocked(removeDependency).mockClear() })

const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const searchBox = () => document.querySelector<HTMLInputElement>('[aria-label="Search tasks to wait for"]')
const picks = () => [...document.querySelectorAll<HTMLButtonElement>('[data-pick]')].map(b => b.textContent)

it('lists blockers and says the task cannot be done while one is open', async () => {
  await render(stateWith())
  expect(document.body.textContent).toContain('Task blocker')
  expect(document.body.textContent).toContain("Waiting for 1 task. It can't be marked done until they are.")
})

it('keeps suggested tasks hidden until someone searches', async () => {
  await render(stateWith())
  expect(picks()).toEqual([])
  await act(async () => setValue(searchBox()!, 'oth'))
  expect(picks()).toEqual(['Task other'])
})

it('collapses and reopens the waiting list', async () => {
  await render(stateWith({ dependencies: [] }))
  const toggle = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Waiting for'))!
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.body.textContent).not.toContain('Not waiting for anything.')
  await act(async () => toggle.click())
  expect(document.body.textContent).toContain('Not waiting for anything.')
})

it('shows no waiting note once every blocker is done', async () => {
  await render(stateWith({ tasks: [task, t('blocker', { status: 'done' })] }))
  expect(document.body.textContent).toContain('Task blocker')
  expect(document.body.textContent).not.toContain("can't be marked done")
})

it('adds a dependency from the picker, leaving out itself, its subtasks and linked tasks', async () => {
  await render(stateWith())
  await act(async () => setValue(searchBox()!, 'task'))
  expect(picks()).toEqual(expect.arrayContaining(['Task other', 'Task mom']))
  expect(picks()).not.toContain('Task main')
  expect(picks()).not.toContain('Task sub')
  expect(picks()).not.toContain('Task blocker')
  await act(async () => setValue(searchBox()!, 'oth'))
  expect(picks()).toEqual(['Task other'])
  await act(async () => document.querySelector<HTMLButtonElement>('[data-pick]')!.click())
  expect(addDependency).toHaveBeenCalledWith('main', 'other')
})

it('leaves the parent of a subtask out of the picker', async () => {
  const sub = t('sub', { parent_id: 'mom', assignee_ids: ['worker'] })
  await render(stateWith({ tasks: [sub, t('mom'), t('other')], dependencies: [] }), sub)
  await act(async () => setValue(searchBox()!, 'task'))
  expect(picks()).toContain('Task other')
  expect(picks()).not.toContain('Task mom')
})

it('leaves out a task that already waits for this one', async () => {
  await render(stateWith({ dependencies: [{ task_id: 'other', depends_on_id: 'main' }] }))
  await act(async () => setValue(searchBox()!, 'task'))
  expect(picks()).not.toContain('Task other')
  expect(picks()).toContain('Task mom')
})

it('tells the viewer to narrow a picker with more than eight matches', async () => {
  await render(stateWith({
    tasks: [task, ...Array.from({ length: 9 }, (_, i) => t(`choice-${i}`))],
    dependencies: [],
  }))
  await act(async () => setValue(searchBox()!, 'choice'))
  expect(picks()).toHaveLength(8)
  expect(document.body.textContent).toContain('Type to narrow')
})

it('removes a dependency', async () => {
  await render(stateWith())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Stop waiting for Task blocker"]')!.click())
  expect(removeDependency).toHaveBeenCalledWith('main', 'blocker')
})

it('hides the add and remove controls for a viewer without edit rights', async () => {
  await render(stateWith({ viewerId: 'viewer', myRole: 'member', can: () => false }))
  expect(document.body.textContent).toContain('Task blocker')
  expect(searchBox()).toBeNull()
  expect(document.querySelector('[aria-label="Stop waiting for Task blocker"]')).toBeNull()
})

it('lets the receiving team lead link an unassigned released task', async () => {
  const loose = t('loose')
  await render(stateWith({
    viewerId: 'lead', myRole: 'member', can: () => false,
    tasks: [loose, t('other')], dependencies: [],
  }), loose)
  expect(searchBox()).not.toBeNull()
})

it('hides link controls after the receiving team is archived', async () => {
  const loose = t('loose')
  await render(stateWith({
    viewerId: 'lead', myRole: 'member', can: () => false,
    teams: [{ id: 'a', leader_id: 'lead', archived_at: '2026-11-01' }],
    tasks: [loose, t('other')], dependencies: [],
  }), loose)
  expect(searchBox()).toBeNull()
})

it('hides the add control when dependencies are off, but still lists links', async () => {
  await render(stateWith({}, { ...DEFAULT_TASK_RULES, allowDependencies: false }))
  expect(searchBox()).toBeNull()
  expect(document.body.textContent).toContain('Task blocker')
})

it('asks to reopen a done task instead of offering the add control', async () => {
  await render(stateWith(), { ...task, status: 'done' })
  expect(searchBox()).toBeNull()
  expect(document.body.textContent).toContain('Reopen the task before making it wait.')
})
