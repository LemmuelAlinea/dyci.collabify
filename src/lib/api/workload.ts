import { supabase } from '../supabase'

/** Sets or clears a work task's estimate, in minutes. Planners and holders only. */
export async function setTaskEstimate(taskId: string, minutes: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_work_task_estimate', { p_task: taskId, p_minutes: minutes })
  if (error) throw error
}

/** Sets or clears a person's weekly hours in a work space, in minutes. */
export async function setSpaceWeeklyMinutes(
  spaceId: string,
  userId: string,
  minutes: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_space_weekly_minutes', {
    p_space: spaceId,
    p_user: userId,
    p_minutes: minutes,
  })
  if (error) throw error
}

/** A day off the signed-in person set. A null `minutes` is the whole day. */
export type TimeOff = { id: string; off_on: string; minutes: number | null }

/** The signed-in person's time off from a date (YYYY-MM-DD) onward, soonest first. */
export async function listMyTimeOff(from: string): Promise<TimeOff[]> {
  const { data, error } = await supabase
    .from('user_time_off')
    .select('id, off_on, minutes')
    .gte('off_on', from)
    .order('off_on')
  if (error) throw error
  return (data ?? []) as TimeOff[]
}

/** Sets time off for a day, replacing any entry already on it. */
export async function saveTimeOff(offOn: string, minutes: number | null): Promise<void> {
  const { error } = await supabase
    .from('user_time_off')
    .upsert({ off_on: offOn, minutes }, { onConflict: 'user_id,off_on' })
  if (error) throw error
}

export async function deleteTimeOff(id: string): Promise<void> {
  const { error } = await supabase.from('user_time_off').delete().eq('id', id)
  if (error) throw error
}

export type PeopleHours = {
  user_id: string
  weekly_minutes: number | null
  available_minutes: number | null
  /** Null while the person's weekly hours are not set. */
  time_off_minutes: number | null
}

/** Weekly and available hours for the people the viewer may see in a work space. */
export async function spacePeopleHours(
  spaceId: string,
  from: string,
  to: string,
  users?: string[],
): Promise<PeopleHours[]> {
  const { data, error } = await supabase.rpc('general_space_people_hours', {
    p_space: spaceId,
    p_from: from,
    p_to: to,
    p_users: users ?? null,
  })
  if (error) throw error
  return (data ?? []) as PeopleHours[]
}
