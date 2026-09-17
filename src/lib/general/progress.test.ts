import { describe, expect, it } from 'vitest'
import { TASK_STATUSES, projectProgress, taskShare } from './progress'

/** Mirrors `progress_pct` in `general_project_overview`, supabase/general-tasks.sql. */

const tasks = [
  { status: 'done' as const, weight: 3 },
  { status: 'in_progress' as const, weight: 1 },
  { status: 'todo' as const, weight: 4 },
]

describe('projectProgress', () => {
  it('counts finished tasks when points are off', () => {
    expect(projectProgress(tasks, false)).toEqual({ pct: 33.3, done: 1, total: 3 })
  })

  it('weighs finished tasks when points are on', () => {
    expect(projectProgress(tasks, true)).toEqual({ pct: 37.5, done: 1, total: 3 })
  })

  it('reads an empty project as zero, not as a division by zero', () => {
    expect(projectProgress([], true)).toEqual({ pct: 0, done: 0, total: 0 })
    expect(projectProgress([], false)).toEqual({ pct: 0, done: 0, total: 0 })
  })
})

describe('taskShare', () => {
  it('is the task weight as a share of 100', () => {
    expect(taskShare(3, tasks)).toBe(37.5)
  })

  it('is zero on an empty project', () => {
    expect(taskShare(1, [])).toBe(0)
  })
})

describe('TASK_STATUSES', () => {
  it('lists the three stages in order', () => {
    expect(TASK_STATUSES.map((s) => s.label)).toEqual(['To do', 'In progress', 'Done'])
  })
})
