import type { Action } from './insight'

export const ANALYTICS_VIEWS = ['class', 'groups', 'students', 'projects'] as const
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number]

/** The `?view=` value if it names a view; the class view otherwise. */
export function readAnalyticsView(value: string | null): AnalyticsView {
  return (ANALYTICS_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as AnalyticsView)
    : 'class'
}

/**
 * Where "See why" lands: the view, and the element ids that hold the evidence,
 * most exact first. The page scrolls to the first one it finds, so a card
 * whose row is filtered away still lands on the section that argues for it.
 *
 * A board with no group (an individual project) is not in the group grid; its
 * student's row on the roster is the evidence instead. `soloStudentOf` answers
 * null for a group board, and '' for a solo board whose student is unknown.
 */
export function evidenceFor(
  a: Pick<Action, 'kind' | 'classId' | 'boardId' | 'studentId' | 'n' | 'at' | 'names'>,
  soloStudentOf: (boardId: string) => string | null,
): { view: AnalyticsView; ids: string[] } {
  const student = (id: string | null | undefined) => (id ? [`attn-student-${a.classId}:${id}`] : [])
  const solo = a.boardId ? soloStudentOf(a.boardId) : null
  switch (a.kind) {
    case 'overdue_work':
    case 'returned_untouched':
    case 'stalled_board':
    case 'empty_board':
    case 'unclaimed_work':
      if (solo !== null) return { view: 'students', ids: [...student(solo), 'attn-students'] }
      return { view: 'groups', ids: a.boardId ? [`attn-board-${a.boardId}`, 'attn-health'] : ['attn-health'] }
    case 'carrying_alone':
      return { view: 'groups', ids: a.boardId ? [`attn-share-${a.boardId}`, 'attn-share'] : ['attn-share'] }
    case 'will_miss_deadline':
      if (solo !== null) return { view: 'students', ids: [...student(solo), 'attn-students'] }
      return { view: 'groups', ids: a.boardId ? [`attn-burn-${a.boardId}`, 'attn-forecast'] : ['attn-forecast'] }
    case 'follow_up_due':
      return a.studentId
        ? { view: 'students', ids: [...student(a.studentId), 'attn-students'] }
        : { view: 'groups', ids: a.boardId ? [`attn-share-${a.boardId}`, `attn-board-${a.boardId}`] : [] }
    case 'not_in_a_group':
    case 'holding_nothing':
    case 'pending_reassignment':
      return { view: 'students', ids: [...(a.names ? [] : student(a.studentId)), 'attn-students'] }
    case 'deadline_pile_up':
      return { view: 'class', ids: a.at ? [`attn-week-${a.at.slice(0, 10)}`, 'attn-pressure'] : ['attn-pressure'] }
    case 'syllabus_gap':
      return {
        view: 'class',
        ids: !a.names && a.n != null ? [`attn-gap-${a.classId}-${a.n}`, 'attn-gaps'] : ['attn-gaps'],
      }
    case 'class_unmeasured':
      return { view: 'class', ids: [`attn-unmeasured-${a.classId}`, 'attn-unmeasured'] }
  }
}
