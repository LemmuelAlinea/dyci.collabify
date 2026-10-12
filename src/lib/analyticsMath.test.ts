import { describe, expect, it } from 'vitest'
import {
  activeByWeek,
  addDays,
  burnupSeries,
  completionByWeek,
  daysBetween,
  gini,
  healthTone,
  isStuck,
  lastWeeks,
  manilaDay,
  milestoneState,
  mondayOf,
  onTimeByWeek,
  studentFlags,
  weeklyActivity,
} from './analyticsMath'
import type { FlagInput } from './analyticsMath'
import type { ActivityDay } from './types'

const ev = (day: string, kind: ActivityDay['kind'], n = 1, actor = 's1'): ActivityDay => ({
  class_id: 'c', project_id: 'p', board_id: 'b', actor_id: actor, day, kind, n,
})

describe('dates', () => {
  it('reads an instant as the Manila day, not the UTC day', () => {
    expect(manilaDay('2026-03-01T17:30:00Z')).toBe('2026-03-02')
    expect(manilaDay('2026-03-01T15:59:00Z')).toBe('2026-03-01')
  })
  it('adds days across a month end', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3)
  })
  it('finds the Monday of a week, Sunday included', () => {
    expect(mondayOf('2026-10-13')).toBe('2026-10-12') // Tuesday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12') // Sunday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12') // Monday
  })
  it('lists the last n Mondays oldest first', () => {
    expect(lastWeeks('2026-10-13', 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
  })
})

describe('gini', () => {
  it('is zero for an even split', () => {
    expect(gini([25, 25, 25, 25])).toBe(0)
  })
  it('is 0.75 when one of four does everything', () => {
    expect(gini([0, 0, 0, 100])).toBe(0.75)
  })
  it('is 0.5 when one of two does everything', () => {
    expect(gini([0, 100])).toBe(0.5)
  })
  it('is zero for one member or nothing at all, never a false alarm', () => {
    expect(gini([100])).toBe(0)
    expect(gini([])).toBe(0)
    expect(gini([0, 0])).toBe(0)
  })
})

describe('weeklyActivity', () => {
  it('splits work from talk and zero-fills empty weeks', () => {
    const rows = [
      ev('2026-10-05', 'finished', 2),
      ev('2026-10-06', 'commented', 3),
      ev('2026-10-19', 'started'),
      ev('2026-10-19', 'edited', 9), // neither work nor talk
    ]
    expect(weeklyActivity(rows, '2026-10-05', '2026-10-20')).toEqual([
      { week: '2026-10-05', work: 2, talk: 3 },
      { week: '2026-10-12', work: 0, talk: 0 },
      { week: '2026-10-19', work: 1, talk: 0 },
    ])
  })
})

describe('burnupSeries', () => {
  const task = (created: string, done: string | null, status: 'todo' | 'in_progress' | 'done' = done ? 'done' : 'todo') => ({
    created_at: created, done_at: done, status,
  })

  it('counts scope and done per day, carrying earlier work into the first day', () => {
    const tasks = [
      task('2026-09-30T02:00:00Z', '2026-10-02T02:00:00Z'),
      task('2026-10-02T02:00:00Z', null),
    ]
    expect(burnupSeries(tasks, '2026-10-01', '2026-10-03')).toEqual([
      { day: '2026-10-01', scope: 1, done: 0 },
      { day: '2026-10-02', scope: 2, done: 1 },
      { day: '2026-10-03', scope: 2, done: 1 },
    ])
  })
  it('does not count a reopened task as done', () => {
    const tasks = [task('2026-10-01T02:00:00Z', '2026-10-01T05:00:00Z', 'in_progress')]
    expect(burnupSeries(tasks, '2026-10-01', '2026-10-01')).toEqual([
      { day: '2026-10-01', scope: 1, done: 0 },
    ])
  })
  it('is empty when the window has not begun', () => {
    expect(burnupSeries([], '2026-11-01', '2026-10-01')).toEqual([])
  })
})

describe('weekly series', () => {
  const tasks = [
    { created_at: '2026-09-29T02:00:00Z', done_at: '2026-10-06T02:00:00Z', status: 'done' as const, late: false },
    { created_at: '2026-09-29T02:00:00Z', done_at: '2026-10-07T02:00:00Z', status: 'done' as const, late: true },
    { created_at: '2026-10-13T02:00:00Z', done_at: null, status: 'todo' as const, late: false },
  ]
  const weeks = ['2026-09-28', '2026-10-05', '2026-10-12']

  it('completion is done over scope at each week end', () => {
    expect(completionByWeek(tasks, weeks)).toEqual([0, 100, 67])
  })
  it('on-time is the share finished in that week that was not late', () => {
    expect(onTimeByWeek(tasks, weeks)).toEqual([null, 50, null])
  })
  it('active counts each listed person once per week', () => {
    const rows = [ev('2026-10-05', 'started', 1, 's1'), ev('2026-10-06', 'finished', 1, 's1'),
                  ev('2026-10-06', 'commented', 1, 'prof')]
    expect(activeByWeek(rows, new Set(['s1', 's2']), weeks)).toEqual([0, 1, 0])
  })
})

