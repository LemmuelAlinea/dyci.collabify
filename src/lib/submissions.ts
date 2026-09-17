import { awaitingDecision, boardOwnerName } from './types'
import type { BoardSummary, ClassSummary } from './types'

/**
 * The professor's Submissions page, as pure logic: which boards belong on it,
 * what state each is in, and what the filters leave.
 *
 * A board is on the page once it has been handed in at least once. That is not
 * the same as `submitted_at` being set: returning work nulls `submitted_at` to
 * give the group their board back, so a query on that column alone would drop
 * every returned board off the page the moment the professor answered it.
 */
export type SubmissionStatus = 'waiting' | 'accepted' | 'returned'

export const SUBMISSION_STATUSES: { value: SubmissionStatus; label: string }[] = [
  { value: 'waiting', label: 'Waiting on you' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'returned', label: 'Returned' },
]

export type SubmissionTiming = '' | 'on_time' | 'late'

export type SubmissionOrder = 'newest' | 'oldest'

export type Submission = BoardSummary & {
  status: SubmissionStatus
  class_name: string
  class_initial: string
  class_section: string
  /** When the last thing happened to it: handed in, or answered. */
  last_event: string
  /** Handed in after the project's deadline. False when that is not known. */
  late: boolean
}

export type SubmissionFilters = {
  query: string
  classId: string
  projectId: string
  status: SubmissionStatus | ''
  timing: SubmissionTiming
  order: SubmissionOrder
}

export const EMPTY_SUBMISSION_FILTERS: SubmissionFilters = {
  query: '',
  classId: '',
  projectId: '',
  status: '',
  timing: '',
  order: 'newest',
}

type StatusFields = Pick<BoardSummary, 'submitted_at' | 'result_at' | 'result_verdict'>

/**
 * Null means the board does not belong on the page: never handed in, or taken
 * back by the group after it was accepted. Handing it in again brings it back
 * as waiting, because it was then submitted after the last answer.
 */
export function submissionStatus(board: StatusFields): SubmissionStatus | null {
  if (awaitingDecision(board)) return 'waiting'
  if (board.submitted_at && board.result_verdict === 'accepted') return 'accepted'
  if (!board.submitted_at && board.result_verdict === 'returned') return 'returned'
  return null
}

/**
 * Only answerable while the work is handed in. A returned board has lost its
 * hand-in time, so whether it was late is unknown rather than false — it
 * matches neither timing filter.
 */
export function handedInLate(board: Pick<BoardSummary, 'submitted_at' | 'project_due_at'>) {
  if (!board.submitted_at || !board.project_due_at) return false
  return new Date(board.submitted_at) > new Date(board.project_due_at)
}

/** Boards joined to the classes they belong to. Boards in other classes drop out. */
export function toSubmissions(
  boards: BoardSummary[],
  classes: Pick<ClassSummary, 'id' | 'name' | 'initial' | 'section'>[],
): Submission[] {
  const byId = new Map(classes.map((c) => [c.id, c]))
  const out: Submission[] = []
  for (const b of boards) {
    const status = submissionStatus(b)
    const cls = byId.get(b.class_id)
    if (!status || !cls) continue
    out.push({
      ...b,
      status,
      class_name: cls.name,
      class_initial: cls.initial,
      class_section: cls.section,
      // A status means one of the two is set, so this is never null.
      last_event: latest(b.submitted_at, b.result_at) as string,
      late: handedInLate(b),
    })
  }
  return out
}

function latest(a: string | null, b: string | null) {
  if (!a) return b
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}

/**
 * Everything except the status filter. Kept apart so the status counts can say
 * how many of each the *other* filters leave — a count that ignored the class
 * you picked would promise rows that are not there when you click it.
 */
export function narrowSubmissions(rows: Submission[], f: SubmissionFilters) {
  const q = f.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.classId && r.class_id !== f.classId) return false
    if (f.projectId && r.project_id !== f.projectId) return false
    if (f.timing === 'late' && !r.late) return false
    if (f.timing === 'on_time' && (!r.submitted_at || r.late)) return false
    if (!q) return true
    return [
      boardOwnerName(r),
      r.project_title,
      r.class_name,
      r.class_initial,
      r.class_section,
      r.submitted_by_name ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
}

export function applySubmissionFilters(rows: Submission[], f: SubmissionFilters) {
  const sign = f.order === 'oldest' ? 1 : -1
  return narrowSubmissions(rows, f)
    .filter((r) => (f.status ? r.status === f.status : true))
    .sort((a, b) => sign * (Date.parse(a.last_event) - Date.parse(b.last_event)))
}

export function countByStatus(rows: Submission[]) {
  const counts: Record<SubmissionStatus, number> = { waiting: 0, accepted: 0, returned: 0 }
  for (const r of rows) counts[r.status] += 1
  return counts
}

/**
 * One section per class, in the order the classes were given, and none for a
 * class the filters emptied. Rows keep the order they arrive in.
 */
export function sectionByClass<T extends Pick<Submission, 'class_id'>>(
  rows: T[],
  classOrder: string[],
) {
  const buckets = new Map<string, T[]>()
  for (const r of rows) {
    const list = buckets.get(r.class_id)
    if (list) list.push(r)
    else buckets.set(r.class_id, [r])
  }
  return classOrder
    .filter((id) => buckets.has(id))
    .map((id) => ({ classId: id, rows: buckets.get(id) as T[] }))
}

/** The projects that have something handed in, for the project filter. */
export function submittedProjects(rows: Submission[], classId: string) {
  const seen = new Map<string, string>()
  for (const r of rows) {
    if (classId && r.class_id !== classId) continue
    if (!seen.has(r.project_id)) seen.set(r.project_id, r.project_title)
  }
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
