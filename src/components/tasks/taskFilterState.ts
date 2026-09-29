import type { ProjectTaskRow } from '../../lib/api/tasks'

export type TaskFilterState = {
  query: string
  /**
   * A board, not a group. An individual project's boards have no group at all,
   * so keying this on the group made every tile on one unselectable.
   */
  board: string
  assignee: string
  status: string
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
  query: '',
  board: '',
  assignee: '',
  status: '',
}

/** Applied the same way by the summary, the board, and the list. */
export function applyTaskFilters(rows: ProjectTaskRow[], f: TaskFilterState) {
  const q = f.query.trim().toLowerCase()
  return rows
    .filter((t) => (f.board ? t.board_id === f.board : true))
    .filter((t) =>
      f.assignee
        ? f.assignee === 'unclaimed'
          ? t.assignees.length === 0
          : t.assignees.some((a) => a.student_id === f.assignee)
        : true,
    )
    .filter((t) => (f.status ? t.status === f.status : true))
    .filter((t) =>
      q ? `${t.title} ${t.details} ${t.group_name ?? ''}`.toLowerCase().includes(q) : true,
    )
}
