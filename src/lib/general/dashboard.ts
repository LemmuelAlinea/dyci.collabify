/**
 * What a space's dashboard reads out of its projects and open tasks.
 *
 * Pure, and handed `now`, so every figure on the page is checkable in a test
 * rather than depending on the hour the suite ran.
 */
import type { GeneralProjectSummary, GeneralTask } from './types'

const DAY = 24 * 60 * 60 * 1000

export type DashTask = Pick<GeneralTask, 'id' | 'project_id' | 'title' | 'status' | 'due_at' | 'assignee_ids' | 'created_at'>
export type DashProject = Pick<
  GeneralProjectSummary,
  'id' | 'name' | 'status' | 'ends_on' | 'updated_at' | 'my_level' | 'open_request_count'
>

const dueTime = (t: DashTask) => (t.due_at ? new Date(t.due_at).getTime() : Infinity)

/** Open tasks on me: overdue first, then soonest due, then undated by age. */
export function myTasks<T extends DashTask>(tasks: readonly T[], userId: string): T[] {
  return tasks
    .filter((t) => t.status !== 'done' && t.assignee_ids.includes(userId))
    .sort((a, b) => dueTime(a) - dueTime(b) || a.created_at.localeCompare(b.created_at))
}

/** Overdue, and due in the seven days from now. Done tasks count in neither. */
export function dueCounts(tasks: readonly DashTask[], now: number) {
  let overdue = 0
  let thisWeek = 0
  for (const t of tasks) {
    if (t.status === 'done' || !t.due_at) continue
    const at = new Date(t.due_at).getTime()
    if (at < now) overdue += 1
    else if (at <= now + 7 * DAY) thisWeek += 1
  }
  return { overdue, thisWeek }
}

/** Access requests an Owner has to answer. Anyone else's count is their own asks. */
export function requestsToAnswer(projects: readonly DashProject[]) {
  return projects.reduce((sum, p) => (p.my_level === 'owner' ? sum + p.open_request_count : sum), 0)
}

export type ComingItem =
  | { kind: 'task'; id: string; projectId: string; title: string; at: number }
  | { kind: 'project'; id: string; projectId: string; title: string; at: number }

export type ComingDay = { day: string; at: number; items: ComingItem[] }

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A project end date is a calendar day: the end of it, locally. */
function endOfDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59).getTime()
}

/**
 * Task deadlines and project end dates from now until `days` out, by day.
 * What has already passed is left to the task list, which leads with it.
 */
export function comingUp(
  tasks: readonly DashTask[],
  projects: readonly DashProject[],
  now: number,
  days = 14,
): ComingDay[] {
  const until = now + days * DAY
  const items: ComingItem[] = []
  for (const t of tasks) {
    if (t.status === 'done' || !t.due_at) continue
    const at = new Date(t.due_at).getTime()
    if (at >= now && at <= until) items.push({ kind: 'task', id: t.id, projectId: t.project_id, title: t.title, at })
  }
  for (const p of projects) {
    if (!p.ends_on || p.status === 'done' || p.status === 'cancelled') continue
    const at = endOfDay(p.ends_on)
    if (at >= now && at <= until) items.push({ kind: 'project', id: p.id, projectId: p.id, title: p.name, at })
  }
  items.sort((a, b) => a.at - b.at)

  const out: ComingDay[] = []
  for (const item of items) {
    const key = dayKey(new Date(item.at))
    const last = out[out.length - 1]
    if (last?.day === key) last.items.push(item)
    else out.push({ day: key, at: item.at, items: [item] })
  }
  return out
}

/** "Today", "Tomorrow", else a short weekday and date. */
export function dayLabel(at: number, now: number) {
  const key = dayKey(new Date(at))
  if (key === dayKey(new Date(now))) return 'Today'
  if (key === dayKey(new Date(now + DAY))) return 'Tomorrow'
  return new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The projects somebody most likely wants back, most recently changed first. */
export function recentProjects<P extends DashProject>(projects: readonly P[], n = 4): P[] {
  return [...projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, n)
}
