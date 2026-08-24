import { Icon } from '../ui/Icon'
import { projectFinish } from '../../lib/types'
import type { ClassPace } from '../../lib/types'

/**
 * Will this class finish its syllabus.
 *
 * The arithmetic is on the card on purpose. A professor asked to act on a
 * projection is owed the sum behind it, and this one is small enough to print:
 * weeks covered over weeks elapsed, extended across what is left. Nothing here
 * is a model, and nothing pretends to be.
 */
export function PaceCard({ pace }: { pace: ClassPace }) {
  const p = projectFinish(pace)
  const started = pace.weeks_covered > 0
  const good = started && p.finishesInTerm
  const weeksLeft = pace.weeks_in_term - pace.weeks_elapsed

  return (
    <section
      className={`surface rounded-card border p-4 sm:p-5 shadow-card ${
        !started
          ? 'border-line'
          : good
            ? 'border-emerald-300 dark:border-emerald-500/40'
            : 'border-red-300 dark:border-red-500/40'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{pace.class_initial}</p>
          <h3 className="mt-1 flex items-center gap-2 text-[17px] leading-snug">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                !started
                  ? 'surface-sunken text-muted'
                  : good
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/15 text-red-700 dark:text-red-300'
              }`}
            >
              <Icon name={good ? 'check' : 'alert'} size={15} />
            </span>
            {!started
              ? 'Nothing set against the syllabus yet'
              : good
                ? `On pace, with ${p.weeksSpare} ${p.weeksSpare === 1 ? 'week' : 'weeks'} spare`
                : `Not on pace to finish the syllabus`}
          </h3>

          {started && (
            <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
              {pace.weeks_covered} of {pace.weeks_total} weeks covered in {pace.weeks_elapsed}{' '}
              {pace.weeks_elapsed === 1 ? 'week' : 'weeks'} — {p.rate} a week. The remaining{' '}
              {p.remaining} would take about {p.weeksNeeded}{' '}
              {p.weeksNeeded === 1 ? 'week' : 'weeks'}, and {weeksLeft}{' '}
              {weeksLeft === 1 ? 'week is' : 'weeks are'} left in the term.
            </p>
          )}
          {!started && (
            <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
              No project is bound to a syllabus week, so there is no pace to measure yet.
            </p>
          )}
        </div>

        <dl className="flex shrink-0 gap-5">
          {[
            ['Covered', `${pace.weeks_covered}/${pace.weeks_total}`],
            ['Elapsed', `${pace.weeks_elapsed}/${pace.weeks_in_term}`],
            ['Rate', started ? `${p.rate}/wk` : '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="font-mono text-[15px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
