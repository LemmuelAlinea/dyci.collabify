import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useWideScreen } from '../../hooks/useMediaQuery'

/**
 * The heading every dashboard panel shares — and, on a phone, the control that
 * folds it away.
 *
 * A dashboard laid out in two columns becomes one column on a narrow screen,
 * and six full sections stacked is a scroll nobody finishes. Folded, the same
 * page is a short list of headings that each say how much is inside, so the
 * count is doing real work rather than decorating: somebody can see there are
 * three things due without opening anything.
 *
 * **Only ever on a phone.** Above `md` there is no disclosure at all — no
 * button, no chevron, nothing to press — because the two columns already fit
 * and hiding content there would be taking something away for nothing.
 */
export function DashSection({
  icon,
  title,
  count,
  seeAll,
  seeAllLabel = 'See all',
  defaultOpen = false,
  children,
}: {
  icon: IconName
  title: string
  count?: number
  seeAll?: string
  seeAllLabel?: string
  /** Open on a phone without being asked. Give this to the first of a column. */
  defaultOpen?: boolean
  children: ReactNode
}) {
  const wide = useWideScreen()
  const [open, setOpen] = useState(defaultOpen)
  const shown = wide || open

  const heading = (
    <h2 className="flex items-center gap-2 text-[17px]">
      <Icon name={icon} size={17} className="text-faint" />
      {title}
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-full surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">
          {count}
        </span>
      )}
    </h2>
  )

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {wide ? (
          heading
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex flex-1 items-center justify-between gap-2 text-left"
          >
            {heading}
            <Icon
              name="chevronDown"
              size={17}
              className={`shrink-0 text-faint transition-transform duration-200 ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>
        )}
        {seeAll && shown && (
          <Link
            to={seeAll}
            className="flex items-center gap-1 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            {seeAllLabel}
            <Icon name="chevronRight" size={14} />
          </Link>
        )}
      </header>
      {shown && children}
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
