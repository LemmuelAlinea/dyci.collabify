import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { fullName, TASK_STATUSES } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'
import type { ProjectTaskRow } from '../../lib/api/tasks'

export type TaskFilterState = {
  query: string
  group: string
  assignee: string
  status: string
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
  query: '',
  group: '',
  assignee: '',
  status: '',
}

/** Applied the same way by the summary, the board, and the list. */
export function applyTaskFilters(rows: ProjectTaskRow[], f: TaskFilterState) {
  const q = f.query.trim().toLowerCase()
  return rows
    .filter((t) => (f.group ? t.group_id === f.group : true))
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
  showGroups,
}: {
  value: TaskFilterState
  onChange: (next: TaskFilterState) => void
  rows: ProjectTaskRow[]
  boards: BoardSummary[]
  /** A student has one board, so the group filter would only ever say one thing. */
  showGroups: boolean
}) {
  // Only offer people who actually hold something here.
  const people = new Map<string, string>()
  for (const t of rows) {
    for (const a of t.assignees) {
      if (a.profile) people.set(a.student_id, fullName(a.profile))
    }
  }

  const groups = boards
    .filter((b) => b.group_id)
    .map((b) => ({ value: b.group_id as string, label: b.group_name ?? 'Group' }))

  return (
    <div
      className={`grid gap-2.5 ${
        showGroups
          ? 'sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]'
          : 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]'
      }`}
    >
      <div className="relative">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          placeholder="Search tasks"
          className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pr-4 pl-10 text-[14px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12 focus:outline-none"
        />
      </div>

      {showGroups && (
        <Select
          aria-label="Filter by group"
          value={value.group}
          onChange={(e) => onChange({ ...value, group: e.target.value })}
          placeholder="Every group"
          options={groups}
          className="!h-10 !text-[13.5px]"
        />
      )}

      <Select
        aria-label="Filter by assignee"
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
        placeholder="Anyone"
        options={[
          { value: 'unclaimed', label: 'Unclaimed' },
          ...[...people].map(([id, name]) => ({ value: id, label: name })),
        ]}
        className="!h-10 !text-[13.5px]"
      />

      <Select
        aria-label="Filter by status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value })}
        placeholder="Any status"
        options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        className="!h-10 !text-[13.5px]"
      />
    </div>
  )
}
