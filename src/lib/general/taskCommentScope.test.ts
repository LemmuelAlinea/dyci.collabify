import { describe, expect, it } from 'vitest'
import { canCommentTask } from './permissions'
import type { TaskViewer } from './permissions'

const viewer = (over: Partial<TaskViewer> = {}): TaskViewer => ({
  viewerId: 'me',
  manageTasks: false,
  archived: false,
  leadsUser: () => false,
  role: 'member',
  ...over,
})
const task = (assignee_ids: string[]) => ({ assignee_ids, created_by: 'someone' })

describe('canCommentTask', () => {
  it('lets a member comment on a task they hold', () => {
    expect(canCommentTask(viewer(), task(['me']))).toBe(true)
  })

  it('stops a member commenting on someone else\'s task', () => {
    expect(canCommentTask(viewer(), task(['them']))).toBe(false)
  })

  it('stops a member commenting on a task nobody holds, even one they added', () => {
    expect(canCommentTask(viewer(), { assignee_ids: [], created_by: 'me' })).toBe(false)
  })

  it('lets a team lead comment on a task someone they lead holds', () => {
    expect(canCommentTask(viewer({ leadsUser: (id) => id === 'mate' }), task(['mate']))).toBe(true)
  })

  it('stops a team lead commenting outside their team', () => {
    expect(canCommentTask(viewer({ leadsUser: (id) => id === 'mate' }), task(['them']))).toBe(false)
  })

  it.each(['pm', 'coordinator', 'qa'] as const)('lets a %s comment on any task', (role) => {
    expect(canCommentTask(viewer({ role }), task(['them']))).toBe(true)
  })

  it('lets a member with the manage tasks grant comment on any task', () => {
    expect(canCommentTask(viewer({ manageTasks: true }), task(['them']))).toBe(true)
  })

  it('stops a read-only viewer', () => {
    expect(canCommentTask(viewer({ archived: true, role: 'pm' }), task(['them']))).toBe(false)
  })

  it('leaves a class board as it was', () => {
    expect(canCommentTask(viewer({ role: null }), task(['them']))).toBe(true)
  })
})
