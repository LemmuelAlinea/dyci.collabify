// src/components/general/PriorityBadge.tsx
import { PRIORITIES } from '../../lib/general/types'
import type { TaskPriority } from '../../lib/general/types'

const TONE: Record<Exclude<TaskPriority, 'normal'>, string> = {
  urgent: 'bg-danger-500/15 text-danger-700 dark:text-danger-300',
  high: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  low: 'bg-pending-soft text-pending-ink',
}

/** The mark for a task's priority. Normal wears nothing, so a card keeps the look it had. */
export function PriorityBadge({ priority }: { priority: TaskPriority | undefined }) {
  if (!priority || priority === 'normal') return null
  const label = PRIORITIES.find((p) => p.value === priority)?.label
  if (!label) return null
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${TONE[priority]}`}>
      {label}
    </span>
  )
}
