import { useNow } from '../../hooks/useNow'
import { daysBetween, isStuck, manilaDay } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

/** Tasks in progress for a week or more, oldest first. */
export function StuckWork({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const now = new Date(useNow())
  const today = manilaDay(now)
  const stuck = data.shownTasks
    .filter((t) => isStuck(t, now))
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
  if (stuck.length === 0) {
    return <p className="text-[13px] text-muted">Nothing has been in progress for a week or more.</p>
  }
  return (
    <ul className="space-y-2">
      {stuck.map((t) => (
        <li key={t.task_id}>
          <button
            type="button"
            onClick={() => onOpenTask(t.task_id)}
            className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{t.title}</span>
              <span className="block truncate text-[12px] text-faint">
                {t.group_name ?? t.board_student_name} · {t.assignee_names || 'nobody'}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-warning-400/20 px-2 py-0.5 font-mono text-[12px] text-warning-700 dark:text-warning-300">
              {daysBetween(manilaDay(t.started_at as string), today)} days
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
