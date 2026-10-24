import type { TaskKind } from '../../lib/general/types'

/**
 * The mark on a task QA raised. A plain task wears nothing. On the banner
 * (the task dialog's header) the chip takes the banner's own ink so it reads on
 * whatever colour the person picked, and a danger dot carries the meaning.
 */
export function BugBadge({ kind, onBanner = false }: { kind: TaskKind | undefined; onBanner?: boolean }) {
  if (kind !== 'bug') return null
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
        onBanner ? 'bg-banner-ink/12 text-banner-ink' : 'bg-danger-500/15 text-danger-700 dark:text-danger-300'
      }`}
    >
      {onBanner && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger-400" />}
      Bug
    </span>
  )
}
