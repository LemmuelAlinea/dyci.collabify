import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

export type QuickAction = {
  icon: IconName
  label: string
  hint: string
  /** A link, or an action on this page such as opening a dialog. */
  to?: string
  onClick?: () => void
  /** A live figure, shown as a pill when above zero. */
  count?: number
  /** The page's first action, set in the banner's own colour so the two read as one. */
  primary?: boolean
}

/**
 * The space's front door: large targets for everywhere a person goes from here.
 *
 * Always one row, as wide as the summary band above it, at every screen size:
 * each card takes an equal share. As a card narrows it sheds its hint, then its
 * label (kept for screen readers and as a tooltip), so a phone still gets a row
 * of icons rather than a wrapped grid. The navy outline ties the row to the band.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <nav
      aria-label="Space shortcuts"
      className="grid gap-1.5 sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
    >
      {actions.map((a) => {
        const shell =
          'group @container relative flex min-h-[64px] min-w-0 flex-col rounded-card border-[1.5px] p-2 text-left transition-[border-color,transform] duration-200 hover-safe sm:min-h-[112px] sm:p-4 ' +
          (a.primary
            ? 'border-banner-ink/10 bg-banner text-banner-ink hover:brightness-125'
            : 'border-navy-950 bg-[var(--surface)] hover:border-navy-600 dark:border-navy-500 dark:hover:border-navy-300')
        const body = (
          <span className="flex h-full flex-col justify-center @min-[76px]:justify-start">
            <span className="flex items-start justify-center gap-2 @min-[120px]:justify-between">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg @min-[120px]:h-9 @min-[120px]:w-9 ${
                  a.primary ? 'bg-banner-ink/15 text-banner-accent' : 'surface-sunken text-navy-600 dark:text-navy-200'
                }`}
              >
                <Icon name={a.icon} size={17} />
              </span>
              {typeof a.count === 'number' && a.count > 0 && (
                <span className="absolute top-1 right-1 rounded-full bg-amber-400/25 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-800 tabular-nums @min-[120px]:static @min-[120px]:px-2 @min-[120px]:text-[12px] dark:text-amber-200">
                  {a.count}
                </span>
              )}
            </span>
            <span
              className={`sr-only @min-[76px]:not-sr-only @min-[76px]:mt-auto @min-[76px]:truncate @min-[76px]:pt-2 @min-[76px]:text-center @min-[76px]:text-[12px] @min-[120px]:pt-3 @min-[120px]:text-left @min-[120px]:text-[14px] font-medium ${
                a.primary ? 'text-banner-ink' : 'text-ink'
              }`}
            >
              {a.label}
            </span>
            <span
              className={`hidden text-[12px] leading-snug @min-[150px]:mt-0.5 @min-[150px]:line-clamp-2 ${
                a.primary ? 'text-banner-ink/70' : 'text-muted'
              }`}
            >
              {a.hint}
            </span>
          </span>
        )
        return a.to ? (
          <Link key={a.label} to={a.to} title={a.label} className={shell}>
            {body}
          </Link>
        ) : (
          <button key={a.label} type="button" onClick={a.onClick} title={a.label} className={shell}>
            {body}
          </button>
        )
      })}
    </nav>
  )
}
