import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { ActionList } from './ActionList'
import type { Action } from '../../lib/insight'

/**
 * The first thing on the page, because "what do I do" is a professor's first
 * question. Collapsed, it is a count; open, it is the ranked list, and each
 * card points back to the chart that argues for it.
 */
export function NeedsAttention({
  actions,
  onSeeWhy,
}: {
  actions: Action[]
  onSeeWhy: (a: Action) => void
}) {
  const [open, setOpen] = useState(false)
  const urgent = actions.filter((a) => a.severity === 1).length

  return (
    <section className="surface rounded-panel border border-line px-4 py-3 shadow-card sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2.5">
          <Icon
            name={actions.length ? 'alert' : 'checkCircle'}
            size={16}
            className={actions.length ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}
          />
          <span className="font-display text-[16px] font-semibold text-ink">Needs attention</span>
          <span className="font-mono text-[13px] text-muted">{actions.length}</span>
          {urgent > 0 && (
            <span className="rounded-md bg-danger-500/15 px-1.5 py-0.5 font-mono text-[11px] text-danger-700 dark:text-danger-300">
              {urgent} urgent
            </span>
          )}
        </span>
        <Icon
          name="chevronDown"
          size={16}
          className={`shrink-0 text-faint transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-4">
          <ActionList actions={actions} onSeeWhy={onSeeWhy} />
        </div>
      )}
    </section>
  )
}
