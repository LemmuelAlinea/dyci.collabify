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
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[14.5px] transition-colors duration-200 ${
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

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl surface-sunken text-faint">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="mt-5 text-[18px]">{title}</h3>
      <p className="mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
