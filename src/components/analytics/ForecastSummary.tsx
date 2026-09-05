import { Icon } from '../ui/Icon'
import { forecast, shortDate } from '../../lib/insight'
import { burnOwner } from '../../lib/types'
import type { BoardBurn } from '../../lib/types'

/**
 * Where every board in view lands, at the rate it is actually moving.
 *
 * The projection is `projectBurn`'s and nothing here recalculates it — this
 * only turns "18 days needed" into a date, because a date is the thing a
 * professor can plan against.
 *
 * Boards nobody has started are counted apart. A board at nought a day is not
 * slow, it is unstarted, and the fix is a different one.
 */
export function ForecastSummary({ burns }: { burns: BoardBurn[] }) {
  const live = burns.filter((b) => !b.submitted_at && b.result_verdict !== 'accepted')
  const rows = live.map((b) => ({ b, f: forecast(b) }))

  const late = rows.filter(({ f }) => f.lateBy !== null)
  const unstarted = rows.filter(({ f }) => f.burn.state === 'not_started')
  const measured = rows.filter(({ f }) => f.finishOn !== null)

  if (live.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        Every board in view is handed in or accepted, so there is nothing left to project.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="max-w-[70ch] text-[14px] leading-relaxed text-ink">
        {measured.length === 0 ? (
          <>
            No board in view has finished enough work to measure a rate yet
            {unstarted.length > 0 && `, and ${unstarted.length} of ${live.length} have not started`}
            .
          </>
        ) : (
          <>
            <strong className="font-semibold">
              {late.length} of {measured.length}
            </strong>{' '}
            {measured.length === 1 ? 'board' : 'boards'} with a measurable rate{' '}
            {late.length === 1 ? 'lands' : 'land'} after {late.length === 1 ? 'its' : 'their'}{' '}
            deadline
            {unstarted.length > 0 && (
              <>
                , and {unstarted.length} {unstarted.length === 1 ? 'has' : 'have'} not started at
                all
              </>
            )}
            .
          </>
        )}
      </p>

      {late.length > 0 && (
        <ul className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {late
            .sort((a, b) => (b.f.lateBy ?? 0) - (a.f.lateBy ?? 0))
            .map(({ b, f }) => (
              <li
                key={b.board_id}
                className="surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-red-200 px-3.5 py-2.5 dark:border-red-500/30"
              >
                <Icon
                  name="clock"
                  size={14}
                  className="shrink-0 text-red-600 dark:text-red-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{burnOwner(b)}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {b.project_title} · {b.done_count} of {b.task_count} done in{' '}
                    {b.days_active} {b.days_active === 1 ? 'day' : 'days'}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-muted">
                  lands {f.finishOn && shortDate(f.finishOn)}
                </span>
                <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[12px] text-red-700 dark:text-red-300">
                  {f.lateBy} {f.lateBy === 1 ? 'day' : 'days'} late
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
