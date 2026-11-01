// src/lib/general/taskMarks.test.ts
import { describe, expect, it } from 'vitest'
import { blockersOf, subtaskProgress, taskMarkIndex } from './taskRules'
import type { GeneralTask } from './types'

const task = (id: string, over: Partial<GeneralTask> = {}) =>
  ({ id, title: `Task ${id}`, status: 'todo', priority: 'normal', parent_id: null, ...over }) as GeneralTask

describe('taskMarkIndex', () => {
  const tasks = [
    task('p'),
    task('a', { parent_id: 'p', status: 'done' }),
    task('b', { parent_id: 'p' }),
    task('c', { parent_id: 'gone' }),
    task('x'),
    task('fin', { status: 'done' }),
    task('w', { status: 'done' }),
  ]
  const deps = [
    { task_id: 'x', depends_on_id: 'b' },
    { task_id: 'x', depends_on_id: 'fin' },
    { task_id: 'x', depends_on_id: 'missing' },
    { task_id: 'w', depends_on_id: 'b' },
  ]
  const marks = taskMarkIndex(tasks, deps)

  it('agrees with subtaskProgress and blockersOf for every task', () => {
    for (const t of tasks) {
      const m = marks(t)
      const progress = subtaskProgress(tasks, t.id)
      expect(m.subtasks).toEqual(progress.total > 0 ? progress : null)
      expect(m.blockers.map((b) => b.id)).toEqual(t.status === 'done' ? [] : blockersOf(deps, tasks, t.id).map((b) => b.id))
    }
  })

  it('counts the children and names the open blockers', () => {
    expect(marks(tasks[0]).subtasks).toEqual({ done: 1, total: 2 })
    expect(marks(tasks[4]).blockers.map((b) => b.id)).toEqual(['b'])
  })

  it('names the parent, or says Subtask when it is not in the list', () => {
    expect(marks(tasks[1]).partOf).toBe('Part of Task p')
    expect(marks(tasks[3]).partOf).toBe('Subtask')
    expect(marks(tasks[0]).partOf).toBeNull()
  })
})
