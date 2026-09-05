import { Icon } from '../ui/Icon'
import { weekRange } from '../../lib/types'
import type { ClassWeek } from '../../lib/types'

const PHASE = {
  past: {
    dot: 'bg-[var(--line-strong)]',
    card: 'border-line opacity-70',
    label: 'Done',
  },
  current: {
    dot: 'bg-amber-400 ring-4 ring-amber-400/25',
    card: 'border-amber-400 bg-amber-400/8',
    label: 'This week',
  },
  upcoming: {
    dot: 'bg-navy-400',
    card: 'border-line',
    label: '',
  },
  undated: {
    dot: 'bg-[var(--line-strong)]',
    card: 'border-line',
    label: '',
  },
} as const

export function WeekMap({ weeks }: { weeks: ClassWeek[] }) {
  const remaining = weeks.filter((w) => w.phase === 'upcoming').length
  const current = weeks.find((w) => w.phase === 'current')
  const undated = weeks.some((w) => w.phase === 'undated')

  return (
    <div className="space-y-5">
      {!undated && (
        <div className="surface flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line px-5 py-4 shadow-card">
          <p className="text-[14px] text-muted">
            {current ? (
              <>
                Now in{' '}
                <strong className="text-ink">
                  week {current.week_no}
                  {current.title ? ` · ${current.title}` : ''}
                </strong>
              </>
            ) : (
              'The term is outside its dates right now'
            )}
          </p>
          <p className="text-[14px] text-muted">
            <strong className="text-ink">{remaining}</strong>{' '}
            {remaining === 1 ? 'week' : 'weeks'} remaining of {weeks.length}
          </p>
        </div>
      )}

      <ol className="relative space-y-3 pl-6">
        {/* The spine makes the term read as one run rather than loose cards. */}
        <span aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-[var(--line)]" />

        {weeks.map((w) => {
          const p = PHASE[w.phase]
          return (
            <li key={w.week_id} className="relative">
              <span
                aria-hidden
                className={`absolute top-5 -left-[22px] h-[11px] w-[11px] rounded-full ${p.dot}`}
              />
              <div className={`surface rounded-card border px-4 py-3.5 ${p.card}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[14px] font-semibold text-ink">
                    Week {w.week_no}
                    {w.title ? ` · ${w.title}` : ''}
                  </p>
                  <p className="flex items-center gap-2 font-mono text-[12px] text-faint">
                    {weekRange(w)}
                    {p.label && (
                      <span
                        className={`rounded-full px-2 py-0.5 tracking-wide uppercase ${
                          w.phase === 'current'
                            ? 'bg-amber-400 text-navy-900'
                            : 'surface-sunken text-muted'
                        }`}
                      >
                        {p.label}
                      </span>
                    )}
                  </p>
                </div>

                {w.topics && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{w.topics}</p>
                )}
                {w.outcomes && (
                  <p className="mt-1.5 flex gap-2 text-[12px] leading-relaxed text-faint">
                    <Icon name="target" size={13} className="mt-0.5 shrink-0" />
                    {w.outcomes}
                  </p>
                )}
                {/* What a project for this week would be built against. */}
                {w.assessments && (
                  <p className="mt-2 flex gap-2 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                    <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                    {w.assessments}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
