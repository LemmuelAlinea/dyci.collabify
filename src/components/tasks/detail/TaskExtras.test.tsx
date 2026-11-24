// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskExtras } from './TaskExtras'
import { updateClassTaskFields, addClassSubtask, setClassTaskDependency } from '../../../lib/api/tasks'
import type { TaskDetail } from '../../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../../lib/api/projects', () => ({
  getClassTaskSettings: vi.fn(async () => ({
    task_types: ['Research'], allow_subtasks: true, allow_dependencies: true,
    task_type_set: [
      { slot: 'default', name: 'Research Task', description: 'General research', color: '#2563eb', icon: 'search' },
      { slot: null, name: 'Research', description: 'Studies', color: '#9333ea', icon: 'book-open' },
    ],
  })),
}))
vi.mock('../../../lib/api/tasks', () => ({
  listClassTaskRelations: vi.fn(async () => ({
    tasks: [{ id: 't1', title: 'Parent', status: 'todo', parent_id: null, position: 1 },
      { id: 't2', title: 'Other', status: 'todo', parent_id: null, position: 2 }],
    dependencies: [],
  })),
  updateClassTaskFields: vi.fn(async () => {}),
  addClassSubtask: vi.fn(async () => {}),
  setClassTaskDependency: vi.fn(async () => {}),
}))

const task = {
  id: 't1', board_id: 'b1', project_id: 'p1', title: 'Parent', task_type: 'Task',
  priority: 'normal', parent_id: null, status: 'todo', due_at: null, starts_at: null,
} as unknown as TaskDetail
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
  vi.clearAllMocks()
})

const setInput = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const setSelect = (select: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!

it('edits task fields and adds a subtask and dependency', async () => {
  await act(async () => root.render(<TaskExtras task={task} role="student" viewerId="u1" locked={false}
    onOpenTask={vi.fn()} onChanged={vi.fn()} />))
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Type: Research Task"]')!.click())
  const names = [...host.querySelectorAll('[role="option"] [data-type-name]')].map((n) => n.textContent)
  expect(names).toEqual(['Research Task', 'Research'])
  expect(host.textContent).toContain('Studies')
  await act(async () => [...host.querySelectorAll<HTMLElement>('[role="option"]')][1].click())
  await setSelect(host.querySelectorAll('select')[0], 'high')
  await setInput(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '2026-12-01T12:00')
  await act(async () => button('Save details').click())
  expect(updateClassTaskFields).toHaveBeenCalledWith('t1', {
    due_at: new Date('2026-12-01T12:00').toISOString(), task_type: 'Research', priority: 'high',
  })
  await setInput(host.querySelector<HTMLInputElement>('[aria-label="New subtask"]')!, 'Write draft')
  await act(async () => host.querySelector<HTMLElement>('section:nth-of-type(2) button')!.click())
  expect(addClassSubtask).toHaveBeenCalledWith(task, 'Write draft', 'u1', 'student')
  await setSelect(host.querySelector<HTMLSelectElement>('[aria-label="Add dependency"]')!, 't2')
  await act(async () => host.querySelector<HTMLElement>('section:nth-of-type(3) button')!.click())
  expect(setClassTaskDependency).toHaveBeenCalledWith('t1', 't2', true)
})

it('keeps a removed type as the current choice', async () => {
  await act(async () => root.render(<TaskExtras task={{ ...task, task_type: 'Old' } as unknown as TaskDetail} role="student" viewerId="u1" locked={false}
    onOpenTask={vi.fn()} onChanged={vi.fn()} />))
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Type: Old"]')!.click())
  expect([...host.querySelectorAll('[role="option"] [data-type-name]')].map((n) => n.textContent)).toEqual(['Research Task', 'Research', 'Old'])
})
