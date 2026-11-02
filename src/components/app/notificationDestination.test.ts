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
