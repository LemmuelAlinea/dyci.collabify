// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TasksSection } from './TasksSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { previewTaskFlow, setTaskFlow, updateGeneralProject } from '../../../lib/api/general'
import { DEFAULT_TASK_RULES } from '../../../lib/general/taskRules'
import { useToast } from '../../ui/Toast'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
vi.mock('../../../lib/api/general', () => ({
  updateGeneralProject: vi.fn(async () => {}),
  setTaskFlow: vi.fn(async () => 3),
  previewTaskFlow: vi.fn(async () => ({ planning: 2, review: 1 })),
}))

const reload = vi.fn(async () => {})

function makeState(over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) {
  return {
    project: { id: 'p1', name: 'Alpha', stages: null, qa_stage: null, updated_at: 't1', ...project },
    myRole: 'pm', myOpenRequests: [], myGrants: [], can: () => true, readOnly: false, archived: false, reload,
    ...over,
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

const show = (state: GeneralProjectState) =>
  act(async () => root.render(<MemoryRouter><TasksSection state={state} /></MemoryRouter>))
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)

it('reads the stages and offers no editing to somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, myRole: 'qa' }, { stages: ['Plan', 'Build', 'Ship'] }))
  expect(host.textContent).toContain('Plan → Build → Ship')
  expect(host.querySelector('input:not([disabled]), select:not([disabled])')).toBeNull()
  expect(button('Edit stages')).toBeUndefined()
})

it('reads only while the project is read-only', async () => {
  await show(makeState({ readOnly: true }))
  expect(button('Edit stages')).toBeUndefined()
})

it('saves stages and the QA stage together, and nothing else', async () => {
  await show(makeState())
  await act(async () => button('Edit stages')!.click())
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === 'System development')!.click())
  await act(async () => button('Save stages')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'],
    qa_stage: null,
  })
  expect(reload).toHaveBeenCalled()
})

it('keeps the stage validation message', async () => {
  await show(makeState())
  await act(async () => button('Edit stages')!.click())
  await act(async () => button('Add a stage')!.click())
  await act(async () => button('Save stages')!.click())
  expect(host.textContent).toContain('Progress stages: Every stage needs a name.')
  expect(updateGeneralProject).not.toHaveBeenCalled()
})

const RULE_LABELS = [
  'Allow subtasks',
  'Allow dependencies',
  'Allow multiple holders',
  'Require a holder before work starts',
  'Require all subtasks to be done first',
]
const labelled = (name: string) => host.querySelector<HTMLElement>(`[aria-label="${name}"]`)
const select = (label: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label)
  return l ? host.querySelector<HTMLSelectElement>(`select[id="${l.htmlFor}"]`) : null
}
const choose = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('titles the panel and shows every control with its label', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Task rules')
  expect(select('Default priority')).not.toBeNull()
  expect(select('New tasks start in')).not.toBeNull()
  for (const name of RULE_LABELS) expect(labelled(name)?.getAttribute('role')).toBe('switch')
  expect(host.textContent).toContain("Turning this off keeps current holders; tasks just can't get another.")
})

it('disables every task rule control for somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, myRole: 'member' }))
  expect(select('Default priority')!.disabled).toBe(true)
  expect(select('New tasks start in')!.disabled).toBe(true)
  for (const name of RULE_LABELS) expect((labelled(name) as HTMLButtonElement).disabled).toBe(true)
  expect(button('Save task rules')).toBeUndefined()
})

it('disables the task rule controls while the project is read-only', async () => {
  await show(makeState({ readOnly: true }))
  expect(select('Default priority')!.disabled).toBe(true)
  expect(button('Save task rules')).toBeUndefined()
})

