/**
 * The backlog's order. Lower rank is nearer the top; a move writes one new
 * rank between the item's new neighbours, so nothing else is renumbered.
 */
import type { WorkItem } from './types'

const byRank = (a: WorkItem, b: WorkItem) => a.rank - b.rank || a.created_at.localeCompare(b.created_at)

/** Unfinished tasks in no sprint, top first. */
export function backlogItems(items: readonly WorkItem[]) {
  return items.filter((i) => i.sprint_id === null && i.status !== 'done').sort(byRank)
}

/** A sprint's tasks, done ones too, top first. */
export function sprintItems(items: readonly WorkItem[], sprintId: string) {
  return items.filter((i) => i.sprint_id === sprintId).sort(byRank)
}

export function rankBetween(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** The rank that moves list[index] one place up (-1) or down (1); null past an end. */
export function rankForMove(list: readonly Pick<WorkItem, 'rank'>[], index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= list.length) return null
  return dir === -1
    ? rankBetween(list[target - 1]?.rank, list[target].rank)
    : rankBetween(list[target].rank, list[target + 1]?.rank)
}
