// src/lib/general/taskFilters.ts
/**
 * The Priority filter and sort that Tasks and My tasks share. Pure, so the
 * rules are checkable without a page; the saved choice lives in this device's
 * storage, one per project (Tasks) or one for My tasks.
 */
import { comparePriority } from './taskRules'
import { PRIORITIES } from './types'
import type { TaskPriority } from './types'

/** '' keeps the order the list already has. */
export type PrioritySort = '' | 'priority'

export type PriorityView = {
  /** Empty means every priority. */
  priorities: TaskPriority[]
  sort: PrioritySort
}

export const EMPTY_PRIORITY_VIEW: PriorityView = { priorities: [], sort: '' }

type HasPriority = { priority?: TaskPriority }

/** Keeps the tasks whose priority is chosen. A task without one counts as normal. */
export function filterByPriority<T extends object>(tasks: readonly T[], chosen: readonly TaskPriority[]): T[] {
  if (chosen.length === 0) return [...tasks]
  return tasks.filter((t) => chosen.includes((t as HasPriority).priority ?? 'normal'))
}

/** Urgent first; tasks of the same priority keep the order they came in. */
export function sortByPriority<T extends HasPriority>(tasks: readonly T[]): T[] {
  return [...tasks].sort(comparePriority)
}

/** What the filter button's summary says about the priority choice. */
export function prioritySummary(view: PriorityView): string[] {
  return [
    ...(view.priorities.length > 0
      ? [PRIORITIES.filter((p) => view.priorities.includes(p.value)).map((p) => p.label).join(', ')]
      : []),
    ...(view.sort === 'priority' ? ['By priority'] : []),
  ]
}

/** How many of the filter button's settings the priority choice takes. */
export function priorityActive(view: PriorityView): number {
  return (view.priorities.length > 0 ? 1 : 0) + (view.sort ? 1 : 0)
}

const key = (id: string) => `collabify:task-priority:${id}`
const KNOWN = new Set<string>(PRIORITIES.map((p) => p.value))

/** What this device saved for `id`; anything unreadable or unknown reads as no choice. */
export function readPriorityView(id: string | undefined): PriorityView {
  if (!id) return EMPTY_PRIORITY_VIEW
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(id)) ?? 'null')
    if (!raw || typeof raw !== 'object') return EMPTY_PRIORITY_VIEW
    const { priorities, sort } = raw as { priorities?: unknown; sort?: unknown }
    return {
      priorities: Array.isArray(priorities)
        ? (priorities.filter((p) => typeof p === 'string' && KNOWN.has(p)) as TaskPriority[])
        : [],
      sort: sort === 'priority' ? 'priority' : '',
    }
  } catch {
    return EMPTY_PRIORITY_VIEW
  }
}

export function writePriorityView(id: string, view: PriorityView): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(view))
  } catch {
    // Private mode or blocked storage: the choice still holds until the page closes.
  }
}
