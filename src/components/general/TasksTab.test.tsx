// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TasksTab } from './TasksTab'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
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
    await act(async () => root.render(<TasksTab state={state} layout="board" onLayout={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={open} />))
    const planning = container.querySelector('[aria-label="Your unsent bugs"]')
    expect(planning?.textContent).toContain('Own planning bug')
    expect(planning?.textContent).toContain('Own review bug')
    expect(container.textContent).not.toContain('Another QA bug')
    expect(container.textContent).not.toContain('Regular private task')
    expect(planning?.querySelector('select, input')).toBeNull()
    expect(planning?.textContent).not.toMatch(/Send to team|Send for review|Return to planning/)
    await act(async () => [...planning!.querySelectorAll('button')].find(button => button.textContent === 'Own planning bug')!.click())
    expect(open).toHaveBeenCalledExactlyOnceWith('own')
    await act(async () => root.render(<TasksTab state={{ ...state, myRole: 'member' }} layout="board" onLayout={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={open} />))
    expect(container.querySelector('[aria-label="Your unsent bugs"]')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})
