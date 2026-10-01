import { describe, expect, it } from 'vitest'
import { TASK_STATUSES, projectProgress } from './progress'

/** Mirrors `progress_pct` in `general_project_overview`, supabase/general-tasks.sql. */

const tasks = [{ status: 'done' as const }, { status: 'in_progress' as const }, { status: 'todo' as const }]

describe('projectProgress', () => {
  it('counts every task the same', () => {
    expect(projectProgress(tasks)).toEqual({ pct: 33.3, done: 1, total: 3 })
  })

  it('reads an empty project as zero, not as a division by zero', () => {
    expect(projectProgress([])).toEqual({ pct: 0, done: 0, total: 0 })
  })
})

describe('TASK_STATUSES', () => {
  it('lists the three stages in order', () => {
    expect(TASK_STATUSES.map((s) => s.label)).toEqual(['To do', 'In progress', 'Done'])
  })
})
