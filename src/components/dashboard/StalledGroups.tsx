import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { StalledBoard } from '../../lib/api/dashboard'

/**
 * The groups a professor cannot spot without opening every board: nothing put
 * on the board at all, or nothing touched in a week.
 */
export function StalledGroups({ boards }: { boards: StalledBoard[] }) {
  if (boards.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        Every group has moved something in the last seven days.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {boards.map((b) => (
        <li key={b.id}>
          <Link
            to={`/professor/projects/${b.project_id}`}
            className="surface flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-300 px-4 py-3 shadow-card transition-colors hover:border-amber-500 dark:border-amber-400/40"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-400/18 text-amber-700 dark:text-amber-300">
              <Icon name={b.reason === 'empty' ? 'alert' : 'clock'} size={15} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">
                {b.group_name ?? 'One student'}
              </span>
              <span className="block truncate text-[12px] text-muted">
                {b.project_title}
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[12px] text-amber-700 dark:text-amber-300">
                {b.reason === 'empty'
                  ? 'No tasks at all'
                  : `Quiet for ${b.days} day${b.days === 1 ? '' : 's'}`}
              </span>
              <span className="block font-mono text-[12px] text-faint">
                {b.done_count}/{b.task_count} done · {Number(b.done_pct)}%
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
