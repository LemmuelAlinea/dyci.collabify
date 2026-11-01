// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskSubtasks } from './TaskSubtasks'
import { createSubtask } from '../../lib/api/general'
import { DEFAULT_TASK_RULES } from '../../lib/general/taskRules'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/general', () => ({ createSubtask: vi.fn().mockResolvedValue('new') }))

const parent = { id: 'parent', title: 'Build page', project_id: 'p', created_by: 'pm', team_id: 'a', routing_state: 'released', assignee_ids: ['worker'], status: 'todo', stage: 0, parent_id: null }
const child = (id: string, status: string, assignee_ids: string[] = []) => ({ id, title: `Child ${id}`, project_id: 'p', created_by: 'pm', team_id: 'a', routing_state: 'released', assignee_ids, status, stage: 0, parent_id: 'parent' })

function stateWith(over: Record<string, unknown> = {}, rules = DEFAULT_TASK_RULES) {
  return {
    project: { id: 'p', class_board_id: null, stages: ['Todo', 'Doing', 'Done'], taskRules: rules },
    viewerId: 'pm', myRole: 'pm', readOnly: false,
    teams: [{ id: 'a', leader_id: 'lead' }], teamMembers: [{ team_id: 'a', user_id: 'lead' }],
    tasks: [parent, child('c1', 'done', ['worker']), child('c2', 'todo')],
    nameOf: (id: string) => `Name ${id}`,
    ...over,
  } as unknown as GeneralProjectState
}

const run = (action: () => Promise<void>) => action()
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(state: GeneralProjectState, task: unknown = parent, onOpenTask = vi.fn()) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<TaskSubtasks state={state} task={task as never} busy={false} act={run} onOpenTask={onOpenTask} />))
  return onOpenTask
}
async function unmount() { await act(async () => root.unmount()); container.remove() }
afterEach(async () => { await unmount(); vi.mocked(createSubtask).mockClear() })

const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)
const addBox = () => document.querySelector<HTMLInputElement>('[aria-label="Add a subtask"]')

it('lists the subtasks with progress, status and holder, and opens one', async () => {
  const onOpenTask = await render(stateWith())
  expect(document.body.textContent).toContain('1/2 done')
  expect(document.body.textContent).toContain('Name worker')
  await act(async () => button('Child c2')!.click())
  expect(onOpenTask).toHaveBeenCalledWith('c2')
})

it('adds a subtask under the parent', async () => {
  await render(stateWith())
  await act(async () => setValue(addBox()!, 'Login form'))
  await act(async () => button('Add')!.click())
  expect(createSubtask).toHaveBeenCalledWith('parent', 'Login form')
})

it('shows a subtask the parent link and no subtasks section', async () => {
  const onOpenTask = await render(stateWith(), child('c2', 'todo'))
  expect(document.body.textContent).toContain('Part of Build page')
  expect(document.body.textContent).toContain('Moves with its parent task.')
  expect(addBox()).toBeNull()
  await act(async () => button('Build page')!.click())
  expect(onOpenTask).toHaveBeenCalledWith('parent')
})

it('hides the add control when subtasks are off, or the viewer cannot add one', async () => {
  await render(stateWith({}, { ...DEFAULT_TASK_RULES, allowSubtasks: false }))
  expect(addBox()).toBeNull()
  expect(document.body.textContent).toContain('Child c2')
  await unmount()
  await render(stateWith({ viewerId: 'other', myRole: 'member' }))
  expect(addBox()).toBeNull()
  await unmount()
  await render(stateWith({ viewerId: 'qa', myRole: 'qa' }))
  expect(addBox()).toBeNull()
  await unmount()
  await render(stateWith({ viewerId: 'pm', readOnly: true }))
  expect(addBox()).toBeNull()
})

it('offers the add control to a holder or the team lead of a released parent only', async () => {
  await render(stateWith({ viewerId: 'worker', myRole: 'member' }))
  expect(addBox()).not.toBeNull()
  await unmount()
  await render(stateWith({ viewerId: 'lead', myRole: 'member' }))
  expect(addBox()).not.toBeNull()
  await unmount()
  await render(stateWith({ viewerId: 'worker', myRole: 'member' }), { ...parent, routing_state: 'planning' })
  expect(addBox()).toBeNull()
})

it('asks to reopen a done parent instead of offering the add control', async () => {
  await render(stateWith(), { ...parent, status: 'done' })
  expect(addBox()).toBeNull()
  expect(document.body.textContent).toContain('Reopen the task before adding a subtask.')
})
