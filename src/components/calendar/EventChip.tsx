import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import type { CalendarEvent, CalendarKind } from '../../lib/types'

/**
 * One dated thing. The kind carries the colour, so a month can be read at a
 * glance without reading a word of it: navy is a whole project, amber is one
 * task, emerald is work already in, and grey is something that has not opened
 * to students yet.
 */
const LOOK: Record<CalendarKind, { cls: string; icon: IconName }> = {
  project_due: {
    cls: 'bg-navy-600 text-white dark:bg-navy-500',
    icon: 'kanban',
  },
  task_due: {
    cls: 'bg-amber-400/25 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200',
    icon: 'check',
  },
  project_release: {
    cls: 'surface-sunken text-muted',
    icon: 'upload',
  },
  submitted: {
    cls: 'bg-emerald-500/18 text-emerald-800 dark:text-emerald-200',
    icon: 'checkCircle',
  },
}

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
  const overdue =
    event.kind !== 'submitted' &&
    event.kind !== 'project_release' &&
    !event.done &&
    new Date(event.at).getTime() < Date.now()

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      title={`${event.title} — ${event.class_initial} · ${event.project_title}`}
      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-opacity hover:opacity-85 ${look.cls} ${
        compact ? 'text-[11px]' : 'text-[12.5px]'
      } ${event.done && event.kind === 'task_due' ? 'line-through opacity-60' : ''}`}
    >
      <Icon name={look.icon} size={compact ? 10 : 12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      {event.late && (
        <span className="shrink-0 rounded bg-red-500/25 px-1 font-mono text-[9.5px] text-red-700 dark:text-red-200">
          late
        </span>
      )}
      {overdue && !event.late && (
        <span className="shrink-0 font-mono text-[9.5px] opacity-80">!</span>
      )}
    </button>
  )
}
