import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/** The heading every dashboard panel shares. */
export function DashSection({
  icon,
  title,
  count,
  seeAll,
  seeAllLabel = 'See all',
  children,
}: {
  icon: IconName
  title: string
  count?: number
  seeAll?: string
  seeAllLabel?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[17px]">
          <Icon name={icon} size={17} className="text-faint" />
          {title}
          {typeof count === 'number' && count > 0 && (
            <span className="rounded-full surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">
              {count}
            </span>
          )}
        </h2>
        {seeAll && (
          <Link
            to={seeAll}
            className="flex items-center gap-1 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            {seeAllLabel}
            <Icon name="chevronRight" size={14} />
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}

/** A row of small numbers — the "at a glance" strip at the top of a dashboard. */
export function StatRow({
  stats,
}: {
  stats: { label: string; value: string | number; to?: string; tone?: 'plain' | 'warn' }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => {
        const body = (
          <>
            <p
              className={`font-mono text-[24px] leading-none ${
                s.tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : 'text-ink'
              }`}
            >
              {s.value}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{s.label}</p>
          </>
        )
        return s.to ? (
          <Link
            key={s.label}
            to={s.to}
            className="surface rounded-card border border-line px-4 py-3.5 shadow-card transition-colors duration-250 hover:border-line-strong"
          >
            {body}
          </Link>
        ) : (
          <div
            key={s.label}
            className="surface rounded-card border border-line px-4 py-3.5 shadow-card"
          >
            {body}
          </div>
        )
      })}
    </div>
  )
}
