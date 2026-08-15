import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { classMeta, fullName } from '../../lib/types'
import type { ClassSummary } from '../../lib/types'

export function ClassCodePill({ code, tone = 'quiet' }: { code: string; tone?: 'quiet' | 'loud' }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-1 font-mono text-[12px] tracking-wide ${
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
 * line, and code + roster size sit below a rule so a grid of these stays scannable.
 */
export function ClassCard({ cls, to }: { cls: ClassSummary; to: string }) {
  const archived = Boolean(cls.archived_at)

  return (
    <Link
      to={to}
      className="group surface flex flex-col rounded-card border border-line p-5 shadow-card transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
    >
      <div className="flex items-start gap-3.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy-600 font-display text-[15px] font-bold tracking-tight text-amber-400 dark:bg-navy-500">
          {cls.initial}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] leading-snug">{cls.name}</h3>
          <p className="mt-1 truncate text-[12.5px] text-muted">{classMeta(cls)}</p>
        </div>
        {archived && (
          <span className="shrink-0 rounded-full surface-sunken px-2.5 py-1 font-mono text-[9.5px] tracking-wider text-faint uppercase">
            Archived
          </span>
        )}
      </div>

      {cls.professor && (
        <p className="mt-3 truncate text-[13px] text-muted">{fullName(cls.professor)}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <ClassCodePill code={cls.code} />
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Icon name="users" size={15} />
          {cls.student_count} {cls.student_count === 1 ? 'student' : 'students'}
        </span>
      </div>
    </Link>
  )
}
