// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TaskDialog } from './TaskDialog'
import { updateTask } from '../../lib/api/general'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const show = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('./RoleBadge', () => ({ PersonBadge: () => null }))
vi.mock('./RequestAccessButton', () => ({ RequestAccessButton: () => 'Request access' }))
vi.mock('../../lib/api/general', async importOriginal => ({ ...await importOriginal<object>(), listComments: async () => [], listFiles: async () => [], listLogs: async () => [], listTaskEvents: async () => [], updateTask: vi.fn() }))

it('locks dates and description for a holder but lets the receiving lead edit them before assignment', async () => {
  const task = { id: 'task', title: 'Build page', project_id: 'p', created_by: 'pm', team_id: 'a', routing_state: 'released', assignee_ids: ['worker'], status: 'todo', stage: 0, description: 'Original', starts_at: null, due_at: null, archived_at: null }
  const base = { project: { id: 'p', class_board_id: null, stages: ['Todo', 'Done'] }, readOnly: false,
    teams: [{ id: 'a', leader_id: 'lead' }], teamMembers: [{ team_id: 'a', user_id: 'lead' }], members: [], tasks: [task],
    can: () => false, leadsUser: () => false, nameOf: (id: string) => id, roleOf: () => 'member', qaBlocks: () => false, reload: vi.fn().mockResolvedValue(undefined),
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={{ ...base, viewerId: 'worker', myRole: 'member' } as unknown as GeneralProjectState} taskId="task" onClose={vi.fn()} />))
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')].every(input => input.disabled)).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
    expect(document.querySelector<HTMLInputElement>('input[maxlength]')!.disabled).toBe(false)

    const unassigned = { ...task, assignee_ids: [] }
    await act(async () => root.render(<TaskDialog state={{ ...base, viewerId: 'lead', myRole: 'member', tasks: [unassigned] } as unknown as GeneralProjectState} taskId="task" onClose={vi.fn()} />))
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')].every(input => !input.disabled)).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false)
    expect(document.querySelector('header input[aria-label="Task title"]')).toBeNull()
    await act(async () => { const input = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Lead update'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Save changes')!.click())
    expect(updateTask).toHaveBeenCalledWith('task', { description: 'Lead update', due_at: null, starts_at: null })
  } finally { await act(async () => root.unmount()); container.remove(); vi.mocked(updateTask).mockClear() }
})

it('offers only active receiving-team members and keeps adding holders available', async () => {
  const task = { id: 'task', title: 'Incoming', project_id: 'p', created_by: 'pm', team_id: 'a', routing_state: 'released', assignee_ids: ['a1'], status: 'todo', stage: 0, description: '', archived_at: null }
  const state = { project: { id: 'p', class_board_id: null, stages: ['Todo', 'Doing', 'Done'] }, viewerId: 'lead', myRole: 'member', readOnly: false,
    teams: [{ id: 'a', leader_id: 'lead' }, { id: 'b', leader_id: 'lead' }],
    teamMembers: ['lead', 'a1', 'active', 'pending', 'rejected', 'qa', 'stakeholder'].map(user_id => ({ team_id: 'a', user_id })).concat([{ team_id: 'b', user_id: 'other-team' }]),
    members: ['lead', 'a1', 'active', 'pending', 'rejected', 'qa', 'stakeholder', 'other-team'].map(user_id => ({ user_id, profile: { status: user_id === 'pending' || user_id === 'rejected' ? user_id : 'active' } })),
    tasks: [task], can: () => false, leadsUser: () => false, nameOf: (id: string) => id,
    roleOf: (id: string) => id === 'qa' || id === 'stakeholder' ? id : 'member', qaBlocks: () => false,
  } as unknown as GeneralProjectState
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={state} taskId="task" onClose={vi.fn()} />))
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Assign someone"]')!
    expect([...select.options].filter(o => o.value).map(o => o.value)).toEqual(['lead', 'active'])
    expect(document.body.textContent).not.toContain('Take this task')
    await act(async () => root.render(<TaskDialog state={{ ...state, teams: [] }} taskId="task" onClose={vi.fn()} />))
    expect(document.querySelector('[aria-label="Assign someone"]')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('shows a Workspace viewer with no role no comment form or access request', async () => {
  const task = { id: 'task', title: 'Released', project_id: 'p', created_by: 'pm', team_id: null, routing_state: 'released', assignee_ids: [], status: 'todo', stage: 0, description: '', starts_at: null, due_at: null, archived_at: null }
  const base = { project: { id: 'p', class_board_id: null, stages: ['Todo', 'Done'] }, teams: [], teamMembers: [], members: [], tasks: [task],
    can: () => false, leadsUser: () => false, nameOf: (id: string) => id, roleOf: () => null, qaBlocks: () => false, reload: vi.fn().mockResolvedValue(undefined) }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={{ ...base, viewerId: 'member', myRole: 'member', readOnly: false } as unknown as GeneralProjectState} taskId="task" onClose={vi.fn()} />))
    expect(document.querySelector('[aria-label="Write a comment"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Request access')
    await act(async () => root.render(<TaskDialog state={{ ...base, viewerId: 'viewer', myRole: null, readOnly: true } as unknown as GeneralProjectState} taskId="task" onClose={vi.fn()} />))
    expect(document.querySelector('[aria-label="Write a comment"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Request access')
  } finally { await act(async () => root.unmount()); container.remove() }
})

