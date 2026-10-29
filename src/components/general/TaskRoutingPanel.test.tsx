// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskRoutingPanel } from './TaskRoutingPanel'
import { sendTasksToTeams, sendTasksToCoordinator, returnWorkTask } from '../../lib/api/general'
import type { GeneralProjectState } from './useGeneralProject'
vi.mock('../../lib/api/general', () => ({ sendTasksToTeams: vi.fn(), sendTasksToCoordinator: vi.fn(), returnWorkTask: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let root: Root
const task = { id: 'one', title: 'Design', team_id: null, routing_state: 'planning', updated_at: 'stamp-one', assignee_ids: [], status: 'todo', stage: 0 }
function state(overrides = {}) {
  return { project: { id: 'project', class_board_id: null }, myRole: 'pm', viewerId: 'pm', readOnly: false,
    tasks: [task, { ...task, id: 'two', title: 'Build', updated_at: 'stamp-two' }],
    teams: [{ id: 'design', name: 'Design team', leader_id: 'lead' }, { id: 'dev', name: 'Dev team', leader_id: 'lead' }],
    members: [{ user_id: 'reviewer', role: 'coordinator', profile: { status: 'active' } }], nameOf: (id: string) => id, reload: vi.fn(), ...overrides } as unknown as GeneralProjectState
}
async function render(s: GeneralProjectState, onViewBoard?: () => void) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<TaskRoutingPanel state={s} onViewBoard={onViewBoard} />)) }
async function click(text: string) { await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text)!.click()) }
async function change(label: string, value: string) { await act(async () => { const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })) }) }
async function selectRows() { await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(el => el.click())) }
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; vi.resetAllMocks() })
it('keeps team choices in planning and sends mixed teams in one timestamped batch', async () => {
  const s = state(); await render(s); await selectRows(); await change('Team for Design', 'design'); await change('Team for Build', 'dev')
  expect(sendTasksToTeams).not.toHaveBeenCalled(); expect(s.tasks[0].routing_state).toBe('planning')
  await click('Send to team')
  expect(sendTasksToTeams).toHaveBeenCalledExactlyOnceWith('project', [{ id: 'one', team_id: 'design', updated_at: 'stamp-one' }, { id: 'two', team_id: 'dev', updated_at: 'stamp-two' }], undefined)
  expect(s.reload).toHaveBeenCalledOnce()
})
it('sends planning tasks to one coordinator', async () => {
  await render(state()); await selectRows(); await change('Coordinator', 'reviewer'); await click('Send for review')
  expect(document.body.textContent).not.toContain('View on board')
  expect(sendTasksToCoordinator).toHaveBeenCalledExactlyOnceWith('project', [{ id: 'one', updated_at: 'stamp-one' }, { id: 'two', updated_at: 'stamp-two' }], 'reviewer')
})
it('shows assigned review and requires a return reason', async () => {
  await render(state({ myRole: 'coordinator', viewerId: 'reviewer', tasks: [{ ...task, routing_state: 'coordinator_review', reviewer_id: 'reviewer' }] }))
  await click('Coordinator review'); expect(document.body.textContent).toContain('Assigned to you'); await click('Return to planning')
  expect(returnWorkTask).not.toHaveBeenCalled(); expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Confirm return')!.disabled).toBe(true)
  await act(async () => { const el = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, 'Needs detail'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Confirm return'); expect(document.body.textContent).not.toContain('View on board'); expect(returnWorkTask).toHaveBeenCalledWith('one', 'Needs detail')
})
it('retains tasks and selection after a stale refusal and offers reload', async () => {
  const s = state(); vi.mocked(sendTasksToTeams).mockRejectedValue({ code: '40001', message: 'A task changed. Reload the tasks and try again.' })
  await render(s); await selectRows(); await change('Team for Design', 'design'); await change('Team for Build', 'dev'); await click('Send to team')
  expect(document.body.textContent).toContain('Reload the tasks'); expect(document.body.textContent).not.toContain('View on board'); expect(s.reload).not.toHaveBeenCalled(); expect(s.tasks[0].routing_state).toBe('planning')
  expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(el => el.checked)).toBe(true)
})
it('requires confirmation and a reason before clearing released holders', async () => {
  await render(state({ tasks: [{ ...task, routing_state: 'released', assignee_ids: ['Alex'], team_id: 'design' }] }))
  await click('Reroute released work'); await selectRows(); await change('Team for Design', 'dev'); await click('Send to team')
  expect(document.body.textContent).toContain('Alex'); expect(sendTasksToTeams).not.toHaveBeenCalled()
  expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Confirm reroute')!.disabled).toBe(true)
})
it('hides planning controls from members and class projects', async () => {
  await render(state({ myRole: 'member' })); expect(document.body.textContent).toBe('')
  await act(async () => root.render(<TaskRoutingPanel state={state({ project: { id: 'class', class_board_id: 'board' } })} />)); expect(document.body.textContent).toBe('')
})

it('keeps archived routing read-only and blocks QA and Done rerouting', async () => {
  await render(state({ readOnly: true })); expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(el => el.disabled)).toBe(true)
  await act(async () => root.render(<TaskRoutingPanel state={state({ tasks: [{ ...task, routing_state: 'released', status: 'done', stage: 2 }] })} />))
  await click('Reroute released work'); expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  expect(document.body.textContent).toContain('Reopen work in QA or Done')
})
it('only offers a return for the assigned reviewer', async () => {
  await render(state({ myRole: 'coordinator', viewerId: 'other', tasks: [{ ...task, routing_state: 'coordinator_review', reviewer_id: 'reviewer' }] }))
  await click('Coordinator review'); expect(document.body.textContent).toContain('Reviewer: reviewer'); expect(document.body.textContent).not.toContain('Return to planning')
})
it('requires a destination even when a saved team is cleared', async () => {
  await render(state({ tasks: [{ ...task, team_id: 'design' }] })); await selectRows(); await change('Team for Design', '')
  expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Send to team')!.disabled).toBe(true)
})

