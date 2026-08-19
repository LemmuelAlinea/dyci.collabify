import { supabase } from '../supabase'
import type { CalendarEvent, ClassWeek, Role } from '../types'

/**
 * Everything dated, in one query.
 *
 * The view is `security_invoker`, so a viewer's own policies decide what comes
 * back — a student never sees another group's tasks or an unreleased project,
 * without this file knowing anything about roles.
 *
 * The one role-shaped thing here is dropping task rows for a professor. A class
 * of sixteen carrying nine tasks each is a hundred and forty-four chips in one
 * month, none of which are the professor's to act on. It is filtered in the
 * query rather than thrown away in the browser.
 */
export async function listCalendar(role: Role) {
  let q = supabase.from('calendar_events').select('*').order('at')
  if (role === 'professor') q = q.neq('kind', 'task_due')
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CalendarEvent[]
}

/**
 * The syllabus laid out in dates, for every class the viewer is in. These are
 * the bands behind the grid rather than events on it — what the term said would
 * happen, against what was actually set.
 */
export async function listWeekBands(classIds: string[]) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('class_week_map')
    .select('*')
    .in('class_id', classIds)
    .order('week_no')
  if (error) throw error
  return (data ?? []) as ClassWeek[]
}
