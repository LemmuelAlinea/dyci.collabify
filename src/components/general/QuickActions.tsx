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
  /** The page's first action, set in the brand colour. */
  primary?: boolean
}

/**
 * The space's front door: large targets for everywhere a person goes from here.
 *
 * Six across on a desktop, three on a tablet, two on a phone, so the grid is
 * always full rows. Every card is the same shape, whether it navigates or opens
 * a dialog, because to the person using it they are the same kind of thing.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <nav aria-label="Space shortcuts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {actions.map((a) => {
        const shell =
          'group flex min-h-[112px] flex-col rounded-card border p-4 text-left transition-[border-color,transform] duration-200 hover-safe ' +
          (a.primary
            ? 'border-navy-600 bg-navy-600 text-white hover:border-navy-500 hover:bg-navy-500 dark:border-navy-500 dark:bg-navy-500 dark:hover:bg-navy-400'
            : 'border-line bg-[var(--surface)] hover:border-line-strong')
        const body = (
          <>
            <span className="flex items-start justify-between gap-2">
              <span
                className={`grid h-9 w-9 place-items-center rounded-lg ${
                  a.primary ? 'bg-white/15 text-amber-300' : 'surface-sunken text-navy-600 dark:text-navy-200'
                }`}
              >
                <Icon name={a.icon} size={18} />
              </span>
              {typeof a.count === 'number' && a.count > 0 && (
                <span className="rounded-full bg-amber-400/25 px-2 py-0.5 font-mono text-[12px] font-medium text-amber-800 tabular-nums dark:text-amber-200">
                  {a.count}
                </span>
              )}
            </span>
            <span className={`mt-auto pt-3 text-[14px] font-medium ${a.primary ? 'text-white' : 'text-ink'}`}>
              {a.label}
            </span>
            <span className={`mt-0.5 text-[12px] leading-snug ${a.primary ? 'text-white/70' : 'text-muted'}`}>
              {a.hint}
            </span>
          </>
        )
        return a.to ? (
          <Link key={a.label} to={a.to} className={shell}>
            {body}
          </Link>
        ) : (
          <button key={a.label} type="button" onClick={a.onClick} className={shell}>
            {body}
          </button>
        )
      })}
    </nav>
  )
}
