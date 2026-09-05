import { Icon } from './Icon'
import type { Role } from '../../lib/types'

type Choice = Exclude<Role, 'admin'>

const OPTIONS: { value: Choice; label: string; note: string; icon: 'user' | 'users' }[] = [
  { value: 'student', label: 'Student', note: 'Join a group and work the board', icon: 'user' },
  {
    value: 'professor',
    label: 'Professor',
    note: 'Advise groups · needs admin approval',
    icon: 'users',
  },
]

export function RoleChoice({
  value,
  onChange,
}: {
  value: Choice
  onChange: (next: Choice) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium text-ink">I am a</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
                active
                  ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                  : 'surface border-[var(--line)] hover:border-[var(--line-strong)]'
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-[13px] font-semibold ${
                  active ? 'text-navy-700 dark:text-navy-100' : 'text-ink'
                }`}
              >
                <Icon name={o.icon} size={15} />
                {o.label}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{o.note}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
