/**
 * How far a General project has got.
 *
 * Points are a project setting. On, the project is worth 100 and each task's
 * weight is its slice, exactly as an Education board works. Off, every task
 * counts the same, which is what a school event committee usually wants.
 */

export type GeneralTaskStatus = 'todo' | 'in_progress' | 'done'

export type ProgressTask = { status: GeneralTaskStatus; weight: number }

export const TASK_STATUSES: { value: GeneralTaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const pctOf = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10)

export function projectProgress(tasks: readonly ProgressTask[], pointsEnabled: boolean) {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  if (total === 0) return { pct: 0, done: 0, total: 0 }
  if (!pointsEnabled) return { pct: pctOf(done, total), done, total }
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  const finished = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + Number(t.weight), 0)
  return { pct: pctOf(finished, all), done, total }
}

export function taskShare(weight: number, tasks: readonly ProgressTask[]) {
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  return pctOf(weight, all)
}
