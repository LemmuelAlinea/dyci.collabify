import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/EmptyState'
import type { ClassGap } from '../../lib/types'

/**
 * Weeks the syllabus expects something in, with nothing set against them.
 *
 * Not a prediction and not a threshold — the syllabus says Lab 6 happens in
 * week 11, and nothing does. Past weeks come first because those are the ones
 * already missed.
 */
export function GapList({ gaps }: { gaps: ClassGap[] }) {
  if (gaps.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Every assessed week has work against it"
        body="Each syllabus week naming something to hand in has a project bound to it."
      />
    )
  }

  const order = { past: 0, current: 1, upcoming: 2, undated: 3 } as const
  const sorted = [...gaps].sort(
    (a, b) => order[a.phase] - order[b.phase] || a.week_no - b.week_no,
  )
  const missed = gaps.filter((g) => g.phase === 'past').length

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        <strong className="text-ink">{gaps.length}</strong>{' '}
        {gaps.length === 1 ? 'week names' : 'weeks name'} something to hand in with no project
        against {gaps.length === 1 ? 'it' : 'them'}
        {missed > 0 && (
          <span className="text-red-600 dark:text-red-400">
            {' · '}
            {missed} already gone by
          </span>
        )}
      </p>

      <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
        {sorted.map((g) => (
          <li
            key={`${g.class_id}-${g.week_no}`}
            className={`surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 ${
              g.phase === 'past'
                ? 'border-red-200 dark:border-red-500/30'
                : g.phase === 'current'
                  ? 'border-amber-300 dark:border-amber-400/40'
                  : 'border-line'
            }`}
          >
            <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">
              Week {g.week_no}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{g.week_title}</span>
              <span className="block truncate text-[12px] text-amber-700 dark:text-amber-300">
                {g.assessments}
              </span>
            </span>
            {g.phase === 'past' && (
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-red-600 dark:text-red-400">
                <Icon name="alert" size={13} />
                missed
              </span>
            )}
            {g.phase === 'current' && (
              <span className="shrink-0 text-[12px] text-amber-700 dark:text-amber-300">
                this week
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
