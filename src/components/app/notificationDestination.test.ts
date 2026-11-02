import { expect, it } from 'vitest'
import { destination } from './notificationDestination'
import type { AppNotification } from '../../lib/types'

const note = (over: Partial<AppNotification>) => ({ type: 'milestone_overdue', title: '', general_project_id: null, ...over }) as AppNotification

it('opens the project\'s Milestones for an overdue milestone, with no milestone in the address', () => {
  expect(destination(note({ general_project_id: 'p1' }), 'member', false)).toBe('/projects/p1?tab=plan&work=milestones')
})

it('falls back to Home when the notification names no project', () => {
  expect(destination(note({}), 'member', false)).toBe('/home')
})

it('opens the Sprints view for a sprint ending soon and a finished sprint', () => {
  for (const type of ['sprint_ending_soon', 'sprint_completed'] as const) {
    expect(destination(note({ type, general_project_id: 'p1' }), 'member', false)).toBe('/projects/p1?tab=plan&work=sprints')
    expect(destination(note({ type }), 'member', false)).toBe('/home')
  }
})

it('opens the Milestones view for a milestone due soon', () => {
  expect(destination(note({ type: 'milestone_due_soon', general_project_id: 'p1' }), 'member', false)).toBe('/projects/p1?tab=plan&work=milestones')
  expect(destination(note({ type: 'milestone_due_soon' }), 'member', false)).toBe('/home')
})

it('opens the task for an overdue task notice and the Tasks tab for the planner summary', () => {
  const overdue = (over: Partial<AppNotification>) => note({ type: 'general_task_overdue', general_project_id: 'p1', ...over })
  expect(destination(overdue({ general_task_id: 't9' }), 'member', false)).toBe('/projects/p1?task=t9')
  expect(destination(overdue({}), 'member', false)).toBe('/projects/p1?tab=tasks')
  expect(destination(note({ type: 'general_task_overdue' }), 'member', false)).toBe('/home')
})
