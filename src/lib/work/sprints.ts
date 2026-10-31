/**
 * Sprint arithmetic for Backlog, Sprints and Summary. Calendar days are
 * YYYY-MM-DD strings read as local midnight, the way a project's dates are,
 * so a sprint ending "the 18th" ends on the 18th wherever the reader is.
 */
import type { Milestone, Sprint, SprintInput, WorkItem } from './types'

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

export function finishedSprints(sprints: readonly Sprint[], archived = false) {
  return sprints
    .filter((s) => s.state === 'completed' && s.archived === archived)
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

export type TimelineState = 'done' | 'today' | 'late' | 'upcoming'
/** `marker` is the Today point, added when no checkpoint falls on today. */
export type TimelinePoint = { day: string; label: string; state: TimelineState; marker?: boolean }

/**
 * The checkpoints a running sprint passes: its first day, the milestones due
 * inside it, and its last day, with Today placed among them. A milestone is
 * done once reached and late once its day passes without that.
 */
export function sprintTimeline<M extends Pick<Milestone, 'id' | 'name' | 'due_on'>>(
  sprint: Pick<Sprint, 'starts_on' | 'ends_on'>,
  milestones: readonly M[],
  reached: (m: M) => boolean,
  now = Date.now(),
): TimelinePoint[] {
  const today = toDay(now)
  const ahead = (day: string): TimelineState => (day === today ? 'today' : 'upcoming')
  const points: TimelinePoint[] = [
    { day: sprint.starts_on, label: 'Kickoff', state: sprint.starts_on <= today ? 'done' : 'upcoming' },
    ...milestones
      .filter((m) => m.due_on > sprint.starts_on && m.due_on <= sprint.ends_on)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .map((m) => ({
        day: m.due_on,
        label: m.name,
        state: reached(m) ? ('done' as const) : m.due_on < today ? ('late' as const) : ahead(m.due_on),
      })),
    { day: sprint.ends_on, label: 'Sprint ends', state: sprint.ends_on < today ? 'done' : ahead(sprint.ends_on) },
  ]
  if (today > sprint.starts_on && today < sprint.ends_on && !points.some((p) => p.day === today)) {
    const at = points.findIndex((p) => p.day > today)
    points.splice(at, 0, { day: today, label: 'Today', state: 'today', marker: true })
  }
  return points
}

/** The next checkpoint still to come, today included; null once the sprint is over. */
export function nextCheckpoint(points: readonly TimelinePoint[]) {
  return points.find((p) => !p.marker && (p.state === 'today' || p.state === 'upcoming')) ?? null
}
