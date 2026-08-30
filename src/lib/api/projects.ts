import { supabase } from '../supabase'
import type {
  ProjectAttachment,
  ProjectAudience,
  ProjectCriterion,
  ProjectSummary,
  ProjectType,
  SeriesMember,
} from '../types'

const BUCKET = 'project-files'

export type ProjectInput = {
  classId: string
  title: string
  type: ProjectType
  typeLabel: string | null
  guidelines: string
  startWeek: number
  endWeek: number
  audience: ProjectAudience
  groupSetId: string | null
  totalPoints: number
  dueAt: string | null
  releaseAt: string | null
}

function toRow(input: ProjectInput) {
  return {
    class_id: input.classId,
    title: input.title.trim(),
    type: input.type,
    type_label: input.type === 'other' ? (input.typeLabel ?? '').trim() : null,
    guidelines: input.guidelines.trim(),
    start_week: input.startWeek,
    end_week: input.endWeek,
    audience: input.audience,
    group_set_id: input.audience === 'group' ? input.groupSetId : null,
    total_points: input.totalPoints,
    due_at: input.dueAt,
    release_at: input.releaseAt,
  }
}

/* ---------------------------------------------------------------- projects */

export async function listProjectsForClasses(classIds: string[]) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('project_overview')
    .select('*')
    .in('class_id', classIds)
    .order('start_week')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProjectSummary[]
}

export async function getProject(id: string) {
  const { data, error } = await supabase
    .from('project_overview')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as ProjectSummary | null) ?? null
}

export async function createProject(input: ProjectInput, createdBy: string) {
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...toRow(input), created_by: createdBy })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateProject(id: string, input: ProjectInput) {
  const { error } = await supabase.from('projects').update(toRow(input)).eq('id', id)
  if (error) throw error
}

