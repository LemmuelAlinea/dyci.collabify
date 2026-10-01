import { audienceText } from '../../../lib/meetings'
import type { Meeting } from '../../../lib/meetings'
import type { CalendarEvent } from '../../../lib/types'

/**
 * Meetings, shaped as calendar events like `workDates.ts` does for work tasks.
 *
 * A class or group meeting keeps its class, so it sits under Classes and its
 * class filter; a work meeting has no class (`class_id` empty), which is what
 * puts it under Work. Cancelled meetings are left off — a calendar is for what
 * is still happening.
 */
export function meetingCalendarEvents(meetings: readonly Meeting[]): CalendarEvent[] {
  return meetings
    .filter((m) => !m.cancelled_at)
    .map(
      (m): CalendarEvent => ({
        kind: 'meeting',
        ref_id: m.id,
        title: m.title,
        at: m.starts_at,
        class_id: m.class_id ?? '',
        class_initial: m.class_initial ?? '',
        class_name: m.class_name ?? '',
        project_id: m.project_id ?? '',
        // The chip already shows the class initial, so a class meeting says
        // who in the class rather than naming the class twice.
        project_title:
          m.scope === 'class'
            ? 'Whole class'
            : m.scope === 'group'
              ? (m.audience_label?.split(' · ')[0] ?? 'Group')
              : audienceText(m),
        task_id: null,
        group_name: null,
        done: false,
        late: false,
      }),
    )
}
