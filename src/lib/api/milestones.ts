/**
 * Milestones for either space. A work project's are run by whoever manages
 * tasks; a class project's are set by the professor. The database holds the
 * rules: supabase/work-milestones.sql and supabase/class-milestones.sql.
 */
import { supabase } from '../supabase'
import type { Milestone, MilestoneDependency, MilestoneInput } from '../work/types'
import { isMissingColumn, isMissingRelation } from './missingRelation'

export type MilestoneHome = { kind: 'work' | 'class'; projectId: string }

const TABLE = { work: 'general_milestones', class: 'project_milestones' } as const
const TASKS = { work: 'general_tasks', class: 'project_tasks' } as const
const COLUMNS = {
  work: 'id, name, description, due_on, reached_at, reached_auto, created_at',
  class: 'id, name, description, due_on, created_at',
} as const
// Before project-milestone-rules.sql is live reached_auto is missing; remove this and the retry in listMilestones once it is.
const WORK_COLUMNS_BEFORE_RULES = 'id, name, description, due_on, reached_at, created_at'

/** An empty date is no due date: allowed only where the project's settings say so. */
function fields(input: MilestoneInput) {
  return { name: input.name.trim(), description: input.description.trim(), due_on: input.dueOn || null }
}

function touched(data: unknown[] | null, message: string) {
  if (!data || data.length === 0) throw new Error(message)
}

export async function listMilestones(home: MilestoneHome): Promise<Milestone[]> {
  const read = (columns: string) =>
    supabase.from(TABLE[home.kind]).select(columns).eq('project_id', home.projectId).order('due_on')
  let { data, error } = await read(COLUMNS[home.kind])
  if (error && home.kind === 'work' && isMissingColumn(error)) ({ data, error } = await read(WORK_COLUMNS_BEFORE_RULES))
  if (error) throw error
  // Class milestones have no reached_at column; they read as never marked.
  return ((data ?? []) as unknown as (Omit<Milestone, 'reached_at'> & { reached_at?: string | null })[]).map((m) => ({
    ...m,
    reached_at: m.reached_at ?? null,
  }))
}

/** Every link between a work project's milestones; the database returns those the viewer may read. */
export async function listMilestoneDependencies(projectId: string): Promise<MilestoneDependency[]> {
  const { data, error } = await supabase
    .from('general_milestone_dependencies')
    .select('milestone_id, depends_on_id')
    .eq('project_id', projectId)
  if (error) {
    // Until project-milestone-rules.sql is live there are no links; remove this once it is.
    if (isMissingRelation(error, 'general_milestone_dependencies')) return []
    throw error
  }
  return (data ?? []) as MilestoneDependency[]
}

/** `milestoneId` waits for `dependsOnId`. The database refuses loops, reached milestones and a switch that is off. */
export async function addMilestoneDependency(milestoneId: string, dependsOnId: string) {
  const { error } = await supabase.rpc('add_general_milestone_dependency', {
    p_milestone: milestoneId,
    p_depends_on: dependsOnId,
  })
  if (error) throw error
}

export async function removeMilestoneDependency(milestoneId: string, dependsOnId: string) {
  const { error } = await supabase.rpc('remove_general_milestone_dependency', {
    p_milestone: milestoneId,
    p_depends_on: dependsOnId,
  })
  if (error) throw error
}

export async function createMilestone(home: MilestoneHome, input: MilestoneInput) {
  const { data, error } = await supabase
    .from(TABLE[home.kind])
    .insert({ project_id: home.projectId, ...fields(input) })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateMilestone(home: MilestoneHome, id: string, input: MilestoneInput) {
  const { data, error } = await supabase.from(TABLE[home.kind]).update(fields(input)).eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That milestone could not change. It may be gone, or you may not manage milestones here.')
}

export async function deleteMilestone(home: MilestoneHome, id: string) {
  const { data, error } = await supabase.from(TABLE[home.kind]).delete().eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That milestone could not be deleted. Reload the page and try again.')
}

/**
 * Work projects only: mark a milestone reached by hand, or take it back. The
 * database stamps reached_at with its own clock whatever is sent here; any
 * non-null value means reached.
 */
export async function setMilestoneReached(id: string, reached: boolean) {
  const { data, error } = await supabase
    .from('general_milestones')
    .update({ reached_at: reached ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
  if (error) throw error
  touched(data, 'That milestone could not change. Reload the page and try again.')
}

export async function tagTasks(home: MilestoneHome, taskIds: string[], milestoneId: string | null) {
  if (taskIds.length === 0) return
  const { data, error } = await supabase
    .from(TASKS[home.kind])
    .update({ milestone_id: milestoneId })
    .in('id', taskIds)
    .select('id')
  if (error) throw error
  touched(data, 'Those tasks could not be tagged. Reload the page and try again.')
  const wanted = new Set(taskIds).size
  const tagged = data?.length ?? 0
  if (tagged < wanted) {
    throw new Error(`Only ${tagged} of ${wanted} tasks were tagged. Reload the page and try again.`)
  }
}

/** Class professors: tag every copy of a task they set. */
export async function setOriginMilestone(originId: string, milestoneId: string | null) {
  const { data, error } = await supabase.rpc('set_professor_task_milestone', {
    p_origin: originId,
    p_milestone: milestoneId,
  })
  if (error) throw error
  return data as number
}
