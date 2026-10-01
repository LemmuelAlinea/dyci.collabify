import type { IconName } from '../ui/Icon'
import type { CalendarKind } from '../../lib/types'

/**
 * One dated thing. The kind carries the colour, so a month can be read at a
 * glance without reading a word of it: navy is a whole project, amber is one
 * task, emerald is work already in, and grey is something that has not opened
 * to students yet.
 */
export const LOOK: Record<CalendarKind, { cls: string; icon: IconName; dot: string }> = {
  project_due: {
    cls: 'bg-navy-600 text-white dark:bg-navy-500',
    icon: 'kanban',
    dot: 'bg-navy-600 dark:bg-navy-400',
  },
  task_due: {
    cls: 'bg-amber-400/25 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200',
    icon: 'check',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  project_release: {
    cls: 'surface-sunken text-muted',
    icon: 'upload',
    dot: 'bg-[var(--line-strong)]',
  },
  submitted: {
    cls: 'bg-success-500/18 text-success-800 dark:text-success-200',
    icon: 'checkCircle',
    dot: 'bg-success-500',
  },
  // A tint of the project navy rather than a fifth hue: a meeting is about the
  // work, not a status of it.
  meeting: {
    cls: 'bg-navy-500/14 text-navy-700 ring-1 ring-navy-400/40 ring-inset dark:bg-navy-400/18 dark:text-navy-100',
    icon: 'video',
    dot: 'bg-navy-300 dark:bg-navy-300',
  },
}

/**
 * The same four colours, as a dot.
 *
 * A month cell on a phone is about 50px wide, which is not enough for a word,
 * let alone a title. The dot keeps the one thing the chip's colour was already
 * carrying — what kind of thing is due — and the day's list underneath carries
 * the rest.
 */
export function eventDot(kind: CalendarKind) {
  return LOOK[kind].dot
}
