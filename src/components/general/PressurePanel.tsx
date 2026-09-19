import { formatDue } from '../../lib/general/dates'
import { dueByWeek, overdueTasks } from '../../lib/general/pressure'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * What is already late, and what lands in the next four weeks.
 *
 * Bars are drawn against the busiest week in view, so the shape is the
 * comparison; the number beside each is the figure itself. The same reading
 * Education's PressureChart offers, for the same reason.
 */
export function PressurePanel({
  state,
  onOpen,
}: {
  state: GeneralProjectState
  onOpen: (taskId: string) => void
}) {
  const late = overdueTasks(state.tasks)
  const weeks = dueByWeek(state.tasks)
  const peak = Math.max(1, ...weeks.map((w) => w.count))
  const ahead = weeks.reduce((n, w) => n + w.count, 0)

  if (late.length === 0 && ahead === 0) {
    return (
      <p className="text-[13px] text-muted">
        Nothing is overdue, and no open task falls due in the next four weeks.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {late.length > 0 && (
        <div>
          <p className="flex items-center gap-2 text-[13px]">
            <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-[12px] text-red-700 dark:text-red-300">
              {late.length} overdue
            </span>
            <span className="text-muted">past the date and not done</span>
          </p>
          <ul className="mt-2 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
            {late.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title}</span>
                  <span className="shrink-0 text-[12px] text-red-700 dark:text-red-300">
                    {t.due_at ? formatDue(t.due_at) : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {late.length > 6 && (
            <p className="mt-1.5 text-[12px] text-faint">
              and {late.length - 6} more on the Tasks tab
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-[13px] text-muted">Falling due, week by week</p>
        <ul className="mt-2 space-y-1.5">
          {weeks.map((w) => (
            <li key={w.start} className="flex items-center gap-2">
              {/* `w.label` names the day the week BEGINS, not a due day — a task
                  counted here can fall due up to six days after that date. "Week
                  of" keeps that reading honest for sighted and screen-reader
                  users alike, instead of presenting the label as a deadline. */}
              <span className="w-24 shrink-0 font-mono text-[11px] text-faint">Week of {w.label}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full surface-sunken">
                <span
                  className="block h-full rounded-full bg-navy-500/45"
                  style={{ width: `${(w.count / peak) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">
                {w.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