const workState = (over: Record<string, unknown> = {}) => {
  const main = { id: "main", title: "Build page", project_id: "p", created_by: "pm", team_id: "a", routing_state: "released", assignee_ids: ["worker"], status: "todo", stage: 0, description: "", starts_at: null, due_at: null, archived_at: null, priority: "normal", parent_id: null }
  const sub = { ...main, id: "sub", title: "Login form", assignee_ids: [], parent_id: "main" }
  return { project: { id: "p", class_board_id: null, stages: ["Todo", "Doing", "Done"] }, viewerId: "pm", myRole: "pm", readOnly: false,
    teams: [{ id: "a", leader_id: "lead" }], teamMembers: [], members: [], tasks: [main, sub], dependencies: [],
    can: (permission: string) => permission === "manage_tasks", leadsUser: () => false, nameOf: (id: string) => id, roleOf: () => "member", qaBlocks: () => false, reload: vi.fn().mockResolvedValue(undefined), ...over,
  } as unknown as GeneralProjectState
}

it("saves a changed priority and leaves it out when unchanged", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    const select = document.querySelector<HTMLSelectElement>("[aria-label=\"Priority\"], select#priority") ?? [...document.querySelectorAll<HTMLSelectElement>("select")].find(el => [...el.options].some(o => o.value === "urgent"))!
    expect([...select.options].map(o => o.value)).toEqual(["urgent", "high", "normal", "low"])
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "high"); select.dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save changes")!.click())
    expect(updateTask).toHaveBeenCalledWith("main", expect.objectContaining({ priority: "high" }))
    vi.mocked(updateTask).mockClear()
    await act(async () => root.render(<TaskDialog state={workState()} taskId="sub" onClose={vi.fn()} />))
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save changes")!.click())
    expect(vi.mocked(updateTask).mock.calls[0][1]).not.toHaveProperty("priority")
  } finally { await act(async () => root.unmount()); container.remove(); vi.mocked(updateTask).mockClear() }
})

it("shows a viewer without edit rights the priority as text", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState({ viewerId: "viewer", myRole: "member", can: () => false })} taskId="main" onClose={vi.fn()} />))
    expect(document.body.textContent).toContain("Priority")
    expect([...document.querySelectorAll("select")].some(el => [...el.options].some(o => o.value === "urgent"))).toBe(false)
  } finally { await act(async () => root.unmount()); container.remove() }
})

it("opens a subtask from its parent and back again in the same window", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container)
  const click = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click()
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    expect(document.body.textContent).toContain("Subtasks")
    await act(async () => click("Login form"))
    expect(document.body.textContent).toContain("Part of Build page")
    await act(async () => click("Build page"))
    expect(document.body.textContent).toContain("Subtasks")
    expect(document.body.textContent).not.toContain("Part of")
  } finally { await act(async () => root.unmount()); container.remove() }
})

it("does not offer the Done stage while the task waits for an open task", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container)
  const state = workState()
  const blocker = { ...state.tasks[0], id: "blocker", title: "Write copy", assignee_ids: [] }
  try {
    await act(async () => root.render(<TaskDialog state={{ ...state, tasks: [...state.tasks, blocker], dependencies: [{ task_id: "main", depends_on_id: "blocker" }] } as unknown as GeneralProjectState} taskId="main" onClose={vi.fn()} />))
    const stage = [...document.querySelectorAll<HTMLSelectElement>("select")].find(el => [...el.options].some(o => o.textContent === "Done"))!
    expect([...stage.options].find(o => o.textContent === "Done")!.disabled).toBe(true)
    expect(document.body.textContent).toContain("can't be marked done")
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('opens task history on demand while keeping comments available', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    expect(document.querySelector('[aria-label="Write a comment"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Nothing yet.')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'History')!.click())
    expect(document.body.textContent).toContain('Nothing yet.')
    expect(document.querySelector('[aria-label="Write a comment"]')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('keeps archiving in the task actions menu', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    expect(document.querySelector('[role="menuitem"]')).toBeNull()
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Task actions"]')!.click())
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain('Archive task')
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('edits the title in the header and saves it from the footer', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    const title = document.querySelector<HTMLInputElement>('[role="dialog"] header input[aria-label="Task title"]')!
    expect(title.value).toBe('Build page')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Build landing page'); title.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('footer button')].find(button => button.textContent === 'Save changes')!.click())
    expect(updateTask).toHaveBeenCalledWith('main', expect.objectContaining({ title: 'Build landing page' }))
  } finally { await act(async () => root.unmount()); container.remove(); vi.mocked(updateTask).mockClear() }
})

it('discards an unsaved title when Cancel closes the task', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TaskDialog state={workState()} taskId="main" onClose={vi.fn()} />))
    const title = document.querySelector<HTMLInputElement>('[aria-label="Task title"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Unsaved title'); title.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('footer button')].find(button => button.textContent === 'Cancel')!.click())
    expect(title.value).toBe('Build page')
  } finally { await act(async () => root.unmount()); container.remove() }
})
