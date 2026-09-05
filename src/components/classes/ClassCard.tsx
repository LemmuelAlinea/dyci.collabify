import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { classMeta, fullName } from '../../lib/types'
import type { ClassSummary } from '../../lib/types'

export function ClassCodePill({ code, tone = 'quiet' }: { code: string; tone?: 'quiet' | 'loud' }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 font-mono text-[12px] tracking-wide @min-[240px]:px-2.5 @min-[240px]:py-1 @min-[240px]:text-[12px] ${
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
export function ClassCard({
  cls,
  to,
  audience,
  index,
}: {
  cls: ClassSummary
  to: string
  audience: 'professor' | 'student'
  index: number
}) {
  const archived = Boolean(cls.archived_at)
  const ready = Boolean(cls.syllabus_id && cls.term_start && cls.term_end)
  const status = archived
    ? 'Archived'
    : audience === 'professor'
      ? ready
        ? 'Ready for the term'
        : 'Setup needed'
      : ready
        ? 'Term scheduled'
        : 'Schedule pending'

  return (
    <Link
      to={to}
      className="group relative flex min-h-[248px] overflow-hidden rounded-card border border-line bg-[var(--surface)] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong"
    >
      <div className="flex w-full flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.18em] text-faint uppercase">
            Class {String(index + 1).padStart(2, '0')}
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              ready && !archived
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'surface-sunken text-muted'
            }`}
          >
            {status}
          </span>
        </div>

        <div className="mt-5 flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy-950 font-display text-[14px] font-bold text-amber-300 ring-1 ring-white/10">
            {cls.initial}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[17px] leading-snug text-ink transition-colors group-hover:text-navy-600 dark:group-hover:text-amber-300">
              {cls.name}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{classMeta(cls)}</p>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 min-h-[42px] text-[13px] leading-relaxed text-muted">
          {cls.description ||
            (audience === 'professor'
              ? 'Open the class workspace to manage its roster, projects and term materials.'
              : 'Open the class workspace for announcements, projects and your group work.')}
        </p>

        <div className="mt-auto flex items-end justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            {audience === 'student' && cls.professor ? (
              <>
                <p className="text-[11px] text-faint">Professor</p>
                <p className="mt-0.5 truncate text-[13px] font-medium text-ink">
                  {fullName(cls.professor)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] text-faint">Class code</p>
                <div className="mt-1">
                  <ClassCodePill code={cls.code} />
                </div>
              </>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
            <Icon name="users" size={14} />
            {cls.student_count} {cls.student_count === 1 ? 'student' : 'students'}
          </span>
        </div>
      </div>
    </Link>
  )
}
