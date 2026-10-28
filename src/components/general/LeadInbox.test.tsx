// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { LeadInbox } from './LeadInbox'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const api = vi.hoisted(() => ({ returnWorkTask: vi.fn(), listWorkTaskReturnReceipts: vi.fn().mockResolvedValue([]) }))
vi.mock('../../lib/api/general', () => api)
vi.mock('./TaskDialog', () => ({ TaskDialog: ({ taskId }: { taskId: string | null }) => taskId ? <div>Dialog {taskId}</div> : null }))

it('scopes Incoming to released unassigned work for the led team and keeps own return receipts', async () => {
  const task = { id: 'a', title: 'Team A incoming', team_id: 'a', assignee_ids: [], routing_state: 'released', status: 'todo', archived_at: null }
  const state = { project: { id: 'p', class_board_id: null }, viewerId: 'lead', myRole: 'member', readOnly: false,
    teams: [{ id: 'a', name: 'Team A', leader_id: 'lead' }, { id: 'b', name: 'Team B', leader_id: 'other' }],
    tasks: [task, { ...task, id: 'plan', title: 'Private plan', routing_state: 'planning' }, { ...task, id: 'b', title: 'Team B incoming', team_id: 'b' }, { ...task, id: 'held', title: 'Already held', assignee_ids: ['member'] }],
    reload: vi.fn(),
  } as unknown as GeneralProjectState
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<LeadInbox state={state} />))
    expect(container.textContent).toContain('Team A incoming')
    expect(container.textContent).not.toMatch(/Private plan|Team B incoming|Already held|Add task/)
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Team A incoming')!.click())
    expect(container.textContent).toContain('Dialog a')
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Return to planning')!.click())
    const confirm = [...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm return')!
    expect(confirm.disabled).toBe(true)
    const reason = document.querySelector('textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'No capacity'); reason.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(confirm.disabled).toBe(false)
    api.listWorkTaskReturnReceipts.mockResolvedValue([{ task_id: 'a', returned_at: '2026-10-28T00:00:00Z', reason: 'No capacity' }])
    state.reload = vi.fn(async () => { state.tasks = [] })
    await act(async () => confirm.click())
    expect(api.returnWorkTask).toHaveBeenCalledExactlyOnceWith('a', 'No capacity')
    await act(async () => root.render(<LeadInbox state={{ ...state }} />))
    expect(container.textContent).not.toContain('Team A incoming')
    expect(container.textContent).toContain('No capacity')
    expect(api.listWorkTaskReturnReceipts).toHaveBeenCalledWith('p')
  } finally { await act(async () => root.unmount()); container.remove() }
})

it.each([false, true])('returns default in-progress incoming work only without active QA (%s)', async has_qa => {
  const state = { project: { id: 'p', class_board_id: null, has_qa }, viewerId: 'lead', myRole: 'member', readOnly: false,
    teams: [{ id: 'a', name: 'Team A', leader_id: 'lead' }],
    tasks: [{ id: 'a', title: 'Incoming', team_id: 'a', assignee_ids: [], routing_state: 'released', status: 'in_progress', stage: 1 }], reload: vi.fn(),
  } as unknown as GeneralProjectState
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<LeadInbox state={state} />))
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Return to planning')!.disabled).toBe(has_qa)
  } finally { await act(async () => root.unmount()); container.remove() }
})
