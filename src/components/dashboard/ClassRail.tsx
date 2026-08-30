import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { ClassSummary } from '../../lib/types'

/**
 * The professor's classes, compact, with a way into each.
 *
 * The dashboard never offered one before — a professor read four sections about
 * their classes and then had to go to the nav to open one.
 *
 * It also says which of them are **not ready**, and that is the part worth
 * keeping. A class with no syllabus or no term dates is not a little
 * incomplete: projects cannot be set against weeks that do not exist, and the
 * class is absent from the analytics page entirely rather than shown as empty.
 * That was previously only discoverable by noticing a class missing from a page
 * it was never on.
 */
export function ClassRail({ classes }: { classes: ClassSummary[] }) {
  if (classes.length === 0) return null

  return (
    <ul className="space-y-2">
      {classes.map((c) => {
        const noSyllabus = !c.syllabus_id
        const noDates = !c.term_start || !c.term_end
        const notReady = noSyllabus || noDates

        return (
          <li key={c.id}>
            <Link
              to={`/professor/classes/${c.id}`}
              className="surface flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 transition-colors hover:border-line-strong sm:gap-3 sm:px-3.5 sm:py-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg surface-sunken font-mono text-[12px] font-bold text-navy-600 dark:text-amber-300">
                {c.initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">
                  {c.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted">
                  <span>{c.section}</span>
                  <span className="flex items-center gap-1">
                    <Icon name="users" size={12} />
                    {c.student_count}
                  </span>
                </span>
                {notReady && (
                  <span className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-amber-700 dark:text-amber-300">
                    <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                    {noSyllabus && noDates
                      ? 'No syllabus and no term dates'
                      : noSyllabus
                        ? 'No syllabus attached'
                        : 'No term dates set'}
                  </span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
