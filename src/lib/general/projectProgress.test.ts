import { describe, expect, it } from 'vitest'
import { liveTasks, memberTasks, statusCounts, teamTasks, weeklyCompletions, type ProgressItem } from './projectProgress'

const task = (id: string, changes: Partial<ProgressItem> = {}): ProgressItem => ({
  id, team_id: 'X', status: 'done', assignee_ids: ['A', 'B'],
  completed_at: '2026-10-20T04:00:00Z', archived_at: null, ...changes,
})

describe('project progress selection', () => {
  it('counts a shared task once per project and team, and once for each holder', () => {
    const tasks = liveTasks([task('shared'), task('shared')])
    expect(tasks).toHaveLength(1)
    expect(teamTasks(tasks, 'X', ['A', 'B'], 'team_tasks')).toHaveLength(1)
    expect(teamTasks([task('shared'), task('shared')], 'X', ['A', 'B'], 'member_tasks')).toHaveLength(1)
    expect(memberTasks(tasks, 'A')).toHaveLength(1)
    expect(memberTasks(tasks, 'B')).toHaveLength(1)
    expect(statusCounts(tasks)).toEqual({ todo: 0, in_progress: 0, done: 1 })
  })

  it('includes cross-team holders in each member basis', () => {
    const tasks = [task('cross', { assignee_ids: ['A', 'C'] })]
    expect(teamTasks(tasks, 'X', ['A'], 'member_tasks')).toEqual(tasks)
    expect(teamTasks(tasks, 'Y', ['C'], 'member_tasks')).toEqual(tasks)
    expect(teamTasks(tasks, 'Y', ['C'], 'team_tasks')).toEqual([])
  })

  it('places teamless and unassigned tasks only in their matching bases', () => {
    const teamless = task('teamless', { team_id: null, assignee_ids: ['A'] })
    const unassigned = task('unassigned', { assignee_ids: [] })
    const tasks = liveTasks([teamless, unassigned])
    expect(tasks).toHaveLength(2)
    expect(teamTasks(tasks, 'X', ['A'], 'team_tasks')).toEqual([unassigned])
    expect(teamTasks(tasks, 'X', ['A'], 'member_tasks')).toEqual([teamless])
    expect(memberTasks(tasks, 'A')).toEqual([teamless])
  })

  it('excludes archives and keeps empty status counts zero', () => {
    expect(liveTasks([task('old', { archived_at: '2026-10-21T00:00:00Z' })])).toEqual([])
    expect(statusCounts([])).toEqual({ todo: 0, in_progress: 0, done: 0 })
    expect(statusCounts([task('a', { status: 'todo' }), task('b', { status: 'in_progress' }), task('c')]))
      .toEqual({ todo: 1, in_progress: 1, done: 1 })
  })
})

describe('weekly completions', () => {
  const now = new Date('2026-10-25T12:00:00+08:00')

  it('returns twelve Monday buckets, oldest first, including the current Philippine week', () => {
    const weeks = weeklyCompletions([], [], now)
    expect(weeks.map(w => w.week)).toEqual([
      '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24',
      '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21',
      '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19',
    ])
    expect(weeks.every(w => w.project === 0 && w.selected === 0)).toBe(true)
  })

  it('uses Philippine midnight and keeps only dated, live, currently Done tasks in range', () => {
    const boundary = task('boundary', { completed_at: '2026-10-18T16:00:00Z' })
    const previous = task('previous', { completed_at: '2026-10-18T15:59:59Z' })
    const first = task('first', { completed_at: '2026-08-02T16:00:00Z' })
    const ignored = [
      task('reopened', { status: 'in_progress' }), task('undated', { completed_at: null }),
      task('invalid', { completed_at: 'bad date' }),
      task('archived', { archived_at: '2026-10-21T00:00:00Z' }),
      task('old', { completed_at: '2026-08-02T15:59:59Z' }),
      task('future', { completed_at: '2026-10-26T00:00:00+08:00' }),
    ]
    const weeks = weeklyCompletions([boundary, boundary, previous, first, ...ignored], [boundary, ...ignored], now)
    expect(weeks[0]).toEqual({ week: '2026-08-03', project: 1, selected: 0 })
    expect(weeks[10]).toEqual({ week: '2026-10-12', project: 1, selected: 0 })
    expect(weeks[11]).toEqual({ week: '2026-10-19', project: 1, selected: 1 })
    expect(weeks.reduce((n, w) => n + w.project, 0)).toBe(3)
    expect(weeks.reduce((n, w) => n + w.selected, 0)).toBe(1)
  })
})


it('changes the selected-team weekly series with the basis and keeps all-member assignments independent', () => {
  const tasks = [task('inside', { status: 'todo' }), task('outside', { team_id: 'Y', assignee_ids: ['A'] })]
  const own = teamTasks(tasks, 'X', ['A'], 'team_tasks')
  const held = teamTasks(tasks, 'X', ['A'], 'member_tasks')
  const now = new Date('2026-10-25T12:00:00+08:00')
  expect(weeklyCompletions(tasks, own, now).at(-1)?.selected).toBe(0)
  expect(weeklyCompletions(tasks, held, now).at(-1)?.selected).toBe(1)
  expect(memberTasks(teamTasks(tasks, 'X', ['A'], 'member_tasks'), 'A')).toEqual(tasks)
  expect(memberTasks(teamTasks(tasks, 'Y', ['A'], 'member_tasks'), 'A')).toEqual(tasks)
  expect(memberTasks(tasks, 'A')).toEqual(tasks)
  expect(memberTasks(tasks, 'qa')).toEqual([])
  expect(memberTasks(tasks, 'stakeholder')).toEqual([])
})
