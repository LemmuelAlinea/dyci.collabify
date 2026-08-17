import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { dueSoonLabel } from '../../lib/types'
import type { Deadline } from '../../lib/api/dashboard'

/** Tasks and projects on one line each, overdue first. */
export function DeadlineList({ deadlines }: { deadlines: Deadline[] }) {
  if (deadlines.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
        Nothing due in the next seven days.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {deadlines.map((d) => {
        const label = dueSoonLabel(d.due_at)
        const late = label === 'Overdue'
        return (
          <li key={`${d.kind}-${d.id}`}>
            <Link
              to={d.to}
              className={`surface flex items-center gap-3 rounded-xl border px-4 py-3 shadow-card transition-colors hover:border-line-strong ${
                late ? 'border-red-300 dark:border-red-500/40' : 'border-line'
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  late
                    ? 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-400'
                    : 'surface-sunken text-muted'
                }`}
              >
                <Icon name={d.kind === 'task' ? 'check' : 'kanban'} size={15} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium text-ink">
                  {d.title}
                </span>
                <span className="block truncate text-[12.5px] text-muted">{d.context}</span>
              </span>

              <span
                className={`shrink-0 font-mono text-[12px] ${
                  late ? 'text-red-600 dark:text-red-400' : 'text-faint'
                }`}
              >
                {label}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
