import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Select } from '../ui/Select'
import { boardOwnerName, fullName, TASK_STATUSES } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'
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

export function TaskFilters({
  value,
  onChange,
  rows,
  boards,
  showBoards,
}: {
  value: TaskFilterState
  onChange: (next: TaskFilterState) => void
  rows: ProjectTaskRow[]
  boards: BoardSummary[]
  /** A student has one board, so this filter would only ever say one thing. */
  showBoards: boolean
}) {
  // Only offer people who actually hold something here.
  const people = new Map<string, string>()
  for (const t of rows) {
    for (const a of t.assignees) {
      if (a.profile) people.set(a.student_id, fullName(a.profile))
    }
  }

  // An individual project has no groups to offer, so it offers its students.
  const solo = boards.some((b) => b.student_id)
  const boardOptions = boards.map((b) => ({ value: b.id, label: boardOwnerName(b) }))

  const named = (list: { value: string; label: string }[], v: string) =>
    list.find((o) => o.value === v)?.label ?? ''
  const on = [
    value.query && `“${value.query}”`,
    value.board && named(boardOptions, value.board),
    value.assignee === 'unclaimed' ? 'Unclaimed' : value.assignee && people.get(value.assignee),
    value.status && TASK_STATUSES.find((s) => s.value === value.status)?.label,
  ].filter(Boolean) as string[]

  return (
    <FilterPopover
      active={on.length}
      summary={on.join(' · ')}
      onClear={() => onChange(EMPTY_TASK_FILTERS)}
      label="Filter tasks"
    >
      <FilterField label="Search">
        <FilterSearch
          value={value.query}
          onChange={(query) => onChange({ ...value, query })}
          placeholder="Search tasks"
        />
      </FilterField>

      {showBoards && (
        <FilterField label={solo ? 'Student' : 'Group'}>
          <Select
            value={value.board}
            onChange={(e) => onChange({ ...value, board: e.target.value })}
            placeholder={solo ? 'Every student' : 'Every group'}
            options={boardOptions}
            className="!h-10 !text-[13.5px]"
          />
        </FilterField>
      )}

      <FilterField label="Held by">
        <Select
          value={value.assignee}
          onChange={(e) => onChange({ ...value, assignee: e.target.value })}
          placeholder="Anyone"
          options={[
            { value: 'unclaimed', label: 'Unclaimed' },
            ...[...people].map(([id, name]) => ({ value: id, label: name })),
          ]}
          className="!h-10 !text-[13.5px]"
        />
      </FilterField>

      <FilterField label="Status">
        <Select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
          placeholder="Any status"
          options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          className="!h-10 !text-[13.5px]"
        />
      </FilterField>
    </FilterPopover>
  )
}
