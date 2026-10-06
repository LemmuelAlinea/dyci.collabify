/**
 * Sprint arithmetic for Backlog, Sprints and Summary. Calendar days are
 * YYYY-MM-DD strings read as local midnight, the way a project's dates are,
 * so a sprint ending "the 18th" ends on the 18th wherever the reader is.
 */
import type { Sprint, SprintInput, WorkItem } from './types'

export const SPRINT_DAYS = 14

function parse(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toDay(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(day: string, n: number) {
  const d = parse(day)
  return toDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime())
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function dayDiff(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

export function runningSprint(sprints: readonly Sprint[]) {
  return sprints.find((s) => s.state === 'active') ?? null
}

export function plannedSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'planned')
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.created_at.localeCompare(b.created_at))
}

export function finishedSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'completed')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
}

export function sprintLength(sprint: Pick<Sprint, 'starts_on' | 'ends_on'>) {
  return dayDiff(sprint.starts_on, sprint.ends_on) + 1
}

/** Days from today through the last day, today included: 1 on the last day, 0 the day after. */
export function daysLeft(sprint: Pick<Sprint, 'ends_on'>, now = Date.now()) {
  return dayDiff(toDay(now), sprint.ends_on) + 1
}

export function daysLeftLabel(n: number) {
  if (n > 1) return `${n} days left`
  if (n === 1) return 'Last day'
  if (n === 0) return 'Ended yesterday'
  return `Ended ${1 - n} days ago`
}

/** The next sprint: named in sequence, starting the day after the latest one ends, or today. */
export function nextSprintDraft(sprints: readonly Sprint[], now = Date.now()): SprintInput {
  const today = toDay(now)
  const latest = sprints.reduce<string | null>((max, s) => (max && max > s.ends_on ? max : s.ends_on), null)
  const startsOn = latest && addDays(latest, 1) > today ? addDays(latest, 1) : today
  return {
    name: `Sprint ${sprints.length + 1}`,
    goal: '',
    startsOn,
    endsOn: addDays(startsOn, SPRINT_DAYS - 1),
  }
}

export function sprintCounts(items: readonly WorkItem[], sprintId: string) {
  const mine = items.filter((i) => i.sprint_id === sprintId)
  return { done: mine.filter((i) => i.status === 'done').length, total: mine.length }
}

export type BurnPoint = { day: string; left: number }

/**
 * Tasks still open at the end of each sprint day, from the first day up to
 * today (or the last day). Counted over the sprint's tasks as they stand now,
 * so a task added mid-sprint counts from day one; done is read from done_at.
 */
export function burndown(sprint: Sprint, items: readonly WorkItem[], now = Date.now()): BurnPoint[] {
  const mine = items.filter((i) => i.sprint_id === sprint.id)
  const today = toDay(now)
  const last = sprint.ends_on < today ? sprint.ends_on : today
  const out: BurnPoint[] = []
  // Guarded rather than open-ended: a bad date must not hang the page.
  for (let day = sprint.starts_on, i = 0; day <= last && i < 400; day = addDays(day, 1), i++) {
    const endOfDay = parse(addDays(day, 1)).getTime()
    const left = mine.filter(
      (t) => !(t.status === 'done' && t.done_at && new Date(t.done_at).getTime() < endOfDay),
    ).length
    out.push({ day, left })
  }
  return out
}
