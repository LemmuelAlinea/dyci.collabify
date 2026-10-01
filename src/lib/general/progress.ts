/**
 * How far a General project has got: every task counts the same. Work tasks
 * carry no points; those belong to Education boards.
 */

export type GeneralTaskStatus = 'todo' | 'in_progress' | 'done'

export type ProgressTask = { status: GeneralTaskStatus }

export const TASK_STATUSES: { value: GeneralTaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const pctOf = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10)

export function projectProgress(tasks: readonly ProgressTask[]) {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  return { pct: pctOf(done, total), done, total }
}
