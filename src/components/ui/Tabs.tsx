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
  variant = 'line',
}: {
  tabs: Tab<T>[]
  active: T
  onChange: (id: T) => void
  variant?: 'line' | 'panel'
}) {
  const panel = variant === 'panel'

  return (
    // The strip scrolls on narrow screens, but the page-wide scrollbar styling
    // renders a 10px track across it that reads as broken. Hide it here.
    <div
      role="tablist"
      className={`flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        panel ? 'rounded-xl surface-sunken p-1.5' : 'border-b border-line'
      }`}
    >
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`flex shrink-0 items-center gap-2 text-[14px] transition-colors duration-200 sm:gap-2 sm:text-[14px] ${
              panel
                ? `rounded-lg px-3 py-2 sm:px-4 ${
                    on
                      ? 'surface font-semibold text-ink ring-1 ring-[var(--line)]'
                      : 'text-muted hover:bg-[var(--surface)] hover:text-ink'
                  }`
                : `-mb-px border-b-2 px-3 py-3 sm:px-4 ${
                    on
                      ? 'border-navy-600 font-semibold text-ink dark:border-amber-400'
                      : 'border-transparent text-muted hover:text-ink'
                  }`
            }`}
          >
            {t.icon && <Icon name={t.icon} size={17} />}
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[12px] ${
                  on
                    ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900'
                    : panel
                      ? 'bg-[var(--surface)] text-faint'
                      : 'surface-sunken text-faint'
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
