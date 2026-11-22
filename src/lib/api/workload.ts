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

/** What `general_breakdown_context` answers about a parent task. Planners only. */
export type BreakdownContext = {
  parent: {
    id: string
    project_id: string
    title: string
    description: string
    task_flow: 'planned' | 'open'
    team_id: string | null
    routing_state: string
    starts_at: string | null
    due_at: string | null
    has_subtasks: boolean
    allow_subtasks: boolean
    allow_dependencies: boolean
    holder_ids: string[]
  }
  /** Why the parent cannot be broken down, or null. */
  blocked: string | null
  positions: { id: string; name: string }[]
  tags: string[]
  candidates: { user_id: string; name: string; tags: string[]; position_ids: string[] }[]
}

/** The parent task, the project's labels and who may take its subtasks. `from` and `to` are YYYY-MM-DD. */
export async function breakdownContext(parentId: string, from: string, to: string): Promise<BreakdownContext> {
  const { data, error } = await supabase.rpc('general_breakdown_context', { p_parent: parentId, p_from: from, p_to: to })
  if (error) throw error
  return data as BreakdownContext
}

/**
 * One person's load in a window, per project they may see by name (null: the
 * rest of the space, as one total). Tasks without an estimate are counted in
 * `unestimated`, never as minutes.
 */
export type PeopleLoad = { user_id: string; project_id: string | null; load_minutes: number; unestimated: number }

export async function spacePeopleLoad(
  spaceId: string,
  from: string,
  to: string,
  users?: string[],
): Promise<PeopleLoad[]> {
  const { data, error } = await supabase.rpc('general_space_people_load', {
    p_space: spaceId,
    p_from: from,
    p_to: to,
    p_users: users ?? null,
  })
  if (error) throw error
  return (data ?? []) as PeopleLoad[]
}

/** One reviewed subtask as `apply_work_breakdown` takes it. */
export type ApplyRow = {
  key: string
  title: string
  description: string
  minutes: number
  owner: string | null
  depends_on: string[]
  starts_on: string | null
  due_on: string | null
  /** The owner's load the review showed; the save is refused when it has risen since. */
  shown_load_minutes: number | null
}

/** Saves an approved breakdown in one transaction; the new subtask ids in row order. */
export async function applyBreakdown(parentId: string, from: string, to: string, rows: ApplyRow[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('apply_work_breakdown', {
    p_parent: parentId,
    p_from: from,
    p_to: to,
    p_rows: rows,
  })
  if (error) throw error
  return (data ?? []) as string[]
}
