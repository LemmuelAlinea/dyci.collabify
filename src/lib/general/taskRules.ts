// src/lib/general/taskRules.ts
/**
 * A work project's task rules, and the small helpers over priority, subtasks
 * and dependencies. The rules are enforced by supabase/project-task-rules.sql;
 * the app reads them to hide what the database would refuse.
 */
import type { GeneralTask, TaskPriority } from './types'
import { PRIORITIES } from './types'

export type TaskRules = {
  /** The priority a new task starts with. */
  defaultPriority: TaskPriority
  /** The index of the stage a task enters the work in. */
  defaultStage: number
  allowSubtasks: boolean
  allowDependencies: boolean
  allowMultipleAssignees: boolean
  /** A task needs a holder before it moves forward. */
  requireAssignee: boolean
  /** A parent can't finish while a subtask is open. */
  requireSubtasksDone: boolean
}

/** What a project did before the rules existed; also what the app uses until the columns are live. */
export const DEFAULT_TASK_RULES: TaskRules = {
  defaultPriority: 'normal',
  defaultStage: 0,
  allowSubtasks: true,
  allowDependencies: true,
  allowMultipleAssignees: true,
  requireAssignee: false,
  requireSubtasksDone: true,
}

export type TaskDependency = { task_id: string; depends_on_id: string }

/** The tasks under a parent, in list order. */
export function subtasksOf(tasks: GeneralTask[], id: string): GeneralTask[] {
  return tasks.filter((t) => t.parent_id === id)
}

/** How many of a parent's subtasks are done. */
export function subtaskProgress(tasks: GeneralTask[], id: string): { done: number; total: number } {
  const subtasks = subtasksOf(tasks, id)
  return { done: subtasks.filter((t) => t.status === 'done').length, total: subtasks.length }
}

/**
 * The tasks this one waits for that aren't done. A blocker missing from
 * `tasks` (archived, say) doesn't block, as in the database.
 */
export function blockersOf(deps: TaskDependency[], tasks: GeneralTask[], id: string): GeneralTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const blockers: GeneralTask[] = []
  for (const dep of deps) {
    if (dep.task_id !== id) continue
    const blocker = byId.get(dep.depends_on_id)
    if (blocker && blocker.status !== 'done') blockers.push(blocker)
  }
  return blockers
}

const RANK = new Map<TaskPriority, number>(PRIORITIES.map((p, i) => [p.value, i]))

/** Sort order: urgent first, low last. A task without a priority counts as normal. */
export function comparePriority(a: { priority?: TaskPriority }, b: { priority?: TaskPriority }): number {
  return (RANK.get(a.priority ?? 'normal') ?? 0) - (RANK.get(b.priority ?? 'normal') ?? 0)
}

/** What a work task's card says about its subtasks and what it waits for. */
export type TaskMarkData = {
  /** The subtasks done and in all; null on a task without any. */
  subtasks: { done: number; total: number } | null
  /** "Part of {parent}", or "Subtask" while the parent is not in the list; null on a top-level task. */
  partOf: string | null
  /** Open tasks this one waits for. */
  blockers: GeneralTask[]
}

/**
 * The marks for each task, from lookups built once. `tasks` is what the viewer
 * can see, so a subtask still being planned is not counted. Same answers as
 * subtaskProgress and blockersOf, without a pass over every task per card.
 */
export function taskMarkIndex(tasks: GeneralTask[], deps: TaskDependency[]): (task: GeneralTask) => TaskMarkData {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const progress = new Map<string, { done: number; total: number }>()
  for (const t of tasks) {
    if (!t.parent_id) continue
    const p = progress.get(t.parent_id) ?? { done: 0, total: 0 }
    p.total += 1
    if (t.status === 'done') p.done += 1
    progress.set(t.parent_id, p)
  }
  const waitsFor = new Map<string, string[]>()
  for (const d of deps) waitsFor.set(d.task_id, [...(waitsFor.get(d.task_id) ?? []), d.depends_on_id])

  return (task) => {
    const parent = task.parent_id ? byId.get(task.parent_id) : undefined
    const blockers: GeneralTask[] = []
    if (task.status !== 'done') {
      for (const id of waitsFor.get(task.id) ?? []) {
        const blocker = byId.get(id)
        // A blocker missing from the list (archived, say) does not block, as in the database.
        if (blocker && blocker.status !== 'done') blockers.push(blocker)
      }
    }
    return {
      subtasks: progress.get(task.id) ?? null,
      partOf: task.parent_id ? (parent ? `Part of ${parent.title}` : 'Subtask') : null,
      blockers,
    }
  }
}
