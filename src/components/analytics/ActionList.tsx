import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import type { Action } from '../../lib/insight'

const SHOWN = 6

/**
 * What to do now, worst first.
 *
 * Every card links to the place that already performs the fix rather than
 * performing it here. A professor acting on a chart should land on the board,
 * the project or the console they would have opened anyway — and an
 * irreversible act should never sit one click away from a figure.
 *
 * Six at a time. A list of thirty recommendations is a list nobody finishes,
 * and the ordering is the point of it.
 */
export function ActionList({ actions }: { actions: Action[] }) {
  const [all, setAll] = useState(false)

  if (actions.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Nothing needs you right now"
        body="No board in view is overdue, stalled, unclaimed or waiting on a decision from you."
      />
    )
  }

  const shown = all ? actions : actions.slice(0, SHOWN)

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {shown.map((a) => (
          <li
            key={a.key}
            className={`surface rounded-card border p-4 shadow-card ${
              a.severity === 1
                ? 'border-red-200 dark:border-red-500/30'
                : a.severity === 2
                  ? 'border-amber-300 dark:border-amber-400/40'
                  : 'border-line'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-start gap-2 text-[15px] leading-snug text-ink">
                  <Icon
                    name={a.severity === 1 ? 'alert' : a.severity === 2 ? 'clock' : 'info'}
                    size={15}
                    className={`mt-[3px] shrink-0 ${
                      a.severity === 1
                        ? 'text-red-600 dark:text-red-400'
                        : a.severity === 2
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-faint'
                    }`}
                  />
                  {a.title}
                </h3>
                <p className="mt-1.5 max-w-[70ch] pl-[23px] text-[13px] leading-relaxed text-muted">
                  {a.evidence}
                </p>
                {a.names && a.names.length > 0 && (
                  <p className="mt-1.5 pl-[23px] text-[12.5px] text-faint">
                    {a.names.slice(0, 6).join(', ')}
                    {a.names.length > 6 && ` and ${a.names.length - 6} more`}
                  </p>
                )}
              </div>
              {a.to && (
                <Link
                  to={a.to}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-navy-600 transition-colors hover:border-line-strong dark:text-navy-200"
                >
                  Open
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {actions.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-[12.5px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          {all ? 'Show fewer' : `Show the other ${actions.length - SHOWN}`}
        </button>
      )}
    </div>
  )
}
