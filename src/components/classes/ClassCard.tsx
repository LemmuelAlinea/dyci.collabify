import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { classMeta, fullName } from '../../lib/types'
import type { ClassSummary } from '../../lib/types'

export function ClassCodePill({ code, tone = 'quiet' }: { code: string; tone?: 'quiet' | 'loud' }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 font-mono text-[11px] tracking-wide sm:px-2.5 sm:py-1 sm:text-[12px] ${
        tone === 'loud'
          ? 'bg-navy-600 text-amber-300 dark:bg-navy-500'
          : 'bg-navy-50 text-navy-700 dark:bg-navy-500/18 dark:text-navy-100'
      }`}
    >
      {code}
    </span>
  )
}

/**
 * Monogram tile: the initial anchors the card, the class name is the dominant
 * line, and code + roster size sit below a rule so a grid of these stays
 * scannable.
 *
 * Two of these fit across a phone. At 390px that is a 174px card, which is
 * enough for the monogram, two lines of name and the footer — so the sizes
 * below step down at `sm` rather than being one size that has to work at both
 * widths. One card per row wasted half the screen on a list whose whole job is
 * to be scanned.
 */
export function ClassCard({ cls, to }: { cls: ClassSummary; to: string }) {
  const archived = Boolean(cls.archived_at)

  return (
    <Link
      to={to}
      className="group surface flex flex-col rounded-card border border-line p-3.5 shadow-card transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift sm:p-5"
    >
      <div className="flex items-start gap-2.5 sm:gap-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy-600 font-display text-[12px] font-bold tracking-tight text-amber-400 sm:h-12 sm:w-12 sm:rounded-xl sm:text-[15px] dark:bg-navy-500">
          {cls.initial}
        </span>
        <div className="min-w-0 flex-1">
          {/* Two lines on a phone rather than one truncated one: at 174px a
              truncated class name is often just its course code. */}
          <h3 className="line-clamp-2 text-[14px] leading-snug sm:truncate sm:text-[17px]">
            {cls.name}
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-muted sm:mt-1 sm:text-[12.5px]">
            {classMeta(cls)}
          </p>
        </div>
        {archived && (
          <span className="shrink-0 rounded-full surface-sunken px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-faint uppercase sm:px-2.5 sm:py-1">
            Archived
          </span>
        )}
      </div>

      {cls.professor && (
        <p className="mt-2 truncate text-[11.5px] text-muted sm:mt-3 sm:text-[13px]">
          {fullName(cls.professor)}
        </p>
      )}

      {/* Wraps on a narrow card instead of squeezing the code pill. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line pt-2.5 sm:pt-3.5">
        <ClassCodePill code={cls.code} />
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted sm:text-[12.5px]">
          <Icon name="users" size={14} />
          {cls.student_count}
          <span className="hidden sm:inline">
            {cls.student_count === 1 ? ' student' : ' students'}
          </span>
        </span>
      </div>
    </Link>
  )
}
