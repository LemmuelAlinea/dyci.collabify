/**
 * Milestone progress and status, from the tasks tagged to it. Status is
 * worked out here rather than stored, so it is always as fresh as the tasks.
 */
import { dayDiff, toDay } from './sprints'
import type { WorkStatus } from './timeline'
import type { Milestone } from './types'

export type MilestoneStatus = 'reached' | 'late' | 'at_risk' | 'upcoming'

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  reached: 'Reached',
  late: 'Late',
  at_risk: 'At risk',
  upcoming: 'Upcoming',
}

export function milestoneProgress(items: readonly { milestone_id: string | null; status: WorkStatus }[], id: string) {
  const mine = items.filter((i) => i.milestone_id === id)
  const done = mine.filter((i) => i.status === 'done').length
  return { done, total: mine.length, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 }
}

/** Reached, then late, then at risk (a week out with under half done), else upcoming. */
export function milestoneStatus(
  m: Pick<Milestone, 'due_on' | 'reached_at'>,
  progress: { done: number; total: number },
  now = Date.now(),
): MilestoneStatus {
  if (m.reached_at || (progress.total > 0 && progress.done === progress.total)) return 'reached'
  const days = dayDiff(toDay(now), m.due_on)
  if (days < 0) return 'late'
  if (days <= 7 && (progress.total === 0 || progress.done / progress.total < 0.5)) return 'at_risk'
  return 'upcoming'
}

export function dueInLabel(dueOn: string, now = Date.now()) {
  const days = dayDiff(toDay(now), dueOn)
  if (days > 1) return `in ${days} days`
  if (days === 1) return 'tomorrow'
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  return `${-days} days ago`
}

export function sortMilestones<T extends Pick<Milestone, 'due_on' | 'created_at'>>(list: readonly T[]) {
  return [...list].sort((a, b) => a.due_on.localeCompare(b.due_on) || a.created_at.localeCompare(b.created_at))
}
