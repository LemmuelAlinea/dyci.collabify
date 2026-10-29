// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TasksTab } from './TasksTab'
import { WorkTab } from './WorkTab'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { GeneralProjectState } from './useGeneralProject'

vi.mock('../../lib/api/general', () => ({ sendTasksToTeams: vi.fn(), sendTasksToCoordinator: vi.fn(), returnWorkTask: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./TaskDialog', () => ({ TaskDialog: () => null }))
vi.mock('./LeadInbox', () => ({ LeadInbox: () => null }))
vi.mock('./workSource', () => ({ generalWorkSource: () => ({}) }))
vi.mock('./TasksFromNotes', () => ({ TasksFromNotes: () => null }))
vi.mock('./AssignByPosition', () => ({ AssignByPosition: () => null }))

it('keeps only the QA creators own unsent bugs reachable without planner actions', async () => {
  const task = { id: 'own', title: 'Own planning bug', kind: 'bug', routing_state: 'planning', created_by: 'qa', team_id: null, assignee_ids: [], status: 'todo', description: '', archived_at: null }
  const state = { project: { id: 'project', class_board_id: null }, myRole: 'qa', viewerId: 'qa', readOnly: false,
    tasks: [task, { ...task, id: 'review', title: 'Own review bug', routing_state: 'coordinator_review' }, { ...task, id: 'other', title: 'Another QA bug', created_by: 'other' }, { ...task, id: 'regular', title: 'Regular private task', kind: 'task' }],
    teams: [], teamMembers: [], members: [], sprints: [], milestones: [], can: () => false, qaBlocks: () => false,
  } as unknown as GeneralProjectState
  const open = vi.fn()
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<TasksTab state={state} layout="board" onLayout={vi.fn()} onViewBoard={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={open} />))
    const planning = container.querySelector('[aria-label="Your unsent bugs"]')
    expect(planning?.textContent).toContain('Own planning bug')
    expect(planning?.textContent).toContain('Own review bug')
    expect(container.textContent).not.toContain('Another QA bug')
    expect(container.textContent).not.toContain('Regular private task')
    expect(planning?.querySelector('select, input')).toBeNull()
    expect(planning?.textContent).not.toMatch(/Send to team|Send for review|Return to planning/)
    await act(async () => [...planning!.querySelectorAll('button')].find(button => button.textContent === 'Own planning bug')!.click())
    expect(open).toHaveBeenCalledExactlyOnceWith('own')
    await act(async () => root.render(<TasksTab state={{ ...state, myRole: 'member' }} layout="board" onLayout={vi.fn()} onViewBoard={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={open} />))
    expect(container.querySelector('[aria-label="Your unsent bugs"]')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('reveals a sent backlog task on the board only when the notice action is chosen', async () => {
  const task = { id: 'sent', title: 'Sent task', kind: 'task', routing_state: 'planning', team_id: 'destination', assignee_ids: [], status: 'todo', stage: 0, description: '', sprint_id: null, updated_at: 'stamp', archived_at: null }
  const state = { project: { id: 'discovery', class_board_id: null }, myRole: 'coordinator', viewerId: 'coordinator', readOnly: false,
    tasks: [task, { ...task, id: 'existing', title: 'Existing work', routing_state: 'released' }],
    teams: [{ id: 'destination', name: 'Destination', leader_id: 'lead' }, { id: 'other', name: 'Other', leader_id: 'coordinator' }], teamMembers: [], members: [], sprints: [{ id: 'running', name: 'Running', state: 'active' }], milestones: [], can: () => false, qaBlocks: () => false, leadsUser: () => false, nameOf: (id: string) => id,
    reload: async () => { task.routing_state = 'released'; state.tasks = [...state.tasks] },
  } as unknown as GeneralProjectState
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  function Harness() {
    const location = useLocation()
    return <><output aria-label="Current URL">{location.search}</output><WorkTab state={state} area="tasks" /></>
  }
  async function click(text: string) { await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label')?.startsWith(text))!.click()) }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/?tab=tasks&scope=running&layout=list&keep=yes"]}><Harness /></MemoryRouter>))
    await click('Filter tasks' )
    const selects = container.querySelector('[role="dialog"]')!.querySelectorAll('select')
    await act(async () => { ['other', 'nobody', '1', 'bug'].forEach((value, i) => { selects[i].value = value; selects[i].dispatchEvent(new Event('change', { bubbles: true })) }); const input = container.querySelector('input[type="search"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'missing'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await click('Send to team')
    expect(container.querySelector('output')!.textContent).toContain('scope=running')
    expect(container.querySelector('output')!.textContent).toContain('layout=list')
    expect(container.querySelector('[aria-label="Open Sent task"]')).toBeNull()
    await click('View on board')
    expect(container.querySelector('output')!.textContent).toContain('scope=all')
    expect(container.querySelector('output')!.textContent).toContain('layout=board')
    expect(container.querySelector('output')!.textContent).toContain('keep=yes')
    expect(container.querySelector('[aria-label="Open Sent task"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Filter tasks"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})
