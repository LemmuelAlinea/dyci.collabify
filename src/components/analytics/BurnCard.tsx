import { Icon } from '../ui/Icon'
import { burnOwner, projectBurn } from '../../lib/types'
import type { BoardBurn } from '../../lib/types'

/**
 * One board, and whether its remaining work fits before the deadline.
 *
 * The arithmetic is on the card for the same reason it is on the pace card: a
 * professor asked to act on a projection is owed the sum behind it.
 *
 * "Nobody has started" is its own state rather than a rate of zero. A board at
 * zero per day reads as slow; a board nobody has opened is a different problem
 * with a different fix, and it is the one worth catching early.
 */
export function BurnCard({ burn }: { burn: BoardBurn }) {
  const p = projectBurn(burn)
  const submitted = Boolean(burn.submitted_at)

  const tone =
    submitted || p.state === 'done'
      ? 'good'
      : p.state === 'not_started'
        ? 'warn'
        : p.state === 'projected' && !p.fits
          ? 'bad'
          : 'plain'

  const border = {
    good: 'border-emerald-300 dark:border-emerald-500/40',
    warn: 'border-amber-300 dark:border-amber-400/40',
    bad: 'border-red-300 dark:border-red-500/40',
    plain: 'border-line',
  }[tone]

  return (
    <li className={`surface rounded-card border p-4 shadow-card ${border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{burn.project_title}</p>
          <h4 className="mt-0.5 truncate text-[15px] font-medium text-ink">
            {burnOwner(burn)}
          </h4>
        </div>
        <span className="shrink-0 font-mono text-[13px] text-muted">
          {burn.done_count}/{burn.task_count}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full surface-sunken">
        <span
          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${Number(burn.done_pct)}%` }}
        />
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
        <Icon
          name={tone === 'good' ? 'check' : tone === 'plain' ? 'clock' : 'alert'}
          size={13}
          className={`mt-0.5 shrink-0 ${
            tone === 'bad'
              ? 'text-red-600 dark:text-red-400'
              : tone === 'warn'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-faint'
          }`}
        />
        <span>
          {submitted
            ? 'Handed in.'
            : burn.task_count === 0
              ? 'No tasks on this board yet.'
              : p.state === 'done'
                ? 'Every task is finished.'
                : p.state === 'not_started'
                  ? `Nothing started${
                      p.daysLeft === null
                        ? '.'
                        : p.daysLeft < 0
                          ? `, and the deadline passed ${Math.abs(p.daysLeft)} days ago.`
                          : `, with ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left.`
                    }`
                  : p.state === 'no_deadline'
                    ? `${p.rate} a day — the last ${p.remaining} would take about ${p.daysNeeded} ${p.daysNeeded === 1 ? 'day' : 'days'}. No deadline set.`
                    : `${burn.done_count} in ${burn.days_active} ${
                        burn.days_active === 1 ? 'day' : 'days'
                      } is ${p.rate} a day. The last ${p.remaining} ${
                        p.remaining === 1 ? 'wants' : 'want'
                      } about ${p.daysNeeded}, and ${
                        p.daysLeft < 0
                          ? 'the deadline has passed'
                          : p.daysLeft === 1
                            ? '1 remains'
                            : `${p.daysLeft} remain`
                      }.`}
        </span>
      </p>

      {burn.late_count > 0 && (
        <p className="mt-1.5 font-mono text-[11.5px] text-red-600 dark:text-red-400">
          {burn.late_count} handed in late
        </p>
      )}
    </li>
  )
}
