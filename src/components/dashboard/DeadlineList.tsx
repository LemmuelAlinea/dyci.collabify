import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { TileEmpty } from './Bento'
import { dueSoonLabel } from '../../lib/types'
import type { Deadline } from '../../lib/api/dashboard'

/** Tasks and projects on one line each, overdue first. Flat rows, for a bento tile. */
export function DeadlineList({
  deadlines,
  limit = 5,
}: {
  deadlines: Deadline[]
  limit?: number
}) {
  if (deadlines.length === 0) return <TileEmpty>Nothing due in the next seven days.</TileEmpty>

  return (
    <ul className="-mx-2 divide-y divide-[var(--line)]">
      {deadlines.slice(0, limit).map((d) => {
        const label = dueSoonLabel(d.due_at)
        const late = label === 'Overdue'
        return (
          <li key={`${d.kind}-${d.id}`}>
            <Link
              to={d.to}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                  late
                    ? 'bg-danger-50 text-danger-600 dark:bg-danger-500/12 dark:text-danger-400'
                    : 'surface-sunken text-muted'
                }`}
              >
                <Icon name={d.kind === 'task' ? 'check' : 'kanban'} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{d.title}</span>
                <span className="block truncate text-[12px] text-muted">{d.context}</span>
              </span>
              <span
                className={`shrink-0 font-mono text-[12px] ${
                  late ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
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
