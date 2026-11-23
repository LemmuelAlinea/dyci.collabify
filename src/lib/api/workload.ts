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

/**
 * A day off the signed-in person has. A null `minutes` is the whole day.
 * `added_by` is a space planner who recorded it for them (null when they did).
 */
export type TimeOff = {
  id: string
  off_on: string
  minutes: number | null
  added_by?: string | null
  added_by_name?: string | null
}

/** The signed-in person's time off from a date (YYYY-MM-DD) onward, soonest first. */
export async function listMyTimeOff(from: string): Promise<TimeOff[]> {
  const { data, error } = await supabase
    .from('user_time_off')
    .select('id, off_on, minutes, added_by, adder:profiles!user_time_off_added_by_fkey(first_name, last_name)')
    .gte('off_on', from)
    .order('off_on')
  if (error) throw error
  type Row = Omit<TimeOff, 'added_by_name'> & { adder: { first_name: string; last_name: string } | null }
  return ((data ?? []) as unknown as Row[]).map(({ adder, ...row }) => ({
    ...row,
    added_by_name: adder ? `${adder.first_name} ${adder.last_name}`.trim() : null,
  }))
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
 * `unestimated`, never as minutes. `skipTaskId` leaves one task out (Break down
 * and balance passes the parent, which stops counting once it has subtasks).
 */
export type PeopleLoad = { user_id: string; project_id: string | null; load_minutes: number; unestimated: number }

export async function spacePeopleLoad(
  spaceId: string,
  from: string,
  to: string,
  users?: string[],
  skipTaskId?: string,
): Promise<PeopleLoad[]> {
  const { data, error } = await supabase.rpc('general_space_people_load', {
    p_space: spaceId,
    p_from: from,
    p_to: to,
    p_users: users ?? null,
    p_skip_task: skipTaskId ?? null,
  })
  if (error) throw error
  return (data ?? []) as PeopleLoad[]
}

/** Room for a task: 'full' when it would put the person past their hours in its weeks. Never hours. */
export type HolderRoom = { user_id: string; room: 'ok' | 'full' | 'unknown' }

/** Whether each person has room for this task (`general_task_holder_room`). */
export async function holderRoom(taskId: string, userIds: string[]): Promise<HolderRoom[]> {
  const { data, error } = await supabase.rpc('general_task_holder_room', { p_task: taskId, p_users: userIds })
  if (error) throw error
  return (data ?? []) as HolderRoom[]
}

/** A task counted in one person's load for a window, from a project the viewer may see by name. */
export type PersonTask = { task_id: string; project_id: string; title: string; minutes: number; unestimated: boolean }

/** The tasks behind one person's load (`general_space_person_tasks`). */
export async function spacePersonTasks(spaceId: string, userId: string, from: string, to: string): Promise<PersonTask[]> {
  const { data, error } = await supabase.rpc('general_space_person_tasks', { p_space: spaceId, p_user: userId, p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as PersonTask[]
}

export type WorkloadSummary = { unestimated_tasks: number; people_without_hours: number }

/** Unestimated tasks (each once) and people without weekly hours, over the people the viewer sees. */
export async function spaceWorkloadSummary(spaceId: string, from: string, to: string): Promise<WorkloadSummary> {
  const { data, error } = await supabase.rpc('general_space_workload_summary', { p_space: spaceId, p_from: from, p_to: to })
  if (error) throw error
  const row = ((data ?? []) as WorkloadSummary[])[0]
  return row ?? { unestimated_tasks: 0, people_without_hours: 0 }
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

/** The signed-in person's running timer, with its task's title, or null. */
export type RunningTimer = { task_id: string; project_id: string; started_at: string; title: string }

export async function myTimer(): Promise<RunningTimer | null> {
  const { data, error } = await supabase
    .from('general_task_timers')
    .select('task_id, project_id, started_at')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { data: task } = await supabase.from('general_tasks').select('title').eq('id', data.task_id).maybeSingle()
  return { ...(data as Omit<RunningTimer, 'title'>), title: (task?.title as string | undefined) ?? 'another task' }
}

/** Starts the signed-in person's timer on a task they hold; a timer elsewhere is logged first. */
export async function startTimer(taskId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_work_task_timer', { p_task: taskId })
  if (error) throw error
  return data as string
}

/**
 * Stops the timer on a task and logs it, returning the minutes logged. 0 means the
 * person no longer holds the task: the timer was cleared and nothing was logged.
 * Refused when the timer has moved to another task.
 */
export async function stopTimer(taskId: string, minutes?: number): Promise<number> {
  const { data, error } = await supabase.rpc('stop_work_task_timer', minutes == null ? { p_task: taskId } : { p_task: taskId, p_minutes: minutes })
  if (error) throw error
  return data as number
}

/** Throws the timer on a task away without logging. Refused when the timer has moved to another task. */
export async function cancelTimer(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_work_task_timer', { p_task: taskId })
  if (error) throw error
}

/** Stop refused a timer that ran past 8 hours until the time worked is confirmed. */
export function isLongTimerError(err: unknown): boolean {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : ''
  return message.startsWith('This timer ran past 8 hours')
}

/** How a person's estimates usually turn out: logged time over their share of the estimates, from 5 Done tasks. */
export type EstimateAccuracy = { user_id: string; ratio: number; tasks: number }

/** Accuracy for the people the viewer may see in a work space's workload (only those with 5 or more tasks). */
export async function estimateAccuracy(spaceId: string, users?: string[]): Promise<EstimateAccuracy[]> {
  const { data, error } = await supabase.rpc('general_space_estimate_accuracy', {
    p_space: spaceId,
    p_users: users ?? null,
  })
  if (error) throw error
  return ((data ?? []) as { user_id: string; ratio: number | string; tasks: number }[]).map((r) => ({
    ...r,
    ratio: Number(r.ratio),
  }))
}

/**
 * Marks someone away on every weekday from `from` to `to` (YYYY-MM-DD): whole days
 * when `minutes` is null. The person themselves, or a project manager or
 * coordinator of a work space they are in. Returns the days written.
 */
export async function saveTimeOffRange(userId: string, from: string, to: string, minutes: number | null): Promise<number> {
  const { data, error } = await supabase.rpc('save_time_off_range', { p_user: userId, p_from: from, p_to: to, p_minutes: minutes })
  if (error) throw error
  return data as number
}

/** Removes away days in a range; a planner removes only days a planner recorded. */
export async function removeTimeOffRange(userId: string, from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc('remove_time_off_range', { p_user: userId, p_from: from, p_to: to })
  if (error) throw error
  return data as number
}

/** A leave: a run of away weekdays. `added_by` is a planner who recorded days of it, if any. */
export type AwayRange = { user_id: string; first_day: string; last_day: string; part_day: boolean; added_by: string | null }

/** Who in a work space is away today or later, dates only. */
export async function spaceAwayRanges(spaceId: string): Promise<AwayRange[]> {
  const { data, error } = await supabase.rpc('space_away_ranges', { p_space: spaceId })
  if (error) throw error
  return (data ?? []) as AwayRange[]
}
