import { describe, expect, it } from 'vitest'
import { milestoneGrid, needsYou, nextMilestone } from './summary'
import type { Milestone, WorkItem } from './types'

const NOW = new Date(2026, 9, 10, 12).getTime()
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'a', title: 'A', status: 'todo', due_at: null, done_at: null, sprint_id: null,
  milestone_id: null, rank: 1, holders: ['Ana'], created_at: '2026-10-01T00:00:00Z', ...over,
})
const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm', name: 'Beta', description: '', due_on: '2026-10-30', reached_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('needsYou', () => {
  it('lists your unfinished tasks past their due date, earliest first', () => {
    const items = [
      item({ id: 'late2', title: 'Late two', due_at: at(-1) }),
      item({ id: 'late1', title: 'Late one', due_at: at(-3) }),
      item({ id: 'doneLate', due_at: at(-2), status: 'done' }),
      item({ id: 'theirs', due_at: at(-2) }),
    ]
    const n = needsYou(items, new Set(['late1', 'late2', 'doneLate']), NOW)
    expect(n.overdue.map((i) => i.id)).toEqual(['late1', 'late2'])
  })

  it('lists your unfinished tasks due within a week, earliest first', () => {
    const items = [
      item({ id: 'six', due_at: at(6) }),
      item({ id: 'two', due_at: at(2) }),
      item({ id: 'eight', due_at: at(8) }),
      item({ id: 'undated' }),
      item({ id: 'doneSoon', due_at: at(1), status: 'done' }),
    ]
    const n = needsYou(items, new Set(['six', 'two', 'eight', 'undated', 'doneSoon']), NOW)
    expect(n.dueSoon.map((i) => i.id)).toEqual(['two', 'six'])
    expect(n.overdue).toEqual([])
  })

  it('lists every unfinished task nobody holds, yours or not', () => {
    const items = [
      item({ id: 'nobody', holders: [], due_at: at(4) }),
      item({ id: 'nobodyUndated', holders: [] }),
      item({ id: 'nobodyDone', holders: [], status: 'done' }),
      item({ id: 'held' }),
    ]
    const n = needsYou(items, new Set(), NOW)
    expect(n.unheld.map((i) => i.id)).toEqual(['nobody', 'nobodyUndated'])
  })
})

describe('nextMilestone', () => {
  it('is the earliest milestone not yet reached, with its progress', () => {
    const milestones = [
      ms({ id: 'later', due_on: '2026-11-20' }),
      ms({ id: 'soon', due_on: '2026-10-25' }),
      ms({ id: 'doneEarly', due_on: '2026-10-12' }),
      ms({ id: 'marked', due_on: '2026-10-11', reached_at: '2026-10-09T00:00:00Z' }),
    ]
    const items = [
      item({ id: '1', milestone_id: 'doneEarly', status: 'done' }),
      item({ id: '2', milestone_id: 'soon', status: 'done' }),
      item({ id: '3', milestone_id: 'soon' }),
    ]
    const next = nextMilestone(milestones, items, NOW)
    expect(next?.milestone.id).toBe('soon')
    expect(next).toMatchObject({ done: 1, total: 2, pct: 50, status: 'upcoming' })
  })

  it('puts a late milestone first, since it is still not reached', () => {
    const next = nextMilestone([ms({ id: 'past', due_on: '2026-10-01' }), ms({ id: 'future' })], [], NOW)
    expect(next?.milestone.id).toBe('past')
    expect(next?.status).toBe('late')
  })

  it('is null with no milestones, or when every one is reached', () => {
    expect(nextMilestone([], [], NOW)).toBeNull()
    expect(nextMilestone([ms({ reached_at: '2026-10-09T00:00:00Z' })], [], NOW)).toBeNull()
  })
})

describe('milestoneGrid', () => {
  it('gives one row per group and one cell per milestone in date order', () => {
    const milestones = [ms({ id: 'final', due_on: '2026-12-01' }), ms({ id: 'draft', due_on: '2026-10-14' })]
    const groups = [
      { id: 'g1', name: 'Group 1', items: [item({ id: 'x', milestone_id: 'draft', status: 'done' })] },
      { id: 'g2', name: 'Group 2', items: [item({ id: 'y', milestone_id: 'draft' }), item({ id: 'z', milestone_id: 'final' })] },
    ]
    const grid = milestoneGrid(milestones, groups, NOW)
    expect(grid.milestones.map((m) => m.id)).toEqual(['draft', 'final'])
    expect(grid.rows.map((r) => r.id)).toEqual(['g1', 'g2'])
    expect(grid.rows[0].cells).toEqual([
      { milestoneId: 'draft', done: 1, total: 1, pct: 100, status: 'reached' },
      { milestoneId: 'final', done: 0, total: 0, pct: 0, status: 'upcoming' },
    ])
    expect(grid.rows[1].cells[0]).toEqual({ milestoneId: 'draft', done: 0, total: 1, pct: 0, status: 'at_risk' })
  })

  it('has no rows without groups and no cells without milestones', () => {
    expect(milestoneGrid([ms()], [], NOW).rows).toEqual([])
    expect(milestoneGrid([], [{ id: 'g', name: 'G', items: [] }], NOW).rows[0].cells).toEqual([])
  })
})
