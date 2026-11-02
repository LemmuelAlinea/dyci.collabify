/**
 * Milestone progress and status, from the tasks tagged to it. Status is
 * worked out here rather than stored, so it is always as fresh as the tasks.
 */
import { formatDay } from '../general/dates'
import type { MilestoneCompletion } from '../general/milestoneRules'
import { dayDiff, toDay } from './sprints'
import type { WorkStatus } from './timeline'
import type { Milestone, MilestoneDependency } from './types'

/**
 * `waiting`: a milestone it waits for is not reached. `ready`: a work
 * milestone whose tagged tasks are all done but that is not stamped reached.
 */
export type MilestoneStatus = 'reached' | 'waiting' | 'ready' | 'late' | 'at_risk' | 'upcoming'

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  reached: 'Reached',
  waiting: 'Waiting',
  ready: 'Ready to mark reached',
  late: 'Late',
  at_risk: 'At risk',
  upcoming: 'Upcoming',
}

export function milestoneProgress(items: readonly { milestone_id: string | null; status: WorkStatus }[], id: string) {
  const mine = items.filter((i) => i.milestone_id === id)
  const done = mine.filter((i) => i.status === 'done').length
  return { done, total: mine.length, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 }
}

/**
 * Reached (stamped), then waiting (a milestone in `blockers` is not reached),
 * then ready (every tagged task done), then late, then at risk (a week out
 * with under half done), else upcoming. A work milestone (`mode` given) is
 * reached only once stamped: the database stamps it in automatic mode, so
 * finished work without the stamp was marked not reached, or is about to be
 * stamped, and reads ready in both modes. A class milestone (no `mode`) has
 * no stamp or links, so finished work reads reached. A milestone with no due
 * date is never late or at risk.
 */
export function milestoneStatus(
  m: Pick<Milestone, 'due_on' | 'reached_at'>,
  progress: { done: number; total: number },
  now = Date.now(),
  mode?: MilestoneCompletion,
  blockers: readonly unknown[] = [],
): MilestoneStatus {
  const finished = progress.total > 0 && progress.done === progress.total
  if (m.reached_at) return 'reached'
  if (blockers.length > 0) return 'waiting'
  if (finished) return mode ? 'ready' : 'reached'
  if (!m.due_on) return 'upcoming'
  const days = dayDiff(toDay(now), m.due_on)
  if (days < 0) return 'late'
  if (days <= 7 && (progress.total === 0 || progress.done / progress.total < 0.5)) return 'at_risk'
  return 'upcoming'
}

/**
 * The test the milestones view applies, for a caller that draws milestones
 * elsewhere. A work milestone (`mode` given) reads reached only from its
 * stamp, so what it waits for never changes the answer.
 */
export function reachedIn(items: readonly { milestone_id: string | null; status: WorkStatus }[], mode?: MilestoneCompletion) {
  return (m: Pick<Milestone, 'id' | 'due_on' | 'reached_at'>) =>
    milestoneStatus(m, milestoneProgress(items, m.id), Date.now(), mode) === 'reached'
}

export function dueInLabel(dueOn: string, now = Date.now()) {
  const days = dayDiff(toDay(now), dueOn)
  if (days > 1) return `in ${days} days`
  if (days === 1) return 'tomorrow'
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  return `${-days} days ago`
}

/** "No due date", or the day and how far off it is. */
export function dueLine(dueOn: string | null, now = Date.now()) {
  return dueOn ? `${formatDay(dueOn)} · ${dueInLabel(dueOn, now)}` : 'No due date'
}

/** By due date, then by when it was made; milestones with no due date come last. */
export function sortMilestones<T extends Pick<Milestone, 'due_on' | 'created_at'>>(list: readonly T[]) {
  return [...list].sort(
    (a, b) =>
      Number(a.due_on === null) - Number(b.due_on === null) ||
      (a.due_on ?? '').localeCompare(b.due_on ?? '') ||
      a.created_at.localeCompare(b.created_at),
  )
}

/** The milestones this one waits for that are not reached yet, soonest first. */
export function waitingFor<T extends Pick<Milestone, 'id' | 'due_on' | 'created_at' | 'reached_at'>>(
  milestone: Pick<Milestone, 'id'>,
  dependencies: readonly MilestoneDependency[],
  milestones: readonly T[],
): T[] {
  const blockers = new Set(dependencies.filter((d) => d.milestone_id === milestone.id).map((d) => d.depends_on_id))
  return sortMilestones(milestones.filter((m) => blockers.has(m.id) && !m.reached_at))
}

/** "Waiting for Alpha, Beta", from `waitingFor`. */
export function waitingLabel(blockers: readonly Pick<Milestone, 'name'>[]) {
  return `Waiting for ${blockers.map((b) => b.name).join(', ')}`
}
