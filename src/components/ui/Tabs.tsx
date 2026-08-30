import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type Tab<T extends string> = {
  id: T
  label: string
  icon?: IconName
  count?: number
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    // The strip scrolls on narrow screens, but the page-wide scrollbar styling
    // renders a 10px track across it that reads as broken. Hide it here.
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[14px] transition-colors duration-200 sm:gap-2 sm:px-4 sm:text-[14.5px] ${
              on
                ? 'border-navy-600 font-semibold text-ink dark:border-amber-400'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.icon && <Icon name={t.icon} size={17} />}
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] ${
                  on ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900' : 'surface-sunken text-faint'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Illustrations live in `public/`, not in the bundle.
 *
 * They are rich multi-colour artwork — 40 to 90KB each after optimising — and
 * inlining them would put every one of them into the JavaScript every visitor
 * downloads, whether they ever reach that page or not. As files they load only
 * on the page that asks, cache on their own, and cost the bundle nothing.
 *
 * Each one has a transparent background and was checked against all three
 * grounds it can land on: white, the dark theme, and the navy hero.
 */
export type EmptyArt =
  | 'announcements'
  | 'classes'
  | 'groups'
  | 'projects'
  | 'reassignments'
  | 'tasks'

export function EmptyState({
  icon,
  art,
  title,
  body,
  action,
}: {
  icon: IconName
  /** An illustration in place of the icon tile, where one exists for this page. */
  art?: EmptyArt
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-14 text-center">
      {art ? (
        // Decorative: the title underneath says the same thing, so announcing
        // it twice would only slow a screen reader down. Sized in the markup as
        // well as in CSS so the row does not reflow when it loads.
        <img
          src={`/illustrations/${art}.svg`}
          alt=""
          width={176}
          height={176}
          loading="lazy"
          className="h-32 w-32 sm:h-44 sm:w-44"
        />
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-2xl surface-sunken text-faint">
          <Icon name={icon} size={24} />
        </span>
      )}
      <h3 className={`text-[18px] ${art ? 'mt-3' : 'mt-5'}`}>{title}</h3>
      <p className="mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
