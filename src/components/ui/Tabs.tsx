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
