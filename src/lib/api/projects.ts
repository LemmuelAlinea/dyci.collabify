import { supabase } from '../supabase'
import type {
  ProjectAttachment,
  ProjectAudience,
  ProjectCriterion,
  ProjectSummary,
  ProjectType,
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
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
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
