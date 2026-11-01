// src/components/general/TaskMarks.tsx
import type { GeneralTask } from '../../lib/general/types'
import { Icon } from '../ui/Icon'

/** "2/3": how many subtasks are done. */
export function SubtaskCount({ progress }: { progress: { done: number; total: number } | null }) {
  if (!progress) return null
  return (
    <span className="flex items-center gap-1 font-mono" title={`${progress.done} of ${progress.total} subtasks done`}>
      <Icon name="check" size={11} />
      {progress.done}/{progress.total}
    </span>
  )
}

/**
 * A small marker on a task that waits for open work. It is a button, so a
 * keyboard or touch user reaches it; its name lists the blockers, and pressing
 * it opens the task, where they are listed. `relative z-10` lifts it over a
 * card's full-card button, which would otherwise take the pointer.
 */
export function WaitingMarker({ blockers, onOpen }: { blockers: GeneralTask[]; onOpen?: () => void }) {
  if (blockers.length === 0) return null
  const names = blockers.map((b) => b.title).join(', ')
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Waiting for ${names}`}
      aria-label={`Waiting for: ${names}`}
      className="pointer-events-auto relative z-10 inline-flex shrink-0 items-center rounded-md bg-warning-400/18 px-1.5 py-0.5 text-[11px] font-medium text-warning-700 dark:text-warning-300"
    >
      Waiting
    </button>
  )
}
