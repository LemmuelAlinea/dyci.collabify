import type { TaskKind } from '../../lib/general/types'

/** The mark on a task QA raised. A plain task wears nothing. */
export function BugBadge({ kind, onBanner = false }: { kind: TaskKind | undefined; onBanner?: boolean }) {
  if (kind !== 'bug') return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
        // The dialog header sits on the banner ground, which neither soft chip reads on.
        onBanner ? 'bg-danger-500 text-white' : 'bg-danger-500/15 text-danger-700 dark:text-danger-300'
      }`}
    >
      Bug
    </span>
  )
}
