// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProjectLeaves } from './LeaveReview'
import { projectLeaves, startCover, type ProjectLeave } from '../../lib/api/workload'
import { assignTask, setTaskHolders, unassignTask, updateTask } from '../../lib/api/general'
import { moveDueDate } from '../../lib/work/leave'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../ui/Modal', () => ({
  Modal: (p: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    p.open ? <div role="dialog"><h2>{p.title}</h2>{p.children}{p.footer}</div> : null,
}))
vi.mock('../../lib/work/useHolderHours', () => ({ useHolderHours: () => new Map() }))
vi.mock('../../lib/api/workload', () => ({ projectLeaves: vi.fn(), startCover: vi.fn(async () => 'c1') }))
vi.mock('../../lib/api/general', () => ({
  updateTask: vi.fn(async () => {}),
  setTaskHolders: vi.fn(async () => {}),
  assignTask: vi.fn(async () => {}),
  unassignTask: vi.fn(async () => {}),
}))

const leave: ProjectLeave = {
  notice_id: 'n1', user_id: 'ivan', first_day: '2026-11-26', last_day: '2026-11-28', added_by: 'pm',
  tasks: [
    { task_id: 't1', title: 'Authentication API', status: 'due_during', remaining_minutes: 360, short_minutes: 0, due_on: '2026-11-26', no_estimate: false, blocks: [] },
    { task_id: 't2', title: 'Login integration', status: 'blocks', remaining_minutes: 240, short_minutes: 0, due_on: '2026-11-25', no_estimate: false, blocks: ['Deploy login'] },
    { task_id: 't3', title: 'Bug fixes', status: 'wont_fit', remaining_minutes: 480, short_minutes: 300, due_on: '2026-12-03', no_estimate: false, blocks: [] },
    { task_id: 't4', title: 'Docs', status: 'fine', remaining_minutes: 0, short_minutes: 0, due_on: null, no_estimate: true, blocks: [] },
  ],
}

const names: Record<string, string> = { ivan: 'Ivan Cruz', keneth: 'Keneth Lim', wilson: 'Wilson Tan', pm: 'Lemmuel Alinea' }
function stateOf(over: Partial<{ myRole: string; flow: string; holders: string[] }> = {}) {
  const holders = over.holders ?? ['ivan']
  return {
    project: { id: 'p', class_board_id: null, space_id: 's', taskFlow: over.flow ?? 'planned' },
    myRole: over.myRole ?? 'pm', viewerId: 'pm', readOnly: false,
    members: ['pm', 'ivan', 'keneth', 'wilson'].map((user_id) => ({ user_id, profile: { status: 'active' } })),
    roleOf: (id: string) => (id === 'pm' ? 'pm' : 'member'),
    nameOf: (id: string) => names[id] ?? id,
    tasks: ['t1', 't2', 't3', 't4'].map((id) => ({ id, project_id: 'p', assignee_ids: holders, due_at: id === 't1' ? '2026-11-26T07:30:00Z' : null })),
    reload: vi.fn(async () => {}),
  } as unknown as GeneralProjectState
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.mocked(projectLeaves).mockResolvedValue([leave])
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function render(state = stateOf(), entry = '/projects/p') {
  await act(async () => root.render(<MemoryRouter initialEntries={[entry]}><ProjectLeaves state={state} /></MemoryRouter>))
  await act(async () => {})
}
const button = (text: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === text)
const row = (title: string) => document.querySelector<HTMLElement>(`[data-leave-task="${title}"]`)!
const typeInto = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const pick = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('banner for planners only', async () => {
  await render()
  expect(host.textContent).toContain('Ivan Cruz is away 26–28 Nov · 3 tasks need a look')
  expect(button('Review', host)).toBeTruthy()
  await act(async () => root.unmount())
  root = createRoot(host)
  await render(stateOf({ myRole: 'member' }))
  expect(projectLeaves).toHaveBeenCalledTimes(1)
  expect(host.textContent).toBe('')
})

it('leave param opens review', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.body.textContent).toContain('Added by Lemmuel Alinea')
})

it('lists flagged tasks first', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  const titles = [...document.querySelectorAll('[data-leave-task]')].map((r) => r.getAttribute('data-leave-task'))
  expect(titles).toEqual(['Authentication API', 'Login integration', 'Bug fixes', 'Docs'])
  expect(row('Authentication API').textContent).toContain('Due during leave')
  expect(row('Authentication API').textContent).toContain('Due 26 Nov · 6 h left')
  expect(row('Login integration').textContent).toContain('Blocks Deploy login')
  expect(row('Bug fixes').textContent).toContain("Won't fit · 5 h short")
  expect(row('Docs').textContent).toContain('No estimate')
  expect(button('Cover', row('Docs'))).toBeUndefined()
})

it('move due date saves', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  await typeInto(row('Authentication API').querySelector<HTMLInputElement>('input[type="date"]')!, '2026-12-01')
  await act(async () => button('Move due date', row('Authentication API'))!.click())
  expect(updateTask).toHaveBeenCalledWith('t1', { due_at: moveDueDate('2026-11-26T07:30:00Z', '2026-12-01') })
  expect(projectLeaves).toHaveBeenCalledTimes(2)
})

it('cover calls startCover', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  const select = row('Authentication API').querySelector<HTMLSelectElement>('select')!
  expect([...select.options].map((o) => o.value)).not.toContain('ivan')
  await pick(select, 'keneth')
  await act(async () => button('Cover', row('Authentication API'))!.click())
  expect(startCover).toHaveBeenCalledWith('t1', 'ivan', 'keneth')
})

it('reassign in open flow uses setTaskHolders', async () => {
  await render(stateOf({ flow: 'open', holders: ['ivan', 'wilson'] }), '/projects/p?leave=open')
  await pick(row('Authentication API').querySelector<HTMLSelectElement>('select')!, 'keneth')
  await act(async () => button('Reassign', row('Authentication API'))!.click())
  expect(setTaskHolders).toHaveBeenCalledWith('t1', ['wilson', 'keneth'])
})

it('reassign in planned flow unassigns and assigns', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  await pick(row('Authentication API').querySelector<HTMLSelectElement>('select')!, 'keneth')
  await act(async () => button('Reassign', row('Authentication API'))!.click())
  expect(unassignTask).toHaveBeenCalledWith('t1', 'ivan')
  expect(assignTask).toHaveBeenCalledWith('t1', 'p', 'keneth')
})

it('refusal shows on the row', async () => {
  vi.mocked(startCover).mockRejectedValueOnce(new Error("Keneth Lim can't hold this task."))
  await render(stateOf(), '/projects/p?leave=open')
  await pick(row('Authentication API').querySelector<HTMLSelectElement>('select')!, 'keneth')
  await act(async () => button('Cover', row('Authentication API'))!.click())
  expect(row('Authentication API').textContent).toContain("Keneth Lim can't hold this task.")
})

it('skip hides the actions', async () => {
  await render(stateOf(), '/projects/p?leave=open')
  await act(async () => button('Skip', row('Bug fixes'))!.click())
  expect(button('Cover', row('Bug fixes'))).toBeUndefined()
  expect(row('Bug fixes').textContent).toContain('Skipped')
})
