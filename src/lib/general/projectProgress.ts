import type { GeneralTask } from './types'

export type ProgressItem = Pick<GeneralTask, 'id' | 'team_id' | 'status' | 'assignee_ids' | 'completed_at' | 'archived_at'>
export type TeamBasis = 'team_tasks' | 'member_tasks'
export type CompletionWeek = { week: string; project: number; selected: number }

export function liveTasks<T extends ProgressItem>(tasks: readonly T[]): T[] {
  const seen = new Set<string>()
  return tasks.filter(task => {
    if (task.archived_at || seen.has(task.id)) return false
    seen.add(task.id)
    return true
  })
}

export function teamTasks<T extends ProgressItem>(tasks: readonly T[], teamId: string, memberIds: readonly string[], basis: TeamBasis): T[] {
  return liveTasks(tasks).filter(task => basis === 'team_tasks'
    ? task.team_id === teamId
    : task.assignee_ids.some(id => memberIds.includes(id)))
}

export function memberTasks<T extends ProgressItem>(tasks: readonly T[], userId: string): T[] {
  return liveTasks(tasks).filter(task => task.assignee_ids.includes(userId))
}

export function statusCounts(tasks: readonly ProgressItem[]): { todo: number; in_progress: number; done: number } {
  const counts = { todo: 0, in_progress: 0, done: 0 }
  for (const task of liveTasks(tasks)) counts[task.status]++
  return counts
}

const philippineDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
})
const dayMs = 86_400_000

function monday(date: Date): number {
  const parts = philippineDay.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)!.value)
  const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day')))
  return day.getTime() - ((day.getUTCDay() + 6) % 7) * dayMs
}

export function weeklyCompletions(project: readonly ProgressItem[], selected: readonly ProgressItem[], now: Date): CompletionWeek[] {
  const first = monday(now) - 11 * 7 * dayMs
  const weeks = Array.from({ length: 12 }, (_, index): CompletionWeek => ({
    week: new Date(first + index * 7 * dayMs).toISOString().slice(0, 10), project: 0, selected: 0,
  }))
  for (const [key, tasks] of [['project', project], ['selected', selected]] as const) {
    for (const task of liveTasks(tasks)) {
      if (task.status !== 'done' || !task.completed_at) continue
      const date = new Date(task.completed_at)
      if (!Number.isFinite(date.getTime())) continue
      const index = (monday(date) - first) / (7 * dayMs)
      if (index >= 0 && index < weeks.length) weeks[index][key]++
    }
  }
  return weeks
}
