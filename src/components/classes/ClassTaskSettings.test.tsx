// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ClassTaskSettings } from './ClassTaskSettings'
import { getClassTaskSettings, listProjectsForClasses, updateClassTaskSettings } from '../../lib/api/projects'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../lib/api/projects', () => ({
  listProjectsForClasses: vi.fn(async () => [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }]),
  getClassTaskSettings: vi.fn(async () => ({
    stages: null, task_types: ['Research'], default_priority: 'normal', default_stage: 0,
    allow_subtasks: true, allow_dependencies: true, allow_multiple_assignees: true,
    require_assignee: false, require_subtasks_done: true,
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
  const projectPicker = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(projectPicker, 'p2')
    projectPicker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(getClassTaskSettings).toHaveBeenCalledWith('p2')
  await act(async () => button('Add type')!.click())
  await change(host.querySelector<HTMLInputElement>('[aria-label="Custom task type 2"]')!, 'Design')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Allow dependencies"]')!.click())
  await act(async () => button('Save task settings')!.click())
  expect(updateClassTaskSettings).toHaveBeenCalledWith('p2', expect.objectContaining({
    task_types: ['Research', 'Design'], allow_dependencies: false,
  }))
})
