import type { CalendarEvent } from '../types'
import type { Milestone, Sprint } from './types'
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

/** Local noon on a calendar day, so no time zone tips it onto the day before. */
function noonOf(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

/** Where each sprint starts and ends. They open nothing: `task_id` is null. */
export function sprintCalendarEvents(
  sprints: readonly Pick<Sprint, 'id' | 'name' | 'starts_on' | 'ends_on' | 'state'>[],
): CalendarEvent[] {
  const edge = (kind: 'sprint_start' | 'sprint_end', s: (typeof sprints)[number], title: string, at: string, done: boolean): CalendarEvent => ({
    kind, ref_id: s.id, title, at, class_id: '', class_initial: '', class_name: '',
    project_id: '', project_title: '', task_id: null, group_name: null, done, late: false,
  })
  return sprints.flatMap((s) => [
    edge('sprint_start', s, `${s.name} starts`, noonOf(s.starts_on), s.state !== 'planned'),
    edge('sprint_end', s, `${s.name} ends`, noonOf(s.ends_on), s.state === 'completed'),
  ])
}

/**
 * Each milestone on its day. Opens no task: `task_id` is null. `isReached`
 * decides which read as done; pass the one the milestones view uses so the
 * calendar and the view agree. By default only a hand-marked one is done.
 */
export function milestoneCalendarEvents(
  milestones: readonly Pick<Milestone, 'id' | 'name' | 'due_on' | 'reached_at'>[],
  isReached: (m: Pick<Milestone, 'id' | 'name' | 'due_on' | 'reached_at'>) => boolean = (m) => Boolean(m.reached_at),
): CalendarEvent[] {
  return milestones.map((m) => ({
    kind: 'milestone', ref_id: m.id, title: m.name, at: noonOf(m.due_on),
    class_id: '', class_initial: '', class_name: '', project_id: '', project_title: 'Milestone',
    task_id: null, group_name: null, done: isReached(m), late: false,
  }))
}
