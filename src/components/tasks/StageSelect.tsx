import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { TASK_STATUSES, taskStatusLabel } from '../../lib/types'
import type { TaskStatus } from '../../lib/types'

const TONE: Record<TaskStatus, string> = {
  todo: 'bg-pending-soft text-pending-ink',
  in_progress: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  done: 'bg-success-500/15 text-success-700 dark:text-success-300',
}

/** A task's stage, for someone who cannot move it. */
export function StageBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-block rounded-lg px-2 py-0.5 font-mono text-[12px] whitespace-nowrap ${TONE[status]}`}
    >
      {taskStatusLabel(status)}
    </span>
  )
}

/**
 * A task's stage as a dropdown, for whoever may move it. The chevron sits
 * before the name so a column of these lines up on its left edge.
 */
export function StageSelect({
  status,
  title,
  onChange,
}: {
  status: TaskStatus
  /** The task's title, so a screen reader knows which task this moves. */
  title: string
  onChange: (to: TaskStatus) => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <span
      className={`relative inline-flex items-center rounded-lg ring-1 ring-transparent transition-shadow focus-within:ring-navy-400 hover:ring-[var(--line-strong)] ${TONE[status]}`}
    >
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute left-1.5" />
      <select
        value={status}
        disabled={busy}
        aria-label={`Stage of ${title}`}
        onChange={async (e) => {
          setBusy(true)
          try {
            await onChange(e.target.value as TaskStatus)
          } finally {
            setBusy(false)
          }
        }}
        className="cursor-pointer appearance-none rounded-lg bg-transparent py-0.5 pr-2 pl-6 font-mono text-[12px] text-inherit outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </span>
  )
}
