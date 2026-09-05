import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { weekRange } from '../../lib/types'
import type { ClassSummary, ClassWeek } from '../../lib/types'

/** Where each class is in its syllabus right now, and what the week expects. */
export function TermStrip({
  weeks,
  classes,
  linkBase,
}: {
  weeks: ClassWeek[]
  classes: ClassSummary[]
  linkBase: string
}) {
  if (weeks.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {weeks.map((w) => {
        const cls = classes.find((c) => c.id === w.class_id)
        return (
          <Link
            key={w.week_id}
            to={`${linkBase}/${w.class_id}`}
            className="surface rounded-card border border-amber-400 bg-amber-400/8 p-4 transition-colors hover:border-amber-500"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[14px] font-semibold text-ink">
                {cls ? cls.initial : 'Class'} · Week {w.week_no}
              </p>
              <p className="font-mono text-[12px] text-faint">{weekRange(w)}</p>
            </div>
            {w.title && <p className="mt-1 text-[13px] text-ink">{w.title}</p>}
            {w.topics && (
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
                {w.topics}
              </p>
            )}
            {w.assessments && (
              <p className="mt-2 flex gap-1.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                {w.assessments}
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}
