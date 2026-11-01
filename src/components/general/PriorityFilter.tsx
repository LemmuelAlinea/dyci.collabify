// src/components/general/PriorityFilter.tsx
import { PRIORITIES } from '../../lib/general/types'
import type { TaskPriority } from '../../lib/general/types'
import type { PriorityView, PrioritySort } from '../../lib/general/taskFilters'
import { FilterField } from '../ui/FilterPopover'
import { Select } from '../ui/Select'

/**
 * The Priority filter (pick any number) and the Sort choice, for the inside of
 * a FilterPopover. Chips rather than a select, since several can be on.
 */
export function PriorityFilter({ value, onChange }: { value: PriorityView; onChange: (next: PriorityView) => void }) {
  function toggle(priority: TaskPriority) {
    const on = value.priorities.includes(priority)
    onChange({
      ...value,
      priorities: PRIORITIES.map((p) => p.value).filter((p) => (p === priority ? !on : value.priorities.includes(p))),
    })
  }

  return (
    <>
      <div className="space-y-1">
        <span className="text-[12px] font-medium text-muted">Priority</span>
        <div role="group" aria-label="Priority" className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => {
            const on = value.priorities.includes(p.value)
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.value)}
                className={`h-8 rounded-lg border px-3 text-[13px] transition-colors ${
                  on
                    ? 'border-navy-400 bg-navy-500/10 font-medium text-navy-600 dark:text-navy-200'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <FilterField label="Sort">
        <Select
          aria-label="Sort"
          value={value.sort}
          onChange={(e) => onChange({ ...value, sort: e.target.value as PrioritySort })}
          placeholder="Current order"
          options={[{ value: 'priority', label: 'Priority' }]}
          className="!h-10 !text-[13px]"
        />
      </FilterField>
    </>
  )
}
