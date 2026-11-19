import { describe, expect, it } from 'vitest'
import { incomingTasks, routingViewer, routingWaitingCount, showsRouting } from './routing'
import type { GeneralTask } from './types'

const task = (over: Partial<GeneralTask>): GeneralTask => ({
  id: 'x', title: 'Task', team_id: null, assignee_ids: [], routing_state: 'planning', reviewer_id: null,
  parent_id: null, status: 'todo', archived_at: null, ...over,
} as unknown as GeneralTask)

const tasks = [
  task({ id: 'plan1' }),
  task({ id: 'plan2' }),
  task({ id: 'planSub', parent_id: 'plan1' }),
  task({ id: 'reviewMine', routing_state: 'coordinator_review', reviewer_id: 'coord' }),
  task({ id: 'reviewOther', routing_state: 'coordinator_review', reviewer_id: 'coord2' }),
  task({ id: 'reviewSub', routing_state: 'coordinator_review', reviewer_id: 'coord', parent_id: 'reviewMine' }),
  task({ id: 'released', routing_state: 'released', team_id: 'a' }),
]

const viewer = (role: 'pm' | 'coordinator' | 'member' | 'qa' | 'stakeholder' | null, over: { viewerId?: string; active?: boolean; readOnly?: boolean } = {}) =>
  routingViewer({
    viewerId: over.viewerId ?? role ?? undefined,
    myRole: role,
    readOnly: over.readOnly ?? false,
    members: over.active === false ? [{ role: 'coordinator', profile: { status: 'inactive' } }] : [{ role: 'coordinator', profile: { status: 'active' } }],
  })

describe('routingWaitingCount', () => {
  it('counts Planning, not subtasks, and no review rows for a PM while a coordinator is active', () => {
    expect(routingWaitingCount(viewer('pm'), tasks)).toBe(2)
  })

  it('adds every review row for a PM with no active coordinator', () => {
    expect(routingWaitingCount(viewer('pm', { active: false }), tasks)).toBe(4)
  })

  it('adds only the review rows sent to the coordinator', () => {
    expect(routingWaitingCount(viewer('coordinator', { viewerId: 'coord' }), tasks)).toBe(3)
    expect(routingWaitingCount(viewer('coordinator', { viewerId: 'coord3' }), tasks)).toBe(2)
  })

  it('is zero for anyone who does not route, and on a read-only project', () => {
    for (const role of ['member', 'qa', 'stakeholder', null] as const) expect(routingWaitingCount(viewer(role), tasks)).toBe(0)
    expect(routingWaitingCount(viewer('pm', { readOnly: true }), tasks)).toBe(0)
  })

  it('is zero with nothing waiting', () => {
    expect(routingWaitingCount(viewer('pm'), [task({ routing_state: 'released' })])).toBe(0)
  })
})

describe('incomingTasks', () => {
  const teams = [{ id: 'a', leader_id: 'lead' }, { id: 'b', leader_id: 'other' }]
  const rows = [
    task({ id: 'in', routing_state: 'released', team_id: 'a' }),
    task({ id: 'held', routing_state: 'released', team_id: 'a', assignee_ids: ['m'] }),
    task({ id: 'done', routing_state: 'released', team_id: 'a', status: 'done' }),
    task({ id: 'otherTeam', routing_state: 'released', team_id: 'b' }),
    task({ id: 'planning', team_id: 'a' }),
  ]

  it('lists released, unheld, open tasks for the teams the viewer leads', () => {
    expect(incomingTasks('lead', teams, rows).map(t => t.id)).toEqual(['in'])
  })

  it('is empty for a viewer who leads no team', () => {
    expect(incomingTasks('member', teams, rows)).toEqual([])
    expect(incomingTasks(undefined, [{ id: 'a', leader_id: null }], rows)).toEqual([])
  })
})

describe('showsRouting', () => {
  it('always shows Plan & route in a planned project', () => {
    expect(showsRouting('planned', [])).toBe(true)
    expect(showsRouting(undefined, [])).toBe(true)
  })

  it('shows it in an open project only while live work waits in planning or review', () => {
    expect(showsRouting('open', [task({ routing_state: 'released' })])).toBe(false)
    expect(showsRouting('open', [task({ routing_state: 'planning', archived_at: '2026-11-01' })])).toBe(false)
    expect(showsRouting('open', [task({ routing_state: 'planning' })])).toBe(true)
    expect(showsRouting('open', [task({ routing_state: 'coordinator_review' })])).toBe(true)
  })
})
