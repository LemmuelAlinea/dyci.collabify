import { describe, expect, it } from 'vitest'
import {
  addDays,
  burndown,
  dayDiff,
  daysLeft,
  daysLeftLabel,
  finishedSprints,
  nextSprintDraft,
  plannedSprints,
  runningSprint,
  sprintCounts,
  sprintLength,
} from './sprints'
import type { Sprint, WorkItem } from './types'

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: 's1',
  name: 'Sprint 1',
  goal: '',
  starts_on: '2026-10-05',
  ends_on: '2026-10-18',
  state: 'planned',
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 't1',
  title: 'Task',
  status: 'todo',
  due_at: null,
  done_at: null,
  sprint_id: 's1',
  milestone_id: null,
  rank: 1,
  holders: [],
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

/** Local noon on a day, so time zones cannot tip it into the next one. */
const noon = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

describe('dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-10-05', -5)).toBe('2026-09-30')
  })
  it('counts the days between two dates', () => {
    expect(dayDiff('2026-10-05', '2026-10-18')).toBe(13)
    expect(dayDiff('2026-10-18', '2026-10-05')).toBe(-13)
  })
  it('measures a sprint in days, both ends counted', () => {
    expect(sprintLength(sprint())).toBe(14)
  })
})

describe('picking sprints', () => {
  const list = [
    sprint({ id: 'b', state: 'planned', starts_on: '2026-11-02' }),
    sprint({ id: 'a', state: 'planned', starts_on: '2026-10-19' }),
    sprint({ id: 'r', state: 'active' }),
    sprint({ id: 'f1', state: 'completed', completed_at: '2026-09-01T00:00:00Z' }),
    sprint({ id: 'f2', state: 'completed', completed_at: '2026-09-20T00:00:00Z' }),
  ]
  it('finds the running sprint', () => {
    expect(runningSprint(list)?.id).toBe('r')
    expect(runningSprint([sprint()])).toBeNull()
  })
  it('lists planned sprints soonest first', () => {
    expect(plannedSprints(list).map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('lists finished sprints newest first', () => {
    expect(finishedSprints(list).map((s) => s.id)).toEqual(['f2', 'f1'])
  })
})

describe('days left', () => {
  it('counts today and the last day', () => {
    expect(daysLeft(sprint(), noon('2026-10-16'))).toBe(3)
    expect(daysLeft(sprint(), noon('2026-10-18'))).toBe(1)
    expect(daysLeft(sprint(), noon('2026-10-19'))).toBe(0)
    expect(daysLeft(sprint(), noon('2026-10-21'))).toBe(-2)
  })
  it('says it in words', () => {
    expect(daysLeftLabel(3)).toBe('3 days left')
    expect(daysLeftLabel(1)).toBe('Last day')
    expect(daysLeftLabel(0)).toBe('Ended yesterday')
    expect(daysLeftLabel(-2)).toBe('Ended 3 days ago')
  })
})

describe('nextSprintDraft', () => {
  it('starts today when there are no sprints', () => {
    expect(nextSprintDraft([], noon('2026-10-06'))).toEqual({
      name: 'Sprint 1',
      goal: '',
      startsOn: '2026-10-06',
      endsOn: '2026-10-19',
    })
  })
  it('starts the day after the latest sprint ends', () => {
    const draft = nextSprintDraft([sprint(), sprint({ id: 's2', ends_on: '2026-11-01' })], noon('2026-10-06'))
    expect(draft.name).toBe('Sprint 3')
    expect(draft.startsOn).toBe('2026-11-02')
    expect(draft.endsOn).toBe('2026-11-15')
  })
  it('never starts in the past', () => {
    expect(nextSprintDraft([sprint({ ends_on: '2026-01-10' })], noon('2026-10-06')).startsOn).toBe('2026-10-06')
  })
})

describe('sprintCounts', () => {
  it('counts a sprint\'s tasks and the done ones', () => {
    const items = [item(), item({ id: 't2', status: 'done' }), item({ id: 't3', sprint_id: null })]
    expect(sprintCounts(items, 's1')).toEqual({ done: 1, total: 2 })
  })
})

describe('burndown', () => {
  const items = [
    item({ id: 'a', status: 'done', done_at: new Date(noon('2026-10-06')).toISOString() }),
    item({ id: 'b', status: 'done', done_at: new Date(noon('2026-10-07')).toISOString() }),
    item({ id: 'c' }),
    item({ id: 'x', sprint_id: 'other' }),
  ]
  it('counts what is still open at the end of each day so far', () => {
    expect(burndown(sprint({ state: 'active' }), items, noon('2026-10-07'))).toEqual([
      { day: '2026-10-05', left: 3 },
      { day: '2026-10-06', left: 2 },
      { day: '2026-10-07', left: 1 },
    ])
  })
  it('is empty before the sprint starts', () => {
    expect(burndown(sprint(), items, noon('2026-10-01'))).toEqual([])
  })
  it('stops at the sprint\'s last day', () => {
    expect(burndown(sprint({ ends_on: '2026-10-06' }), items, noon('2026-10-20'))).toHaveLength(2)
  })
})
