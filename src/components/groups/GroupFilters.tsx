import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
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

  const on = [
    value.query && `“${value.query}”`,
    value.classId && classes.find((c) => c.id === value.classId)?.initial,
    value.setId && sets.find((s) => s.id === value.setId)?.name,
  ].filter(Boolean) as string[]

  return (
    <FilterPopover
      active={on.length}
      summary={on.join(' · ')}
      onClear={() => onChange(EMPTY_FILTERS)}
      label="Filter groups"
    >
      <FilterField label="Search">
        <FilterSearch
          value={value.query}
          onChange={(query) => onChange({ ...value, query })}
          placeholder="Search groups or members"
        />
      </FilterField>

      <FilterField label="Class">
        <Select
          value={value.classId}
          onChange={(e) => onChange({ ...value, classId: e.target.value, setId: '' })}
          placeholder="All classes"
          options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
          className="!h-10 !text-[13.5px]"
        />
      </FilterField>

      {showSetFilter && (
        <FilterField label="Group set">
          <Select
            value={value.setId}
            onChange={(e) => onChange({ ...value, setId: e.target.value })}
            placeholder="All sets"
            options={visibleSets.map((s) => ({ value: s.id, label: s.name }))}
            className="!h-10 !text-[13.5px]"
          />
        </FilterField>
      )}
    </FilterPopover>
  )
}
