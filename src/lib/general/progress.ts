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

const round1 = (n: number) => Math.round(n * 10) / 10

export function projectProgress(tasks: readonly ProgressTask[], pointsEnabled: boolean) {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  if (total === 0) return { pct: 0, done: 0, total: 0 }
  if (!pointsEnabled) return { pct: round1((done / total) * 100), done, total }
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  const finished = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + Number(t.weight), 0)
  return { pct: all === 0 ? 0 : round1((finished / all) * 100), done, total }
}

export function taskShare(weight: number, tasks: readonly ProgressTask[]) {
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  return all === 0 ? 0 : round1((weight / all) * 100)
}
