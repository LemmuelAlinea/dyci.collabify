/**
 * Sprints for either space. A work project owns its sprints; a class board
 * owns its group's. The database holds the rules (who may plan, the order a
 * sprint moves through, one running at a time): see supabase/work-planning.sql
 * and supabase/class-planning.sql. These calls only say what to do.
 */
import { supabase } from '../supabase'
import type { Sprint, SprintInput } from '../work/types'

export type SprintHome = { kind: 'work'; projectId: string } | { kind: 'class'; boardId: string }

const SPRINTS = { work: 'general_sprints', class: 'board_sprints' } as const
const TASKS = { work: 'general_tasks', class: 'project_tasks' } as const
const FINISH = { work: 'complete_general_sprint', class: 'complete_board_sprint' } as const
const COLUMNS = 'id, name, goal, starts_on, ends_on, state, started_at, completed_at, created_at'

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

export async function createSprint(home: SprintHome, input: SprintInput) {
  const { column, id } = owner(home)
  const { data, error } = await supabase
    .from(SPRINTS[home.kind])
    .insert({ [column]: id, ...fields(input) })
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
