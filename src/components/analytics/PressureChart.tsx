import { PILE_UP_TASKS } from '../../lib/insight'
import type { Pressure } from '../../lib/insight'

/**
 * Open work by the week it falls due, for the next four weeks.
 *
 * Counting, not forecasting — but it is the only thing on the page a professor
 * can still act on before it happens. A week with eleven tasks landing in it is
 * a week to move something out of.
 *
 * Bars are drawn against the busiest week in view, so the shape is the
 * comparison; the number beside each is the figure itself.
 */
export function PressureChart({ rows }: { rows: Pressure[] }) {
  const overdue = rows.find((r) => r.overdue)
  const weeks = rows
    .filter((r) => !r.overdue && r.week_start)
    .sort((a, b) => (a.week_start ?? '').localeCompare(b.week_start ?? ''))

  if (!overdue && weeks.length === 0) {
    return (
      <p className="text-[13.5px] text-muted">
        No open task in view has a date inside the next four weeks.
      </p>
    )
  }

  const peak = Math.max(1, ...weeks.map((w) => w.due_count))

  return (
    <div className="space-y-2.5">
      {overdue && (
        <p className="flex items-center gap-2 text-[13.5px]">
          <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-[12px] text-red-700 dark:text-red-300">
            {overdue.due_count} overdue
          </span>
          <span className="text-muted">
            across {overdue.board_count} {overdue.board_count === 1 ? 'board' : 'boards'} — past
            the date and not done
          </span>
        </p>
      )}

      <ul className="space-y-1.5">
        {weeks.map((w) => {
          const heavy = w.due_count >= PILE_UP_TASKS
          return (
            <li key={w.week_start} className="flex items-center gap-3">
              <span className="w-[92px] shrink-0 font-mono text-[11.5px] text-faint">
                {new Date(w.week_start ?? '').toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="h-4 flex-1 overflow-hidden rounded-md surface-sunken">
                <span
                  className={`block h-full rounded-md ${
                    heavy ? 'bg-amber-400' : 'bg-navy-600 dark:bg-navy-500'
                  }`}
                  style={{ width: `${Math.round((w.due_count / peak) * 100)}%` }}
                />
              </span>
              <span className="w-[132px] shrink-0 text-right font-mono text-[11.5px] text-muted">
                {w.due_count} {w.due_count === 1 ? 'task' : 'tasks'} · {w.board_count}{' '}
                {w.board_count === 1 ? 'board' : 'boards'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
