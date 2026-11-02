// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkflowSection } from './WorkflowSection'
import type { GeneralProjectState } from '../useGeneralProject'
import {
  addWorkflowRule,
  deleteWorkflowRule,
  setWorkflowRuleEnabled,
  updateWorkflowRule,
} from '../../../lib/api/workflowRules'
import type { WorkflowRule } from '../../../lib/general/workflowRules'
import { useToast } from '../../ui/Toast'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
vi.mock('../../../lib/api/workflowRules', () => ({
  addWorkflowRule: vi.fn(async () => {}),
  updateWorkflowRule: vi.fn(async () => {}),
  deleteWorkflowRule: vi.fn(async () => {}),
  setWorkflowRuleEnabled: vi.fn(async () => {}),
}))

const reload = vi.fn(async () => {})

const person = (id: string, first: string, last: string, role: string, status = 'active') => ({
  user_id: id, role, level: 'member', project_id: 'p1', joined_at: 't', profile: { first_name: first, last_name: last, status },
})
const MEMBERS = [
  person('ana', 'Ana', 'Reyes', 'pm'),
  person('ben', 'Ben', 'Cruz', 'member'),
  person('qa1', 'Quin', 'Ames', 'qa'),
  person('sam', 'Sam', 'Lim', 'stakeholder'),
  person('off', 'Off', 'Line', 'member', 'inactive'),
]

const rule = (over: Partial<WorkflowRule> = {}): WorkflowRule => ({
  id: 'r1', projectId: 'p1', name: '', enabled: true, position: 1,
  triggerKind: 'task_released', triggerStage: null, triggerPriority: null,
  actionKind: 'notify', notifyTo: 'team_lead', personId: null, actionPriority: null, actionStage: null,
  createdBy: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  lastSkippedAt: null, lastSkipReason: null, ...over,
})

function makeState(over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) {
  return {
    project: {
      id: 'p1', name: 'Alpha', class_board_id: null, has_qa: false, qa_stage: null,
      stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'], ...project,
    },
    members: MEMBERS, workflowRules: [], myRole: 'pm', readOnly: false, reload,
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
  act(async () => root.render(<MemoryRouter><WorkflowSection state={state} /></MemoryRouter>))
const buttons = (text: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text)
const button = (text: string) => buttons(text)[0]
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click())
const sel = (name: string) => {
  const byLabel = [...document.body.querySelectorAll('label')].find((l) => l.textContent?.replace('optional', '').trim() === name)
  return (byLabel ? document.getElementById(byLabel.htmlFor) : document.body.querySelector(`[aria-label="${name}"]`)) as HTMLSelectElement | null
}
const choose = (el: HTMLSelectElement | null, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el!, value)
    el!.dispatchEvent(new Event('change', { bubbles: true }))
  })
