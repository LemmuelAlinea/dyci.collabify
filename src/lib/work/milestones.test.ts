import { describe, expect, it } from 'vitest'
import { dueInLabel, milestoneProgress, milestoneStatus, reachedIn, sortMilestones } from './milestones'
import type { Milestone } from './types'

const noon = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}
const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm', name: 'Beta', description: '', due_on: '2026-10-20', reached_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('milestoneProgress', () => {
  it('counts tagged tasks and the done ones', () => {
    const items = [
      { milestone_id: 'm', status: 'done' as const },
      { milestone_id: 'm', status: 'todo' as const },
      { milestone_id: 'm', status: 'in_progress' as const },
      { milestone_id: null, status: 'done' as const },
    ]
    expect(milestoneProgress(items, 'm')).toEqual({ done: 1, total: 3, pct: 33 })
  })
  it('is zero with nothing tagged', () => {
    expect(milestoneProgress([], 'm')).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('milestoneStatus', () => {
  it('is reached when marked, or when every tagged task is done', () => {
    expect(milestoneStatus(ms({ reached_at: '2026-10-05T00:00:00Z' }), { done: 0, total: 2 }, noon('2026-10-25'))).toBe('reached')
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-25'))).toBe('reached')
  })
  it('is late once the day has passed', () => {
    expect(milestoneStatus(ms(), { done: 1, total: 2 }, noon('2026-10-21'))).toBe('late')
  })
  it('is at risk inside a week with under half done or nothing tagged', () => {
    expect(milestoneStatus(ms(), { done: 0, total: 4 }, noon('2026-10-15'))).toBe('at_risk')
    expect(milestoneStatus(ms(), { done: 0, total: 0 }, noon('2026-10-20'))).toBe('at_risk')
  })
  it('is upcoming otherwise', () => {
    expect(milestoneStatus(ms(), { done: 2, total: 4 }, noon('2026-10-15'))).toBe('upcoming')
    expect(milestoneStatus(ms(), { done: 0, total: 4 }, noon('2026-10-01'))).toBe('upcoming')
  })
})

describe('milestoneStatus boundaries', () => {
  it('is at risk exactly seven days out with under half done', () => {
    expect(milestoneStatus(ms(), { done: 1, total: 3 }, noon('2026-10-13'))).toBe('at_risk')
  })
  it('is upcoming eight days out, however little is done', () => {
    expect(milestoneStatus(ms(), { done: 0, total: 3 }, noon('2026-10-12'))).toBe('upcoming')
  })
  it('is upcoming inside the week with exactly half done', () => {
    expect(milestoneStatus(ms(), { done: 2, total: 4 }, noon('2026-10-18'))).toBe('upcoming')
  })
  it('is at risk on the day it is due with partial progress', () => {
    expect(milestoneStatus(ms(), { done: 1, total: 3 }, noon('2026-10-20'))).toBe('at_risk')
  })
})

describe('reachedIn', () => {
  it('reads reached the way the view does: marked, or every tagged task done', () => {
    const items = [
      { milestone_id: 'a', status: 'done' as const },
      { milestone_id: 'b', status: 'done' as const },
      { milestone_id: 'b', status: 'todo' as const },
    ]
    const reached = reachedIn(items)
    expect(reached(ms({ id: 'a' }))).toBe(true)
    expect(reached(ms({ id: 'b' }))).toBe(false)
    expect(reached(ms({ id: 'b', reached_at: '2026-10-05T00:00:00Z' }))).toBe(true)
  })
})

describe('dueInLabel', () => {
  it('says when it is due in words', () => {
    expect(dueInLabel('2026-10-20', noon('2026-10-15'))).toBe('in 5 days')
    expect(dueInLabel('2026-10-20', noon('2026-10-19'))).toBe('tomorrow')
    expect(dueInLabel('2026-10-20', noon('2026-10-20'))).toBe('today')
    expect(dueInLabel('2026-10-20', noon('2026-10-21'))).toBe('yesterday')
    expect(dueInLabel('2026-10-20', noon('2026-10-24'))).toBe('4 days ago')
  })
})

describe('sortMilestones', () => {
  it('orders by date, then by when it was made', () => {
    const list = sortMilestones([
      ms({ id: 'c', due_on: '2026-11-01' }),
      ms({ id: 'b', due_on: '2026-10-20', created_at: '2026-10-02T00:00:00Z' }),
      ms({ id: 'a', due_on: '2026-10-20', created_at: '2026-10-01T00:00:00Z' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})
