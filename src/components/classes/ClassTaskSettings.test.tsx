// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ClassTaskSettings } from './ClassTaskSettings'
import { getClassTaskSettings, listProjectsForClasses, updateClassTaskSettings } from '../../lib/api/projects'
import { saveTaskTypes } from '../../lib/api/taskTypes'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../lib/api/taskTypes', () => ({
  saveTaskTypes: vi.fn(async () => {}),
  taskTypeCounts: vi.fn(async () => new Map()),
  isStaleTypes: () => false,
}))
vi.mock('../../lib/api/projects', () => ({
  listProjectsForClasses: vi.fn(async () => [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }]),
  getClassTaskSettings: vi.fn(async () => ({
    stages: null, task_types: ['Research'], default_priority: 'normal', default_stage: 0,
    allow_subtasks: true, allow_dependencies: true, allow_multiple_assignees: true,
    require_assignee: false, require_subtasks_done: true,
    task_type_set: [
      { slot: 'default', name: 'Task', description: '', color: '#2563eb', icon: 'square-check' },
      { slot: null, name: 'Research', description: '', color: '#0891b2', icon: 'tag' },
    ],
    task_type_set_shown: 's1', task_type_preset: null,
  })),
  updateClassTaskSettings: vi.fn(async () => {}),
}))

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

const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
const change = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

it('saves workflow, types and rules for the chosen class project', async () => {
  await act(async () => root.render(<ClassTaskSettings classId="c1" />))
  expect(listProjectsForClasses).toHaveBeenCalledWith(['c1'])
  expect(getClassTaskSettings).toHaveBeenCalledWith('p1')
  expect(host.textContent).toContain('Task workflow steps')
  expect(host.textContent).toContain('Task types')
  expect(host.textContent).toContain('Task rules')
  for (const description of [
    'Let people add one level of subtasks.',
    'Let tasks wait for other tasks.',
    'Let more than one student hold a task.',
    'Assign someone before moving past To do.',
    'Finish every subtask before its parent.',
  ]) expect(host.textContent).toContain(description)
  const projectPicker = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(projectPicker, 'p2')
    projectPicker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(getClassTaskSettings).toHaveBeenCalledWith('p2')
  expect(host.textContent).toContain('Manage how work is categorized within this project.')
  expect(host.querySelector('[aria-label="Edit Research"]')).not.toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Allow dependencies"]')!.click())
  await act(async () => button('Save task settings')!.click())
  expect(updateClassTaskSettings).toHaveBeenCalledWith('p2', expect.objectContaining({
    allow_dependencies: false,
  }))
})

it("saves the class project's types on their own", async () => {
  await act(async () => root.render(<ClassTaskSettings classId="c1" />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Edit Research"]')!.click())
  await change(host.querySelector<HTMLInputElement>('[aria-label="Name"]')!, 'Review')
  await act(async () => button('Save type')!.click())
  expect(saveTaskTypes).toHaveBeenCalledWith('class', 'p1', [
    { slot: 'default', name: 'Task', description: '', color: '#2563eb', icon: 'square-check' },
    { slot: null, name: 'Review', description: '', color: '#0891b2', icon: 'tag', was: 'Research' },
  ], 's1', null)
  expect(getClassTaskSettings).toHaveBeenCalledTimes(2)
})