const typeInto = (el: HTMLInputElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const optionsOf = (el: HTMLSelectElement | null) => [...el!.options].map((o) => o.textContent)


it('shows the title, the help and the empty state', async () => {
  await show(makeState())
  expect(host.querySelector('h2')?.textContent).toBe('Workflow rules')
  expect(host.textContent).toContain("Rules act for the project. They follow the project's task rules and never set off other rules.")
  expect(host.textContent).toContain('No rules yet.')
  expect(button('Add rule')).toBeDefined()
})

it('lists a rule with its name over its sentence, or the sentence alone', async () => {
  await show(makeState({
    workflowRules: [
      rule({ id: 'a', name: 'Review heads-up', triggerKind: 'stage_entered', triggerStage: 'testing' }),
      rule({ id: 'b', triggerKind: 'task_overdue', actionKind: 'assign', notifyTo: null, personId: 'ben' }),
    ],
  }))
  const rows = [...host.querySelectorAll('li')]
  expect(rows).toHaveLength(2)
  expect(rows[0].textContent).toContain('Review heads-up')
  expect(rows[0].textContent).toContain('When a task moves to Testing, notify the team lead')
  expect(rows[1].textContent).toContain('When a task becomes overdue, assign Ben Cruz')
  expect(rows[1].textContent?.match(/When a task becomes overdue/g)).toHaveLength(1)
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
})

it('says when a rule was last skipped and why, and what no longer holds', async () => {
  await show(makeState({
    workflowRules: [
      rule({ id: 'a', lastSkippedAt: '2026-11-02T04:00:00Z', lastSkipReason: "Ben Cruz isn't on the task's team." }),
      rule({ id: 'b', triggerKind: 'stage_entered', triggerStage: 'Gone' }),
      rule({ id: 'c', actionKind: 'assign', notifyTo: null, personId: 'off' }),
      rule({ id: 'd' }),
    ],
  }))
  const rows = [...host.querySelectorAll('li')]
  expect(rows[0].textContent).toMatch(/Last skipped Nov \d: Ben Cruz isn't on the task's team\./)
  expect(rows[1].textContent).toContain('Stage Gone no longer exists. Edit the rule.')
  expect(rows[2].textContent).toContain('Off Line is no longer in the project.')
  expect(rows[3].textContent).not.toContain('Last skipped')
  const problem = [...rows[1].querySelectorAll('p')].find((p) => p.textContent?.includes('no longer exists'))
  expect(problem?.className).toMatch(/danger/)
})

it('reads only for somebody who is not the manager or a coordinator', async () => {
  for (const over of [{ myRole: 'member' }, { myRole: 'qa' }, { myRole: 'pm', readOnly: true }]) {
    await show(makeState({ ...over, workflowRules: [rule({ name: 'Heads-up' })] }))
    expect(host.textContent).toContain('Heads-up')
    expect(button('Add rule')).toBeUndefined()
    expect(button('Edit')).toBeUndefined()
    expect(button('Delete')).toBeUndefined()
    expect((host.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true)
  }
  await show(makeState({ myRole: 'coordinator', workflowRules: [rule({})] }))
  expect(button('Add rule')).toBeDefined()
  expect(button('Edit')).toBeDefined()
})

it('turns a rule off through the switch, then reloads', async () => {
  await show(makeState({ workflowRules: [rule({ id: 'r9', name: 'Heads-up' })] }))
  await click(host.querySelector('[role="switch"]')!)
  expect(setWorkflowRuleEnabled).toHaveBeenCalledWith('r9', false)
  expect(reload).toHaveBeenCalled()
})

it('hides Add rule at 20 rules and says why', async () => {
  const twenty = Array.from({ length: 20 }, (_, i) => rule({ id: `r${i}`, position: i + 1 }))
  await show(makeState({ workflowRules: twenty }))
  expect(button('Add rule')).toBeUndefined()
  expect(host.textContent).toContain('A project can have up to 20 rules.')
  await show(makeState({ workflowRules: twenty.slice(0, 19) }))
  expect(button('Add rule')).toBeDefined()
  expect(host.textContent).not.toContain('A project can have up to 20 rules.')
})

async function open() {
  await show(makeState())
  await click(button('Add rule'))
}

it('opens the builder with its choices', async () => {
  await open()
  expect(sel('Name')).not.toBeNull()
  expect(optionsOf(sel('When'))).toEqual([
    'A task moves to a stage', 'A task is sent to a team', 'A task becomes overdue', "A task's priority is raised to",
  ])
  expect(optionsOf(sel('Then'))).toEqual(['Notify', 'Set the priority to', 'Assign', 'Move it to'])
  expect(optionsOf(sel('Notify'))).toEqual([
    'The team lead', 'The project manager and coordinators', 'QA', "The task's holders", 'A specific person',
  ])
  expect(button('Save rule')).toBeDefined()
  expect(button('Cancel')).toBeDefined()
})

it('saves the default rule with only the fields it uses', async () => {
  await open()
  await typeInto(sel('Name') as unknown as HTMLInputElement, ' Tell the lead ')
  await click(button('Save rule'))
  expect(addWorkflowRule).toHaveBeenCalledWith('p1', {
    name: 'Tell the lead', trigger_kind: 'task_released', trigger_stage: null, trigger_priority: null,
    action_kind: 'notify', notify_to: 'team_lead', person_id: null, action_priority: null, action_stage: null,
  })
  expect(reload).toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Rule saved')
})

it('builds a stage trigger that notifies a specific person who is not a stakeholder', async () => {
  await open()
  await choose(sel('When'), 'stage_entered')
  expect(optionsOf(sel('Stage'))).toEqual(['Choose a stage', 'Planning', 'Development', 'Testing', 'Revision', 'Completed'])
  await choose(sel('Stage'), 'Testing')
  await choose(sel('Notify'), 'person')
  expect(optionsOf(sel('Person'))).toEqual(['Choose a person', 'Ana Reyes', 'Ben Cruz', 'Quin Ames'])
  await choose(sel('Person'), 'qa1')
  await click(button('Save rule'))
  expect(addWorkflowRule).toHaveBeenCalledWith('p1', expect.objectContaining({
    trigger_kind: 'stage_entered', trigger_stage: 'Testing', action_kind: 'notify', notify_to: 'person', person_id: 'qa1',
    trigger_priority: null, action_priority: null, action_stage: null,
  }))
})

it('builds a priority trigger that sets the priority', async () => {
  await open()
  await choose(sel('When'), 'priority_raised')
  expect(optionsOf(sel('Priority raised to'))).toEqual(['High', 'Urgent'])
  await choose(sel('Priority raised to'), 'urgent')
  await choose(sel('Then'), 'set_priority')
  expect(optionsOf(sel('Priority'))).toEqual(['Low', 'Normal', 'High', 'Urgent'])
  await choose(sel('Priority'), 'low')
  await click(button('Save rule'))
  expect(addWorkflowRule).toHaveBeenCalledWith('p1', {
    name: '', trigger_kind: 'priority_raised', trigger_stage: null, trigger_priority: 'urgent',
    action_kind: 'set_priority', notify_to: null, person_id: null, action_priority: 'low', action_stage: null,
  })
})

it('builds an overdue rule that assigns somebody who can hold tasks', async () => {
  await open()
  await choose(sel('When'), 'task_overdue')
  await choose(sel('Then'), 'assign')
  expect(optionsOf(sel('Person'))).toEqual(['Choose a person', 'Ana Reyes', 'Ben Cruz'])
  await choose(sel('Person'), 'ben')
  await click(button('Save rule'))
  expect(addWorkflowRule).toHaveBeenCalledWith('p1', {
    name: '', trigger_kind: 'task_overdue', trigger_stage: null, trigger_priority: null,
    action_kind: 'assign', notify_to: null, person_id: 'ben', action_priority: null, action_stage: null,
  })
})

it('builds a rule that moves the task, offering no last stage', async () => {
  await open()
  await choose(sel('Then'), 'move_stage')
  expect(optionsOf(sel('Move to'))).toEqual(['Choose a stage', 'Planning', 'Development', 'Testing', 'Revision'])
  await choose(sel('Move to'), 'Development')
  await click(button('Save rule'))
  expect(addWorkflowRule).toHaveBeenCalledWith('p1', expect.objectContaining({
    action_kind: 'move_stage', action_stage: 'Development', notify_to: null, person_id: null,
  }))
})

it('offers no stage past an active QA stage', async () => {
  await show(makeState({}, { has_qa: true }))
  await click(button('Add rule'))
  await choose(sel('Then'), 'move_stage')
  expect(optionsOf(sel('Move to'))).toEqual(['Choose a stage', 'Planning', 'Development', 'Testing'])
})

it('asks for what is missing instead of saving', async () => {
  await open()
  await choose(sel('When'), 'stage_entered')
  await click(button('Save rule'))
  expect(addWorkflowRule).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Choose a stage for the rule to watch.')
})

it('shows the database refusal as it is and keeps the builder open', async () => {
  vi.mocked(addWorkflowRule).mockRejectedValueOnce({ code: '23514', message: 'Choose a stage in this project.' })
  await open()
  await click(button('Save rule'))
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Choose a stage in this project.')
  expect(button('Save rule')).toBeDefined()
  expect(reload).not.toHaveBeenCalled()
})

it('edits a rule from what it says now', async () => {
  await show(makeState({
    workflowRules: [rule({ id: 'r7', name: 'Old', triggerKind: 'stage_entered', triggerStage: 'testing', actionKind: 'move_stage', notifyTo: null, actionStage: 'Planning' })],
  }))
  await click(button('Edit'))
  expect((sel('Name') as unknown as HTMLInputElement).value).toBe('Old')
  expect(sel('Stage')!.value).toBe('Testing')
  expect(sel('Move to')!.value).toBe('Planning')
  await choose(sel('Move to'), 'Revision')
  await click(button('Save rule'))
  expect(updateWorkflowRule).toHaveBeenCalledWith('r7', expect.objectContaining({
    name: 'Old', trigger_stage: 'Testing', action_kind: 'move_stage', action_stage: 'Revision',
  }))
  expect(addWorkflowRule).not.toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Rule saved')
})

it('asks before deleting, then deletes and says so', async () => {
  await show(makeState({ workflowRules: [rule({ id: 'r3', name: 'Heads-up' })] }))
  await click(button('Delete'))
  expect(document.body.textContent).toContain('Delete this rule?')
  expect(deleteWorkflowRule).not.toHaveBeenCalled()
  const confirm = buttons('Delete').find((b) => b.closest('[role="dialog"]'))
  await click(confirm)
  expect(deleteWorkflowRule).toHaveBeenCalledWith('r3')
  expect(reload).toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Rule deleted')
})
