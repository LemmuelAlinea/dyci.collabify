import type { ActionKind } from './insight'

export const ANALYTICS_VIEWS = ['class', 'groups', 'students', 'projects'] as const
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number]

/** The `?view=` value if it names a view; the class view otherwise. */
export function readAnalyticsView(value: string | null): AnalyticsView {
  return (ANALYTICS_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as AnalyticsView)
    : 'class'
}

/** Where the evidence for each recommendation is drawn. A Record, so a new kind cannot be forgotten. */
const VIEW_FOR: Record<ActionKind, AnalyticsView> = {
  overdue_work: 'groups',
  returned_untouched: 'groups',
  stalled_board: 'groups',
  empty_board: 'groups',
  unclaimed_work: 'groups',
  carrying_alone: 'groups',
  will_miss_deadline: 'groups',
  not_in_a_group: 'students',
  holding_nothing: 'students',
  pending_reassignment: 'students',
  deadline_pile_up: 'class',
  syllabus_gap: 'class',
  class_unmeasured: 'class',
}

export function viewForAction(kind: ActionKind): AnalyticsView {
  return VIEW_FOR[kind]
}
