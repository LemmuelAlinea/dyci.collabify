import type { GeneralTask } from '../../../lib/general/types'
import type { CalendarEvent } from '../../../lib/types'

/**
 * General work, shaped as calendar events so the month grid and agenda list
 * can draw them without knowing General work exists.
 *
 * `class_id` empty is what marks a row as a work date rather than a class
 * one — a real class_id is never blank. Done tasks and tasks with no due date
 * are excluded, the same as a class deadline that has already been met or was
 * never set.
 */
export function workCalendarEvents(
  tasks: readonly Pick<GeneralTask, 'id' | 'title' | 'due_at' | 'status' | 'project_id'>[],
  projectName: (projectId: string) => string,
): CalendarEvent[] {
  return tasks
    .filter((t) => t.due_at && t.status !== 'done')
    .map(
      (t): CalendarEvent => ({
        kind: 'project_due',
        ref_id: t.id,
        title: t.title,
        at: t.due_at as string,
        class_id: '',
        class_initial: '',
        class_name: '',
        project_id: t.project_id,
        project_title: projectName(t.project_id),
        task_id: t.id,
        group_name: null,
        done: false,
        late: false,
      }),
    )
}