describe('healthTone', () => {
  it.each([
    ['pace', 0, 'success'], ['pace', -19, 'warning'], ['pace', -20, 'danger'],
    ['overdue', 0, 'success'], ['overdue', 2, 'warning'], ['overdue', 3, 'danger'],
    ['gini', 0.29, 'success'], ['gini', 0.5, 'warning'], ['gini', 0.51, 'danger'],
    ['idle', 3, 'success'], ['idle', 6, 'warning'], ['idle', 7, 'danger'],
    ['returns', 0, 'success'], ['returns', 1, 'warning'], ['returns', 2, 'danger'],
  ] as const)('%s %d is %s', (measure, value, tone) => {
    expect(healthTone(measure, value)).toBe(tone)
  })
  it('is pending when there is nothing to measure', () => {
    expect(healthTone('idle', null)).toBe('pending')
  })
})

describe('studentFlags', () => {
  const now = new Date('2026-10-13T04:00:00Z')
  const base: FlagInput = {
    held: 4, done: 2, late: 0, lowestShare: 30, inAnyGroup: true,
    lastActiveAt: '2026-10-12T04:00:00Z', termStarted: true,
  }
  it('flags nothing for a student pulling their weight', () => {
    expect(studentFlags(base, now)).toEqual([])
  })
  it('flags someone in a group who holds nothing', () => {
    expect(studentFlags({ ...base, held: 0, done: 0 }, now)).toEqual(['holding_nothing'])
  })
  it('flags someone in no group, and not also as holding nothing', () => {
    expect(studentFlags({ ...base, inAnyGroup: false, held: 0, done: 0, lowestShare: null }, now))
      .toEqual(['no_group'])
  })
  it('flags a low share only where there is a group to share with', () => {
    expect(studentFlags({ ...base, lowestShare: 8 }, now)).toEqual(['low_share'])
    expect(studentFlags({ ...base, lowestShare: null }, now)).toEqual([])
  })
  it('flags a week without activity once the term has started', () => {
    expect(studentFlags({ ...base, lastActiveAt: '2026-10-06T04:00:00Z' }, now)).toEqual(['inactive'])
    expect(studentFlags({ ...base, lastActiveAt: null }, now)).toEqual(['inactive'])
    expect(studentFlags({ ...base, lastActiveAt: null, termStarted: false }, now)).toEqual([])
  })
  it('flags chronic lateness, not a single late task', () => {
    expect(studentFlags({ ...base, done: 10, late: 3 }, now)).toEqual(['often_late'])
    expect(studentFlags({ ...base, done: 10, late: 2 }, now)).toEqual([])
    expect(studentFlags({ ...base, done: 20, late: 3 }, now)).toEqual([])
  })
})

describe('milestoneState', () => {
  const m = { tasks: 2, done: 2, due_on: '2026-10-10', last_done_at: '2026-10-10T10:00:00Z' }
  it('is met when everything was done by the date', () => {
    expect(milestoneState(m, '2026-10-13')).toBe('met')
  })
  it('is late when it was finished after the date', () => {
    expect(milestoneState({ ...m, last_done_at: '2026-10-10T17:00:00Z' }, '2026-10-13')).toBe('late')
  })
  it('is late when the date passed with work open, upcoming before it', () => {
    expect(milestoneState({ ...m, done: 1 }, '2026-10-11')).toBe('late')
    expect(milestoneState({ ...m, done: 1 }, '2026-10-10')).toBe('upcoming')
  })
  it('says so when no task is tagged to it', () => {
    expect(milestoneState({ ...m, tasks: 0, done: 0, last_done_at: null }, '2026-10-13')).toBe('no_tasks')
  })
})

describe('isStuck', () => {
  const now = new Date('2026-10-13T04:00:00Z')
  it('is a task in progress for a week or more', () => {
    expect(isStuck({ status: 'in_progress', started_at: '2026-10-06T04:00:00Z' }, now)).toBe(true)
    expect(isStuck({ status: 'in_progress', started_at: '2026-10-07T04:00:00Z' }, now)).toBe(false)
    expect(isStuck({ status: 'done', started_at: '2026-09-01T04:00:00Z' }, now)).toBe(false)
  })
})
