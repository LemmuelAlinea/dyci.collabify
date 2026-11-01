// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { TasksTab } from './TasksTab'
import { createMemberTask, createTask } from '../../lib/api/general'
import { useToast } from '../ui/Toast'
import type { GeneralProjectState } from './useGeneralProject'

vi.mock('../../lib/api/general', () => ({
  createTask: vi.fn(async () => 'task-new'),
  createMemberTask: vi.fn(async () => 'task-member'),
  updateTask: vi.fn(),
}))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
// The real Modal keeps itself mounted through its exit animation; this one is gone when closed.
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog">{children}{footer}</div> : null,
}))
vi.mock('./TaskDialog', () => ({ TaskDialog: () => null }))
vi.mock('./TasksFromNotes', () => ({ TasksFromNotes: () => null }))

const reload = vi.fn(async () => {})
const onOpenTask = vi.fn()

function makeState(myRole: string, createTasks: boolean, over: Record<string, unknown> = {}) {
  return {
    project: { id: 'p1', class_board_id: null, memberRules: { manageMilestones: false, createTasks } },
    myRole,
    viewerId: 'me',
    readOnly: false,
    tasks: [],
    teams: [{ id: 'team-1', name: 'Design', leader_id: null }],
    teamMembers: [],
    members: [],
    sprints: [],
    milestones: [],
    can: () => myRole === 'pm',
    qaBlocks: () => false,
    leadsUser: () => false,
    nameOf: (id: string) => id,
    reload,
    ...over,
  } as unknown as GeneralProjectState
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

async function mount(state: GeneralProjectState) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <TasksTab state={state} layout="board" onLayout={vi.fn()} onViewBoard={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={onOpenTask} />,
    ),
  )
  return { host, close: () => act(async () => root.unmount()) }
}

const buttonOf = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

it('shows a Member Add task only while the task switch is on', async () => {
  const off = await mount(makeState('member', false))
  expect(buttonOf(off.host, 'Add task')).toBeUndefined()
  expect(buttonOf(off.host, 'Add the first task')).toBeUndefined()
  await off.close()
  const on = await mount(makeState('member', true))
  expect(buttonOf(on.host, 'Add task')).toBeDefined()
  // Members do not draft from notes: that is the planners' tool.
  expect(buttonOf(on.host, 'From notes')).toBeUndefined()
  await on.close()
})

it('shows a stakeholder nothing, whatever the switch says', async () => {
  const view = await mount(makeState('stakeholder', true, { readOnly: true }))
  expect(buttonOf(view.host, 'Add task')).toBeUndefined()
  await view.close()
})

it('creates a Member task through createMemberTask, sends it to the planners and does not open it', async () => {
  const view = await mount(makeState('member', true))
  await act(async () => buttonOf(view.host, 'Add task')!.click())
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).not.toContain('Starts')
  const title = dialog.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '  Draft the survey ')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => buttonOf(dialog as HTMLElement, 'Add task')!.click())
  expect(createMemberTask).toHaveBeenCalledExactlyOnceWith('p1', '  Draft the survey ', '', null, undefined)
  expect(createTask).not.toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Sent to planners for review')
  expect(reload).toHaveBeenCalled()
  expect(onOpenTask).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await view.close()
})

it('keeps createTask and opens the task for the project manager', async () => {
  const view = await mount(makeState('pm', false))
  await act(async () => buttonOf(view.host, 'Add task')!.click())
  const dialog = document.querySelector('[role="dialog"]')!
  const title = dialog.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Plan it')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => buttonOf(dialog as HTMLElement, 'Add task')!.click())
  expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', title: 'Plan it' }))
  expect(createMemberTask).not.toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Task added')
  expect(onOpenTask).toHaveBeenCalledWith('task-new')
  await view.close()
})
