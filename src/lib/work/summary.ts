/**
 * What Summary asks of a space's tasks: what needs this person now, which
 * milestone is next, and how each group stands against each milestone.
 * Worked out from the tasks as they are, never stored.
 */
import { milestoneProgress, milestoneStatus, sortMilestones } from './milestones'
import type { MilestoneStatus } from './milestones'
import type { Milestone, MilestoneGroup, WorkItem } from './types'

export const DUE_SOON_DAYS = 7
const DAY = 86_400_000

export type NeedsYou = { overdue: WorkItem[]; dueSoon: WorkItem[]; unheld: WorkItem[] }

const dueTime = (i: WorkItem) => (i.due_at ? new Date(i.due_at).getTime() : Infinity)
// Undated tasks sort last; Infinity - Infinity is NaN, which falls through to the title.
const byDue = (a: WorkItem, b: WorkItem) => dueTime(a) - dueTime(b) || a.title.localeCompare(b.title)

/**
 * Your unfinished tasks that are late or due within a week, and every
 * unfinished task nobody holds. `mine` is the ids of the tasks you hold.
 */
export function needsYou(items: readonly WorkItem[], mine: ReadonlySet<string>, now = Date.now()): NeedsYou {
  const open = items.filter((i) => i.status !== 'done')
  const yours = open.filter((i) => mine.has(i.id) && i.due_at)
  return {
    overdue: yours.filter((i) => dueTime(i) < now).sort(byDue),
    dueSoon: yours.filter((i) => dueTime(i) >= now && dueTime(i) - now < DUE_SOON_DAYS * DAY).sort(byDue),
    unheld: open.filter((i) => i.holders.length === 0).sort(byDue),
  }
}

export type MilestoneGlance = {
  milestone: Milestone
  done: number
  total: number
  pct: number
  status: MilestoneStatus
}

/** The earliest milestone not yet reached, late ones included; null when none is left. */
export function nextMilestone(
  milestones: readonly Milestone[],
  items: readonly WorkItem[],
  now = Date.now(),
): MilestoneGlance | null {
  for (const m of sortMilestones(milestones)) {
    const p = milestoneProgress(items, m.id)
    const status = milestoneStatus(m, p, now)
    if (status !== 'reached') return { milestone: m, ...p, status }
  }
  return null
}

export type GridCell = { milestoneId: string; done: number; total: number; pct: number; status: MilestoneStatus }
export type GridRow = { id: string; name: string; cells: GridCell[] }

/** One row per group, one cell per milestone in date order, each from that group's own tasks. */
export function milestoneGrid(
  milestones: readonly Milestone[],
  groups: readonly MilestoneGroup[],
  now = Date.now(),
): { milestones: Milestone[]; rows: GridRow[] } {
  const ordered = sortMilestones(milestones)
  return {
    milestones: ordered,
    rows: groups.map((g) => ({
      id: g.id,
      name: g.name,
      cells: ordered.map((m) => {
        const p = milestoneProgress(g.items, m.id)
        return { milestoneId: m.id, ...p, status: milestoneStatus(m, p, now) }
      }),
    })),
  }
}
