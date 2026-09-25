import { describe, expect, it } from 'vitest'
import { comingUp, dayLabel, dueCounts, myTasks, recentProjects, requestsToAnswer } from './dashboard'
import type { DashProject, DashTask } from './dashboard'

const NOW = new Date(2026, 8, 25, 10, 0).getTime()
const hours = (h: number) => new Date(NOW + h * 3600_000).toISOString()

function task(over: Partial<DashTask> = {}): DashTask {
  return {
    id: 't',
    project_id: 'p',
    title: 'A task',
    status: 'todo',
    due_at: null,
    assignee_ids: ['me'],
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function project(over: Partial<DashProject> = {}): DashProject {
  return {
    id: 'p',
    name: 'A project',
    status: 'in_progress',
    ends_on: null,
    updated_at: '2026-09-01T00:00:00Z',
    my_level: 'member',
    open_request_count: 0,
    ...over,
  }
}

describe('myTasks', () => {
  it('keeps open tasks on me, overdue first, undated last', () => {
    const got = myTasks(
      [
        task({ id: 'undated' }),
        task({ id: 'later', due_at: hours(48) }),
        task({ id: 'late', due_at: hours(-2) }),
        task({ id: 'done', due_at: hours(-5), status: 'done' }),
        task({ id: 'theirs', due_at: hours(1), assignee_ids: ['you'] }),
      ],
      'me',
    )
    expect(got.map((t) => t.id)).toEqual(['late', 'later', 'undated'])
  })
})

describe('dueCounts', () => {
  it('splits overdue from the next seven days and skips done work', () => {
    expect(
      dueCounts(
        [
          task({ due_at: hours(-1) }),
          task({ due_at: hours(24) }),
          task({ due_at: hours(24 * 8) }),
          task({ due_at: hours(-1), status: 'done' }),
          task(),
        ],
        NOW,
      ),
    ).toEqual({ overdue: 1, thisWeek: 1 })
  })
})

describe('requestsToAnswer', () => {
  it('counts only projects the viewer owns', () => {
    expect(
      requestsToAnswer([
        project({ my_level: 'owner', open_request_count: 2 }),
        project({ my_level: 'member', open_request_count: 1 }),
      ]),
    ).toBe(2)
  })
})

describe('comingUp', () => {
  it('groups future deadlines and project ends by day, oldest first', () => {
    const days = comingUp(
      [
        task({ id: 'a', due_at: hours(2) }),
        task({ id: 'b', due_at: hours(26) }),
        task({ id: 'past', due_at: hours(-2) }),
        task({ id: 'far', due_at: hours(24 * 20) }),
      ],
      [
        project({ id: 'p1', ends_on: '2026-09-25' }),
        project({ id: 'p2', ends_on: '2026-09-26', status: 'done' }),
      ],
      NOW,
    )
    expect(days.map((d) => [d.day, d.items.map((i) => i.id)])).toEqual([
      ['2026-09-25', ['a', 'p1']],
      ['2026-09-26', ['b']],
    ])
  })
})

describe('dayLabel', () => {
  it('names today and tomorrow', () => {
    expect(dayLabel(NOW + 3600_000, NOW)).toBe('Today')
    expect(dayLabel(NOW + 24 * 3600_000, NOW)).toBe('Tomorrow')
  })
})

describe('recentProjects', () => {
  it('returns the most recently changed first', () => {
    const got = recentProjects(
      [
        project({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
        project({ id: 'new', updated_at: '2026-09-20T00:00:00Z' }),
      ],
      1,
    )
    expect(got.map((p) => p.id)).toEqual(['new'])
  })
})
