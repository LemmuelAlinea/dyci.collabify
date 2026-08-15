import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import type { ClassSummary, GroupSet } from '../../lib/types'

export type GroupFilterState = {
  query: string
  classId: string
  setId: string
}

export const EMPTY_FILTERS: GroupFilterState = { query: '', classId: '', setId: '' }

export function GroupFilters({
  value,
  onChange,
  classes,
  sets,
  showSetFilter = true,
}: {
  value: GroupFilterState
  onChange: (next: GroupFilterState) => void
  classes: ClassSummary[]
  sets: GroupSet[]
  /** Off for students: they only ever see their own groups, so browsing by set
      would imply there is something else to find. */
  showSetFilter?: boolean
}) {
  // Only offer sets belonging to the chosen class, so the two filters cannot
  // combine into an empty result by accident.
  const visibleSets = value.classId ? sets.filter((s) => s.class_id === value.classId) : sets

  return (
    <div
      className={`grid gap-3 ${
        showSetFilter
          ? 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]'
          : 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'
      }`}
    >
      <div className="relative">
        <Icon
          name="search"
          size={17}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          placeholder="Search groups or members"
          className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pr-4 pl-11 text-[14.5px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12 focus:outline-none"
        />
      </div>

      <Select
        aria-label="Filter by class"
        value={value.classId}
        onChange={(e) => onChange({ ...value, classId: e.target.value, setId: '' })}
        placeholder="All classes"
        options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
        className="!h-11"
      />

      {showSetFilter && (
        <Select
          aria-label="Filter by group set"
          value={value.setId}
          onChange={(e) => onChange({ ...value, setId: e.target.value })}
          placeholder="All sets"
          options={visibleSets.map((s) => ({ value: s.id, label: s.name }))}
          className="!h-11"
        />
      )}
    </div>
  )
}
