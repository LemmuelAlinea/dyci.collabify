// src/components/work/RunningSprintTabs.tsx
import type { RunningTab } from '../../lib/work/sprints'

/** One running sprint at a time, when several run. Renders nothing otherwise. */
export function RunningSprintTabs({
  tabs,
  activeKey,
  onPick,
}: {
  tabs: readonly RunningTab[]
  activeKey: string | null
  onPick: (key: string) => void
}) {
  if (tabs.length === 0) return null
  return (
    <div role="tablist" aria-label="Running sprints" className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const selected = t.key === activeKey
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={!t.sprint}
            title={t.sprint ? undefined : 'No sprint running'}
            onClick={() => onPick(t.key)}
            className={`max-w-full truncate rounded-full border px-3.5 py-1.5 text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? 'border-navy-600 bg-navy-600 font-medium text-white dark:border-amber-400 dark:bg-amber-400 dark:text-navy-900'
                : 'border-line-strong text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
