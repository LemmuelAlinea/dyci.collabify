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
vi.mock('./RequestAccessButton', () => ({ RequestAccessButton: () => null }))
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
    expect(document.querySelector<HTMLInputElement>('input[maxlength]')!.disabled).toBe(true)
    await act(async () => { const input = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Lead update'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Save task')!.click())
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
