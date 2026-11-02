import { describe, expect, it } from 'vitest'
import { dueInLabel, dueLine, milestoneProgress, milestoneStatus, reachedIn, sortMilestones, waitingFor } from './milestones'
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

describe('milestoneStatus in manual mode', () => {
  it('is ready when every tagged task is done and nobody has marked it reached', () => {
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-15'), 'manual')).toBe('ready')
    // Ready wins over late: the work is finished, only the mark is missing.
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-25'), 'manual')).toBe('ready')
  })
  it('is reached once marked, whatever the tasks say', () => {
    const marked = ms({ reached_at: '2026-10-05T00:00:00Z' })
    expect(milestoneStatus(marked, { done: 0, total: 2 }, noon('2026-10-25'), 'manual')).toBe('reached')
    expect(milestoneStatus(marked, { done: 2, total: 2 }, noon('2026-10-25'), 'manual')).toBe('reached')
  })
  it('keeps late, at risk and upcoming while tasks are open or none are tagged', () => {
    expect(milestoneStatus(ms(), { done: 1, total: 2 }, noon('2026-10-21'), 'manual')).toBe('late')
    expect(milestoneStatus(ms(), { done: 0, total: 0 }, noon('2026-10-20'), 'manual')).toBe('at_risk')
    expect(milestoneStatus(ms(), { done: 2, total: 4 }, noon('2026-10-15'), 'manual')).toBe('upcoming')
  })
  it('leaves automatic mode as it was, and automatic is the default', () => {
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-15'), 'automatic')).toBe('reached')
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-15'))).toBe('reached')
  })
})

describe('an undated milestone', () => {
  const undated = ms({ due_on: null })
  it('is never late or at risk', () => {
    expect(milestoneStatus(undated, { done: 0, total: 3 }, noon('2030-01-01'))).toBe('upcoming')
    expect(milestoneStatus(undated, { done: 0, total: 0 }, noon('2030-01-01'), 'manual')).toBe('upcoming')
  })
  it('still reads reached and ready', () => {
    expect(milestoneStatus(undated, { done: 1, total: 1 }, noon('2030-01-01'))).toBe('reached')
    expect(milestoneStatus(undated, { done: 1, total: 1 }, noon('2030-01-01'), 'manual')).toBe('ready')
  })
  it('says there is no due date', () => {
    expect(dueLine(null, noon('2026-10-15'))).toBe('No due date')
    expect(dueLine('2026-10-20', noon('2026-10-15'))).toMatch(/in 5 days$/)
  })
  it('sorts after every dated milestone, oldest first among themselves', () => {
    const list = sortMilestones([
      ms({ id: 'u2', due_on: null, created_at: '2026-10-03T00:00:00Z' }),
      ms({ id: 'late', due_on: '2027-01-01' }),
      ms({ id: 'u1', due_on: null, created_at: '2026-10-02T00:00:00Z' }),
      ms({ id: 'soon', due_on: '2026-10-20' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['soon', 'late', 'u1', 'u2'])
  })
})

describe('waitingFor', () => {
  const a = ms({ id: 'a', name: 'Alpha', due_on: '2026-10-10' })
  const b = ms({ id: 'b', name: 'Beta', due_on: '2026-10-20' })
  const c = ms({ id: 'c', name: 'Gamma', due_on: '2026-10-30', reached_at: '2026-10-05T00:00:00Z' })
  const all = [b, c, a]
  it('lists the milestones it waits for that are not reached, soonest first', () => {
    const deps = [
      { milestone_id: 'd', depends_on_id: 'b' },
      { milestone_id: 'd', depends_on_id: 'a' },
      { milestone_id: 'd', depends_on_id: 'c' },
      { milestone_id: 'other', depends_on_id: 'a' },
    ]
    expect(waitingFor(ms({ id: 'd' }), deps, all).map((m) => m.id)).toEqual(['a', 'b'])
  })
  it('is empty with no links, or when every blocker is reached', () => {
    expect(waitingFor(ms({ id: 'd' }), [], all)).toEqual([])
    expect(waitingFor(ms({ id: 'd' }), [{ milestone_id: 'd', depends_on_id: 'c' }], all)).toEqual([])
  })
  it('skips a blocker that is not in the list', () => {
    expect(waitingFor(ms({ id: 'd' }), [{ milestone_id: 'd', depends_on_id: 'gone' }], all)).toEqual([])
  })
})
