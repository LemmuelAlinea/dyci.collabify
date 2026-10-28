// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AssignByPosition } from './AssignByPosition'
import type { GeneralProjectState } from './useGeneralProject'
const api = vi.hoisted(() => ({ draftTeamRoutes: vi.fn(), draftLeadAssignees: vi.fn(), assignTask: vi.fn(), updateTask: vi.fn(), listTasks: vi.fn() }))
vi.mock('../../lib/api/workAi', () => api)
vi.mock('../../lib/api/general', () => api)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./TasksFromNotes', () => ({ KeepBox: ({ checked, onToggle }: { checked: boolean; onToggle: () => void }) => <input type="checkbox" checked={checked} onChange={onToggle} /> }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let root: Root
const task = { id: 't', title: 'Build', team_id: 'a', routing_state: 'planning', assignee_ids: [], archived_at: null, status: 'todo' }
const state = { project: { id: 'p' }, readOnly: false, tasks: [task], reload: vi.fn(), nameOf: (id: string) => id,
  teams: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
  members: ['inside', 'outside'].map(user_id => ({ user_id, role: 'member', profile: { status: 'active' } })),
  teamMembers: [{ team_id: 'a', user_id: 'inside' }, { team_id: 'b', user_id: 'outside' }],
} as unknown as GeneralProjectState
const pick = { key: 't', title: 'Build', teamId: 'b', userId: 'inside', kind: 'position', label: 'Builder', reason: '' }
async function render(mode: 'route' | 'lead') {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<AssignByPosition state={state} mode={mode} open onClose={() => {}} />))
}
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; vi.resetAllMocks() })
it('reviews team choices before saving and never assigns a person', async () => {
  api.draftTeamRoutes.mockResolvedValue({ result: 'ok', picks: [pick], left: 0 })
  api.listTasks.mockResolvedValue([task])
  await render('route')
  expect(api.draftTeamRoutes).toHaveBeenCalledExactlyOnceWith('p')
  expect(api.updateTask).not.toHaveBeenCalled(); expect(api.assignTask).not.toHaveBeenCalled()
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save team choices')!.click())
  expect(api.updateTask).toHaveBeenCalledExactlyOnceWith('t', { team_id: 'b' })
  expect(api.assignTask).not.toHaveBeenCalled()
})
it('reviews only receiving-team members and saves only after confirmation', async () => {
  api.draftLeadAssignees.mockResolvedValue({ result: 'ok', picks: [pick], left: 0 })
  api.listTasks.mockResolvedValue([{ ...task, routing_state: 'released' }])
  await render('lead')
  expect(api.draftLeadAssignees).toHaveBeenCalledExactlyOnceWith('p')
  expect(document.querySelector('select')!.textContent).toContain('inside')
  expect(document.querySelector('select')!.textContent).not.toContain('outside')
  expect(api.assignTask).not.toHaveBeenCalled()
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save assignments')!.click())
  expect(api.assignTask).toHaveBeenCalledExactlyOnceWith('t', 'p', 'inside')
  expect(api.updateTask).not.toHaveBeenCalled()
})
it('does not apply a reviewed route after its task has been released', async () => {
  api.draftTeamRoutes.mockResolvedValue({ result: 'ok', picks: [pick], left: 0 })
  api.listTasks.mockResolvedValue([{ ...task, routing_state: 'released' }])
  await render('route')
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save team choices')!.click())
  expect(api.updateTask).not.toHaveBeenCalled(); expect(api.assignTask).not.toHaveBeenCalled()
})


it('saves an explicitly cleared destination as null even when it is the only change', async () => {
  api.draftTeamRoutes.mockResolvedValue({ result: 'ok', picks: [pick], left: 0 })
  api.listTasks.mockResolvedValue([task])
  await render('route')
  await act(async () => {
    const select = document.querySelector('select')!
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save team choices')!
  expect(save.disabled).toBe(false)
  expect(api.updateTask).not.toHaveBeenCalled()
  await act(async () => save.click())
  expect(api.updateTask).toHaveBeenCalledExactlyOnceWith('t', { team_id: null })
  expect(api.assignTask).not.toHaveBeenCalled()
})

it('does not treat an unmatched AI suggestion as an explicit team clearing', async () => {
  api.draftTeamRoutes.mockResolvedValue({ result: 'ok', picks: [{ ...pick, teamId: null, kind: 'none' }], left: 0 })
  await render('route')
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Save team choices')!.disabled).toBe(true)
  expect(api.updateTask).not.toHaveBeenCalled()
})
