import { describe, expect, it } from 'vitest'
import { buildDeadlines } from './deadlines'
import type { MyTask } from './api/tasks'
import type { ProjectSummary } from './types'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

const project = (id: string, extra: Partial<ProjectSummary> = {}) =>
  ({
    id,
    title: `Project ${id}`,
    class_initial: 'IT',
    class_name: 'Class',
    due_at: day(-1),
    scheduled: false,
    locked_at: null,
    archived_at: null,
    ...extra,
  }) as ProjectSummary

const task = (id: string, extra: Partial<MyTask> = {}) =>
  ({
    id,
    board_id: 'b1',
    project_id: 'p1',
    title: `Task ${id}`,
    project_title: 'Project p1',
    class_initial: 'IT',
    status: 'todo',
    due_at: day(-1),
    ...extra,
  }) as MyTask

const board = (id: string, project_id: string, submitted_at: string | null) => ({ id, project_id, submitted_at })

const ids = (list: { id: string }[]) => list.map((d) => d.id)

describe('buildDeadlines', () => {
  it('hides a project the student has handed in, accepted or still under review', () => {
    const list = buildDeadlines([], [project('p1')], [board('b1', 'p1', day(-2))], NOW)
    expect(list).toEqual([])
  })

  it('brings a project back when the professor returns it', () => {
    const list = buildDeadlines([], [project('p1')], [board('b1', 'p1', null)], NOW)
    expect(ids(list)).toEqual(['p1'])
  })

  it('hides a done task, and an open task on a handed-in board', () => {
    const list = buildDeadlines(
      [task('done', { status: 'done' }), task('open-on-handed-in')],
      [],
      [board('b1', 'p1', day(-2))],
      NOW,
    )
    expect(list).toEqual([])
  })

  it('hides closed, archived and unreleased projects, and their tasks', () => {
    const list = buildDeadlines(
      [task('t-closed', { project_id: 'closed', board_id: 'bx' })],
      [
        project('closed', { locked_at: day(-1) }),
        project('archived', { archived_at: day(-1) }),
        project('scheduled', { scheduled: true }),
      ],
      [],
      NOW,
    )
    expect(list).toEqual([])
  })

  it('keeps open work due within a week, overdue first, and nothing further out', () => {
    const list = buildDeadlines(
      [task('soon', { due_at: day(3) }), task('late', { due_at: day(-2) }), task('far', { due_at: day(10) })],
      [project('p2', { due_at: day(1) })],
      [board('b1', 'p1', null)],
      NOW,
    )
    expect(ids(list)).toEqual(['late', 'p2', 'soon'])
  })
})