it.each([false, true])('reroutes default in-progress work only without active QA (%s)', async has_qa => {
  await render(state({ project: { id: 'project', class_board_id: null, has_qa }, tasks: [{ ...task, routing_state: 'released', status: 'in_progress', stage: 1 }] }))
  await click('Reroute released work')
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(has_qa)
})

it('offers a persistent board action only after a team send completes', async () => {
  const onViewBoard = vi.fn()
  await render(state({ tasks: [{ ...task, team_id: 'design' }] }), onViewBoard)
  expect(document.body.textContent).not.toContain('View on board')
  await selectRows(); await click('Send to team')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Tasks sent to team.')
  expect(onViewBoard).not.toHaveBeenCalled()
  await click('Coordinator review'); await click('View on board')
  expect(onViewBoard).toHaveBeenCalledOnce()
})

it('keeps the send receipt but withholds board navigation until a failed refresh is retried', async () => {
  const s = state({ tasks: [{ ...task, team_id: 'design' }], reload: vi.fn().mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Still offline')).mockResolvedValue(undefined) })
  await render(s, vi.fn()); await selectRows(); await click('Send to team')
  expect(document.body.textContent).toContain('Tasks sent to team.')
  expect(document.body.textContent).toContain('Could not reload tasks.')
  expect(document.body.textContent).not.toContain('View on board')
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  expect(s.reload).toHaveBeenCalledWith({ throwOnError: true })
  await click('Reload tasks')
  expect(document.body.textContent).not.toContain('View on board')
  await click('Reload tasks')
  expect(document.body.textContent).toContain('View on board')
  expect(sendTasksToTeams).toHaveBeenCalledOnce()
})

it('keeps stale team rows locked after dismissing the receipt until reload succeeds', async () => {
  const s = state({ tasks: [{ ...task, team_id: 'design' }], reload: vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined) })
  await render(s); await selectRows(); await click('Send to team')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close this notice"]')!.click())
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  await click('Coordinator review'); await click('Planning')
  expect(document.body.textContent).toContain('Reload tasks')
  await click('Reload tasks')
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false)
})

it.each(['review', 'return'])('locks stale rows after %s succeeds and refresh fails', async action => {
  const s = state({ ...(action === 'return' ? { myRole: 'coordinator', viewerId: 'reviewer', tasks: [{ ...task, routing_state: 'coordinator_review', reviewer_id: 'reviewer' }] } : {}), reload: vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined) })
  await render(s)
  if (action === 'review') { await selectRows(); await change('Coordinator', 'reviewer'); await click('Send for review') }
  else {
    await click('Coordinator review'); await click('Return to planning')
    await act(async () => { const el = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, 'Needs detail'); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await click('Confirm return')
  }
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  await click('Reload tasks')
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false)
})
