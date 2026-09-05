import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/**
 * The top of every page inside the app, said once.
 *
 * Thirty-odd pages each spelled out their own: a mono kicker, a heading at one
 * of four different sizes, sometimes a description, sometimes a button floated
 * right. They drifted, and the drift was the loudest thing about the app —
 * every page announced itself differently, so none of them felt like the same
 * product.
 *
 * The anatomy here is fixed: what this page is, one line of why, and what you
 * can do on it. Anything a page wants to add goes underneath, not inside.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: string
  /** One line. If it needs two, the page is doing more than one job. */
  description?: string
  actions?: ReactNode
  back?: { to: string; label: string }
  /** Filters, tabs, or a state band — anything that belongs to the header. */
  children?: ReactNode
}) {
  return (
    <header className="mb-6">
      {/* Link, not an anchor: a plain href reloads the whole app to go one page
          back, which throws away every query already in memory. */}
      {back && (
        <Link
          to={back.to}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
        >
          <Icon name="arrowLeft" size={15} />
          {back.label}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className=" leading-tight font-semibold text-ink sm:">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>

      {children && <div className="mt-5">{children}</div>}
    </header>
  )
}

/**
 * A row of choices where exactly one is on.
 *
 * Outline by default, filled when chosen — the filled one is the only strong
 * mark in the row, so which is active survives being glanced at from across a
 * desk. Radio semantics rather than buttons, because that is what it is.
 */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  /** Names the group for anyone not looking at it. */
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors duration-150 ${
              on
                ? 'border-navy-600 bg-navy-600 font-medium text-white dark:border-amber-400 dark:bg-amber-400 dark:text-navy-900'
                : 'border-line-strong text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
            }`}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span
                className={`font-mono text-[12px] ${on ? 'opacity-80' : 'text-faint'}`}
              >
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The one tinted band on a page, carrying the fact the person came for.
 *
 * It is deliberately not a greeting. A strip that says "Welcome back" occupies
 * the most valuable line on the screen to tell somebody something they already
 * know; this says what is on them right now, and the number in it is the point.
 * If a page has nothing true to put here, it has no band.
 */
export function StateBand({
  icon,
  children,
  action,
  tone = 'quiet',
}: {
  icon?: IconName
  children: ReactNode
  action?: ReactNode
  /** `attention` for something overdue or waiting on this person. */
  tone?: 'quiet' | 'attention'
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3.5 sm:px-5 ${
        tone === 'attention'
          ? 'bg-amber-400/12 text-ink'
          : 'surface-sunken text-ink'
      }`}
    >
      {icon && (
        <Icon
          name={icon}
          size={18}
          className={`shrink-0 ${
            tone === 'attention' ? 'text-amber-600 dark:text-amber-300' : 'text-muted'
          }`}
        />
      )}
      <p className="min-w-0 flex-1 text-[14px] leading-relaxed">{children}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/**
 * A number and what it counts.
 *
 * The figure is set in the mono face at a size nothing else on the page uses,
 * because a count is the one thing on these screens that is read rather than
 * skimmed. The label stays small and quiet underneath it.
 */
export function Stat({
  value,
  label,
  tone = 'plain',
}: {
  value: string | number
  label: string
  tone?: 'plain' | 'attention'
}) {
  return (
    <div>
      <p
        className={`font-mono text-[26px] leading-none font-bold tabular-nums ${
          tone === 'attention' ? 'text-amber-600 dark:text-amber-300' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[12px] text-muted">{label}</p>
    </div>
  )
}
