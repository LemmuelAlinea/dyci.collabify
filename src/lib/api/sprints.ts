/**
 * Sprints for either space. A work project owns its sprints; a class board
 * owns its group's. The database holds the rules (who may plan, the order a
 * sprint moves through, one running at a time): see supabase/work-planning.sql
 * and supabase/class-planning.sql. These calls only say what to do.
 */
import { supabase } from '../supabase'
import { DEFAULT_SPRINT_SETTINGS, type SprintCarry, type SprintSettings } from '../work/sprintSettings'
import type { Sprint, SprintInput } from '../work/types'

export type SprintHome = { kind: 'work'; projectId: string } | { kind: 'class'; boardId: string }

const SPRINTS = { work: 'general_sprints', class: 'board_sprints' } as const
const TASKS = { work: 'general_tasks', class: 'project_tasks' } as const
const FINISH = { work: 'complete_general_sprint', class: 'complete_board_sprint' } as const
const COLUMNS = 'id, name, goal, starts_on, ends_on, state, archived, started_at, completed_at, created_at, milestone_id'

function owner(home: SprintHome) {
  return home.kind === 'work'
    ? { column: 'project_id', id: home.projectId }
    : { column: 'board_id', id: home.boardId }
}

function fields(input: SprintInput) {
  return { name: input.name.trim(), goal: input.goal.trim(), starts_on: input.startsOn, ends_on: input.endsOn }
}

/** An update or delete that matched no row was refused by RLS or the row is gone. */
function touched(data: unknown[] | null, message: string) {
  if (!data || data.length === 0) throw new Error(message)
}

export async function listSprints(home: SprintHome) {
  const { column, id } = owner(home)
  const { data, error } = await supabase.from(SPRINTS[home.kind]).select(COLUMNS).eq(column, id).order('starts_on')
  if (error) throw error
  return (data ?? []) as Sprint[]
}

/** `milestoneId` makes it count toward that milestone from the start. */
export async function createSprint(home: SprintHome, input: SprintInput, milestoneId: string | null = null) {
  const { column, id } = owner(home)
  const { data, error } = await supabase
    .from(SPRINTS[home.kind])
    .insert({ [column]: id, ...fields(input), milestone_id: milestoneId })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateSprint(home: SprintHome, sprintId: string, input: SprintInput) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).update(fields(input)).eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'That sprint could not change. It may be finished, or you may not plan here.')
}

/**
 * Count a sprint toward a milestone, or (null) stop. The database tags the
 * sprint's tasks, and any that join it later: supabase/sprint-milestones.sql.
 */
export async function setSprintMilestone(home: SprintHome, sprintId: string, milestoneId: string | null) {
  const { data, error } = await supabase
    .from(SPRINTS[home.kind])
    .update({ milestone_id: milestoneId })
    .eq('id', sprintId)
    .select('id')
  if (error) throw error
  touched(data, 'That sprint could not change. Reload the page and try again.')
}

export async function deleteSprint(home: SprintHome, sprintId: string) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).delete().eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'Only a sprint that has not started can be deleted.')
}

export async function startSprint(home: SprintHome, sprintId: string) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).update({ state: 'active' }).eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'That sprint could not start. Reload the page and try again.')
}

export async function finishSprint(home: SprintHome, sprintId: string, carryTo: string | null) {
  const { error } = await supabase.rpc(FINISH[home.kind], { p_sprint: sprintId, p_carry_to: carryTo })
  if (error) throw error
}

/**
 * Run a finished work-project sprint again; the running one goes back to
 * planned. Project manager and coordinators only: supabase/sprint-reopen.sql.
 */
export async function reopenSprint(sprintId: string) {
  const { error } = await supabase.rpc('reopen_general_sprint', { p_sprint: sprintId })
  if (error) throw error
}

export async function archiveSprint(home: SprintHome, sprintId: string, archived: boolean) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).update({ archived }).eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'That finished sprint could not change. Reload the page and try again.')
}

export async function moveTasksToSprint(home: SprintHome, taskIds: string[], sprintId: string | null) {
  if (taskIds.length === 0) return
  const { data, error } = await supabase.from(TASKS[home.kind]).update({ sprint_id: sprintId }).in('id', taskIds).select('id')
  if (error) throw error
  touched(data, 'Those tasks could not move. Reload the page and try again.')
}

export async function setTaskRank(home: SprintHome, taskId: string, rank: number) {
  const { data, error } = await supabase.from(TASKS[home.kind]).update({ rank }).eq('id', taskId).select('id')
  if (error) throw error
  touched(data, 'That task could not move. Reload the page and try again.')
}

type SettingsRow = {
  auto_finish: boolean
  auto_start: boolean
  carry: SprintCarry
  length_days: number
  start_weekday: number | null
  run_at: string
}

/**
 * True when the error says the settings table is not there yet.
 * Remove this once sprint-settings.sql is live.
 */
export function isMissingSprintSettingsTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (code === 'PGRST205' || code === '42P01') return true
  if (typeof message !== 'string' || !/general_sprint_settings/.test(message)) return false
  return /does not exist|schema cache/i.test(message)
}

/** The project's saved sprint settings, or the defaults when it has none. */
export async function getSprintSettings(projectId: string): Promise<SprintSettings> {
  const { data, error } = await supabase
    .from('general_sprint_settings')
    .select('auto_finish, auto_start, carry, length_days, start_weekday, run_at')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!data) return DEFAULT_SPRINT_SETTINGS
  const row = data as SettingsRow
  return {
    autoFinish: row.auto_finish,
    autoStart: row.auto_start,
    carry: row.carry,
    lengthDays: row.length_days,
    startWeekday: row.start_weekday,
    // Postgres returns 09:00:00.
    runAt: row.run_at.slice(0, 5),
  }
}

/** Project manager and coordinators only; the database owns the rest of the row. */
export async function saveSprintSettings(projectId: string, s: SprintSettings) {
  const { data, error } = await supabase
    .from('general_sprint_settings')
    .upsert(
      {
        project_id: projectId,
        auto_finish: s.autoFinish,
        auto_start: s.autoStart,
        carry: s.carry,
        length_days: s.lengthDays,
        start_weekday: s.startWeekday,
        run_at: s.runAt,
      },
      { onConflict: 'project_id' },
    )
    .select('project_id')
  if (error) throw error
  touched(
    data,
    'Those sprint settings did not save. You may not be allowed to change them, or the project is archived. Reload to see where things stand.',
  )
}
