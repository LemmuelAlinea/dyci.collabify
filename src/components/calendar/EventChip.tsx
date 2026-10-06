import { Icon } from '../ui/Icon'
import { useNow } from '../../hooks/useNow'
import type { CalendarEvent } from '../../lib/types'
import { LOOK } from './eventLook'

export function EventChip({
  event,
  onOpen,
  compact = false,
}: {
  event: CalendarEvent
  onOpen: (event: CalendarEvent) => void
  /** Inside a month cell, where there is room for a line and no more. */
  compact?: boolean
}) {
  const look = LOOK[event.kind]
  const now = useNow()
  const overdue =
    (event.kind === 'project_due' || event.kind === 'task_due') &&
    !event.done &&
    new Date(event.at).getTime() < now
  // A work date (see Calendar.tsx) carries no class, so the detail line is the
  // project name alone rather than a blank class initial before it.
  const detail = [event.class_initial, event.project_title].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      title={`${event.title} — ${detail}`}
      className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-opacity hover:opacity-85 ${look.cls} ${
        compact ? 'text-[12px]' : 'text-[12px]'
      } ${event.done && event.kind === 'task_due' ? 'line-through opacity-60' : ''}`}
    >
      <Icon name={look.icon} size={compact ? 10 : 12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      {event.late && (
        <span className="shrink-0 rounded bg-danger-500/25 px-1 font-mono text-[12px] text-danger-700 dark:text-danger-200">
          late
        </span>
      )}
      {overdue && !event.late && (
        <span className="shrink-0 font-mono text-[12px] opacity-80">!</span>
      )}
    </button>
  )
}
