import type { CalendarEvent } from '../types'
import type { WorkStatus } from './timeline'

export type CalendarTask = {
  id: string
  title: string
  status: WorkStatus
  due_at: string | null
  /** Class tasks only: stamped when finished after the deadline. */
  late?: boolean
}

/**
 * A project's tasks on the month grid, from either space.
 *
 * Finished tasks stay on (the grid strikes them through), so a month that went
 * well still shows what was done in it. `class_id` is blank because the grid
 * reads a blank one as "no class initial to print".
 */
export function taskCalendarEvents<T extends CalendarTask>(
  tasks: readonly T[],
  label: (task: T) => string = () => '',
): CalendarEvent[] {
  return tasks
    .filter((t) => t.due_at)
    .map(
      (t): CalendarEvent => ({
        kind: 'task_due',
        ref_id: t.id,
        title: t.title,
        at: t.due_at as string,
        class_id: '',
        class_initial: '',
        class_name: '',
        project_id: '',
        project_title: label(t),
        task_id: t.id,
        group_name: null,
        done: t.status === 'done',
        late: t.status === 'done' && Boolean(t.late),
      }),
    )
}
