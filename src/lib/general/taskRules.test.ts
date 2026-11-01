import { describe, expect, it } from 'vitest'
import { blockersOf, comparePriority, DEFAULT_TASK_RULES, subtaskProgress, subtasksOf } from './taskRules'
import { PRIORITIES } from './types'
import type { GeneralTask, TaskPriority } from './types'

function task(id: string, over: Partial<GeneralTask> = {}): GeneralTask {
  return { id, status: 'todo', priority: 'normal', parent_id: null, ...over } as GeneralTask
}

describe('subtasksOf', () => {
  it('returns only the children of the parent', () => {
    const tasks = [task('p'), task('a', { parent_id: 'p' }), task('b', { parent_id: 'q' }), task('c', { parent_id: 'p' })]
    expect(subtasksOf(tasks, 'p').map((t) => t.id)).toEqual(['a', 'c'])
    expect(subtasksOf(tasks, 'a')).toEqual([])
  })
})

describe('subtaskProgress', () => {
  it('counts the done children', () => {
    const tasks = [
      task('p'),
      task('a', { parent_id: 'p', status: 'done' }),
      task('b', { parent_id: 'p', status: 'in_progress' }),
      task('c', { parent_id: 'p', status: 'done' }),
      task('d', { parent_id: 'other', status: 'done' }),
    ]
    expect(subtaskProgress(tasks, 'p')).toEqual({ done: 2, total: 3 })
  })

  it('is empty for a task without subtasks', () => {
    expect(subtaskProgress([task('p')], 'p')).toEqual({ done: 0, total: 0 })
  })
})

describe('blockersOf', () => {
  const tasks = [task('t'), task('open', { status: 'in_progress' }), task('done', { status: 'done' }), task('todo')]
  const deps = [
    { task_id: 't', depends_on_id: 'open' },
    { task_id: 't', depends_on_id: 'done' },
    { task_id: 't', depends_on_id: 'todo' },
    { task_id: 'other', depends_on_id: 'todo' },
    { task_id: 't', depends_on_id: 'gone' },
  ]

  it('returns only the blockers that are not done', () => {
    expect(blockersOf(deps, tasks, 't').map((x) => x.id)).toEqual(['open', 'todo'])
  })

  it('skips a blocker the list does not hold, such as an archived one', () => {
    expect(blockersOf(deps, tasks, 't').some((x) => x.id === 'gone')).toBe(false)
  })

  it('is empty for a task that waits for nothing', () => {
    expect(blockersOf(deps, tasks, 'open')).toEqual([])
  })
})

describe('comparePriority', () => {
  it('sorts urgent first and low last', () => {
    const order: TaskPriority[] = ['low', 'urgent', 'normal', 'high']
    const sorted = order.map((p) => task(p, { priority: p })).sort(comparePriority).map((t) => t.priority)
    expect(sorted).toEqual(['urgent', 'high', 'normal', 'low'])
  })

  it('treats a missing priority as normal', () => {
    const missing = { id: 'x' } as GeneralTask
    expect(comparePriority(missing, task('n'))).toBe(0)
    expect(comparePriority(missing, task('h', { priority: 'high' }))).toBeGreaterThan(0)
  })

  it('matches the order of PRIORITIES', () => {
    expect(PRIORITIES.map((p) => p.value)).toEqual(['urgent', 'high', 'normal', 'low'])
    expect(PRIORITIES.map((p) => p.label)).toEqual(['Urgent', 'High', 'Normal', 'Low'])
  })
})

describe('DEFAULT_TASK_RULES', () => {
  it('keeps the behaviour projects had before the rules existed', () => {
    expect(DEFAULT_TASK_RULES).toEqual({
      defaultPriority: 'normal',
      defaultStage: 0,
      allowSubtasks: true,
      allowDependencies: true,
      allowMultipleAssignees: true,
      requireAssignee: false,
      requireSubtasksDone: true,
    })
  })
})