export async function setProjectArchived(id: string, archived: boolean) {
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Closes a project to further work, or reopens it. Deliberately separate from
 * the deadline: a passed due_at marks work late but still accepts it, and an
 * extension granted this way leaves the record of when it was due intact.
 */
export async function setProjectLocked(id: string, locked: boolean) {
  const { error } = await supabase
    .from('projects')
    .update({ locked_at: locked ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/** Publishes a scheduled project immediately, which also sends the notifications. */
export async function releaseNow(id: string) {
  const { error } = await supabase.from('projects').update({ release_at: null }).eq('id', id)
  if (error) throw error
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ series */

/**
 * One section a project is being created for. The group set is per target and
 * not per project, because a set belongs to a class — four sections cannot
 * share one arrangement even in principle.
 */
export type SectionTarget = { classId: string; groupSetId: string | null }

/** The half of a project that is the same in every section it runs in. */
type SharedInput = Omit<ProjectInput, 'classId' | 'audience' | 'groupSetId'>

function sharedArgs(input: SharedInput) {
  return {
    p_title: input.title.trim(),
    p_type: input.type,
    p_type_label: input.type === 'other' ? (input.typeLabel ?? '').trim() : null,
    p_guidelines: input.guidelines.trim(),
    p_start_week: input.startWeek,
    p_end_week: input.endWeek,
    p_total_points: input.totalPoints,
    p_due_at: input.dueAt,
    p_release_at: input.releaseAt,
  }
}

function criteriaArg(rows: CriterionInput[] | null) {
  if (!rows) return null
  return rows
    .filter((r) => r.label.trim())
    .map((r) => ({
      label: r.label.trim(),
      description: r.description.trim(),
      max_points: r.max_points,
    }))
}

/**
 * Creates the project once per section, in one transaction. Returns the new
 * ids in the order the sections were given, so an attachment can be copied to
 * each of them.
 *
 * A single target is written as an ordinary project with no series — there is
 * nothing to scope, and a scope picker over one section is noise.
 */
export async function createProjectSeries(
  targets: SectionTarget[],
  input: Omit<ProjectInput, 'classId'>,
  criteria: CriterionInput[],
) {
  const { data, error } = await supabase.rpc('create_project_series', {
    p_targets: targets.map((t) => ({
      class_id: t.classId,
      group_set_id: input.audience === 'group' ? t.groupSetId : null,
    })),
    p_audience: input.audience,
    ...sharedArgs(input),
    p_criteria: criteriaArg(criteria),
  })
  if (error) throw error
  return (data ?? []) as string[]
}

/**
 * Applies the shared half to the sections named, and only those. `audience`
 * and the group set are absent on purpose: they belong to one section and are
 * changed on its own project.
 *
 * Pass `criteria: null` to leave each section's rubric as it is.
 */
export async function updateProjectSeries(
  projectIds: string[],
  input: Omit<ProjectInput, 'classId' | 'audience' | 'groupSetId'>,
  criteria: CriterionInput[] | null,
) {
  const { error } = await supabase.rpc('update_project_series', {
    p_targets: projectIds,
    ...sharedArgs(input),
    p_criteria: criteriaArg(criteria),
  })
  if (error) throw error
}

/** The extension: moves the deadline of the sections named, and no others. */
export async function setSeriesDue(projectIds: string[], dueAt: string | null) {
  const { error } = await supabase.rpc('set_series_due', {
    p_targets: projectIds,
    p_due: dueAt,
  })
  if (error) throw error
}

export async function setSeriesLocked(projectIds: string[], locked: boolean) {
  const { error } = await supabase.rpc('set_series_locked', {
    p_targets: projectIds,
    p_locked: locked,
  })
  if (error) throw error
}

export async function setSeriesArchived(projectIds: string[], archived: boolean) {
  const { error } = await supabase.rpc('set_series_archived', {
    p_targets: projectIds,
    p_archived: archived,
  })
  if (error) throw error
}

export async function releaseSeriesNow(projectIds: string[]) {
  const { error } = await supabase.rpc('release_series_now', { p_targets: projectIds })
  if (error) throw error
}

/** The sections a series runs in. Empty for a project that is not in one. */
export async function listSeriesMembers(seriesId: string | null) {
  if (!seriesId) return []
  const { data, error } = await supabase
    .from('project_series_members')
    .select('*')
    .eq('series_id', seriesId)
    .order('section')
  if (error) throw error
  return (data ?? []) as SeriesMember[]
}

/* ---------------------------------------------------------------- criteria */

export type CriterionInput = { label: string; description: string; max_points: number }

export async function listCriteria(projectId: string) {
  const { data, error } = await supabase
    .from('project_criteria')
    .select('*')
    .eq('project_id', projectId)
    .order('position')
  if (error) throw error
  return (data ?? []) as ProjectCriterion[]
}

/** The rubric is edited as a whole, so it is written as a whole. */
export async function replaceCriteria(projectId: string, rows: CriterionInput[]) {
  const { error: delErr } = await supabase
    .from('project_criteria')
    .delete()
    .eq('project_id', projectId)
  if (delErr) throw delErr

  const clean = rows.filter((r) => r.label.trim())
  if (clean.length === 0) return
  const { error } = await supabase.from('project_criteria').insert(
    clean.map((r, i) => ({
      project_id: projectId,
      position: i + 1,
      label: r.label.trim(),
      description: r.description.trim(),
      max_points: r.max_points,
    })),
  )
  if (error) throw error
}

/* ------------------------------------------------------------- attachments */

export async function listAttachments(projectId: string) {
  const { data, error } = await supabase
    .from('project_attachments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ProjectAttachment[]
}

export async function uploadProjectFile(projectId: string, file: File) {
  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  // The storage policy reads the project id off the first path segment.
  const path = `${projectId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('project_attachments')
    .insert({
      project_id: projectId,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data as ProjectAttachment
}

export async function deleteAttachment(attachment: ProjectAttachment) {
  const { error } = await supabase
    .from('project_attachments')
    .delete()
    .eq('id', attachment.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([attachment.file_path])
}

/** The bucket is private, so viewing goes through a short-lived signed URL. */
export async function projectFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}