it('lists the project stages except the last as starting places', async () => {
  await show(makeState({}, { stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'] }))
  const labels = [...select('New tasks start in')!.options].map((o) => o.textContent)
  expect(labels).toEqual(['Planning', 'Development', 'Testing', 'Revision'])
})

it('lists the default three stages without Done', async () => {
  await show(makeState())
  expect([...select('New tasks start in')!.options].map((o) => o.textContent)).toEqual(['To do', 'In progress'])
})

it('stops the list at the QA stage while the project has QA', async () => {
  await show(
    makeState({}, { stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'], has_qa: true, taskRules: { ...DEFAULT_TASK_RULES, defaultStage: 3 } }),
  )
  const sel = select('New tasks start in')!
  expect([...sel.options].map((o) => o.textContent)).toEqual(['Planning', 'Development', 'Testing'])
  expect(sel.value).toBe('2')
  expect(host.textContent).toContain('Tasks start at Testing because of the QA stage.')
})

it('shows the nearest allowed stage when the saved one is the last', async () => {
  await show(makeState({}, { taskRules: { ...DEFAULT_TASK_RULES, defaultStage: 2 } }))
  expect(select('New tasks start in')!.value).toBe('1')
  expect(host.textContent).not.toContain('because of the QA stage')
})

it('does not blame QA when the last stage alone limits the starting stage', async () => {
  await show(makeState({}, { has_qa: true, taskRules: { ...DEFAULT_TASK_RULES, defaultStage: 2 } }))
  expect(host.textContent).not.toContain('because of the QA stage')
})

it('keeps unsaved rule choices through unrelated project updates and resets for a new project', async () => {
  await show(makeState())
  await choose(select('Default priority')!, 'urgent')
  await show(makeState({}, { updated_at: 't2' }))
  expect(select('Default priority')!.value).toBe('urgent')
  await show(makeState({}, { id: 'p2', updated_at: 't2' }))
  expect(select('Default priority')!.value).toBe('normal')
})

it('saves the task rules as snake_case columns in one call', async () => {
  await show(makeState())
  await choose(select('Default priority')!, 'urgent')
  await choose(select('New tasks start in')!, '1')
  await act(async () => labelled('Allow subtasks')!.click())
  await act(async () => labelled('Allow multiple holders')!.click())
  await act(async () => labelled('Require a holder before work starts')!.click())
  await act(async () => button('Save task rules')!.click())
  expect(updateGeneralProject).toHaveBeenCalledTimes(1)
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    default_priority: 'urgent',
    default_stage: 1,
    allow_subtasks: false,
    allow_dependencies: true,
    allow_multiple_assignees: false,
    require_assignee: true,
    require_subtasks_done: true,
  })
  expect(reload).toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Task rules saved')
})

it('shows the error and skips the reload when saving the task rules fails', async () => {
  vi.mocked(updateGeneralProject).mockRejectedValueOnce(new Error('boom'))
  await show(makeState())
  await act(async () => button('Save task rules')!.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('boom')
  expect(reload).not.toHaveBeenCalled()
})

const radio = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes(text))
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

it('shows the two task flows with what each means', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Task flow')
  expect(radio('Planned handoff')!.textContent).toContain('Tasks start in planning. The project manager or a coordinator sends them to a team.')
  expect(radio('Open')!.textContent).toContain('Anyone on the project adds live tasks and assigns them to anyone.')
  expect(radio('Planned handoff')!.getAttribute('aria-checked')).toBe('true')
})

it('lets only the project manager change the task flow', async () => {
  await show(makeState({ myRole: 'coordinator' }, { taskFlow: 'open' }))
  expect(radio('Open')!.getAttribute('aria-checked')).toBe('true')
  expect(radio('Planned handoff')!.disabled).toBe(true)
  expect(button('Save task flow')).toBeUndefined()
  expect(host.textContent).toContain('Only the project manager changes this.')
})

it('confirms a switch to open with what goes live, then saves it', async () => {
  await show(makeState())
  await act(async () => radio('Open')!.click())
  await act(async () => button('Save task flow')!.click())
  expect(previewTaskFlow).toHaveBeenCalledWith('p1')
  expect(document.body.textContent).toContain('3 tasks waiting in planning or review go live now.')
  expect(setTaskFlow).not.toHaveBeenCalled()
  await act(async () => bodyButton('Open the task flow')!.click())
  expect(setTaskFlow).toHaveBeenCalledWith('p1', 'open')
  expect(vi.mocked(useToast)().show).toHaveBeenCalledWith('Task flow is open. 3 tasks are live.')
  expect(reload).toHaveBeenCalled()
})

it('says nothing is waiting when no task is in planning', async () => {
  vi.mocked(previewTaskFlow).mockResolvedValueOnce({ planning: 0, review: 0 })
  vi.mocked(setTaskFlow).mockResolvedValueOnce(0)
  await show(makeState())
  await act(async () => radio('Open')!.click())
  await act(async () => button('Save task flow')!.click())
  expect(document.body.textContent).toContain('Nothing is waiting in planning.')
  await act(async () => bodyButton('Open the task flow')!.click())
  expect(vi.mocked(useToast)().show).toHaveBeenCalledWith('Task flow is open.')
})

it('switches back to planned handoff without a confirmation', async () => {
  vi.mocked(setTaskFlow).mockResolvedValueOnce(0)
  await show(makeState({}, { taskFlow: 'open' }))
  await act(async () => radio('Planned handoff')!.click())
  await act(async () => button('Save task flow')!.click())
  expect(previewTaskFlow).not.toHaveBeenCalled()
  expect(setTaskFlow).toHaveBeenCalledWith('p1', 'planned')
  expect(vi.mocked(useToast)().show).toHaveBeenCalledWith('Task flow is planned handoff.')
})
