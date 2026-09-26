import type { Scope } from '../../lib/scope'

const OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'classes', label: 'Classes' },
  { value: 'work', label: 'Work' },
]

/**
 * The All · Classes · Work segmented control shared by Messages, My tasks
 * and Calendar. Same markup as the Active/Archived toggle in ProfessorClasses.
 */
export function ScopeFilter({
  value,
  onChange,
  counts,
}: {
  value: Scope
  onChange: (scope: Scope) => void
  counts?: Partial<Record<Scope, number>>
}) {
  return (
    <div role="group" aria-label="Show" className="flex gap-1 rounded-lg surface-sunken p-1">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-4 py-1.5 text-[13px] transition-colors duration-150 ${
            value === option.value
              ? 'surface font-medium text-ink ring-1 ring-[var(--line)]'
              : 'text-muted hover:text-ink'
          }`}
        >
          {option.label}
          {counts?.[option.value] !== undefined && (
            <span className="ml-1.5 text-faint">{counts[option.value]}</span>
          )}
        </button>
      ))}
    </div>
  )
}
