/**
 * What is already late, and what lands in the weeks ahead.
 *
 * The only part of the progress page somebody can still act on before it
 * happens. A week with eleven tasks in it is a week to move something out of.
 */
import type { GeneralTask } from './types'

export type PressureTask = Pick<GeneralTask, 'id' | 'title' | 'status' | 'due_at' | 'team_id'>
export type DueWeek = { start: number; label: string; count: number }

const DAY = 86_400_000
const WEEK = 7 * DAY

const at = (task: PressureTask) => (task.due_at ? new Date(task.due_at).getTime() : null)

export function overdueTasks(tasks: readonly PressureTask[], now = Date.now()): PressureTask[] {
  return tasks
    .filter((t) => t.status !== 'done' && at(t) !== null && (at(t) as number) < now)
    .sort((a, b) => (at(a) as number) - (at(b) as number))
}

export function dueByWeek(
  tasks: readonly PressureTask[],
  now = Date.now(),
  weeks = 4,
): DueWeek[] {
  const out: DueWeek[] = Array.from({ length: weeks }, (_, i) => {
    const start = now + i * WEEK
    return {
      start,
      label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: 0,
    }
  })

  for (const task of tasks) {
    if (task.status === 'done') continue
    const due = at(task)
    if (due === null || due < now) continue
    const index = Math.floor((due - now) / WEEK)
    if (index >= 0 && index < weeks) out[index].count++
  }

  return out
}
