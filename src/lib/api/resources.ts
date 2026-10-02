import { supabase } from '../supabase'
import type { ResourceKind, TeachingResource } from '../types'

const BUCKET = 'teaching-resources'

/** The live library: archived and trashed ones stay out, here and in the class pickers. */
export async function listResources(professorId: string, kind: ResourceKind) {
  const { data, error } = await supabase
    .from('teaching_resources')
    .select('*')
    .eq('professor_id', professorId)
    .eq('kind', kind)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TeachingResource[]
}

/** Archived, not trashed: the library's own archive section. */
export async function listArchivedResources(kind: ResourceKind, scope: { professorId: string } | 'program') {
  let query = supabase
    .from('teaching_resources')
    .select('*')
    .eq('kind', kind)
    .not('archived_at', 'is', null)
    .is('trashed_at', null)
  query = scope === 'program' ? query.eq('program_wide', true) : query.eq('professor_id', scope.professorId)
  const { data, error } = await query.order('archived_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TeachingResource[]
}

export async function archiveResource(id: string, archived: boolean) {
  const { error } = await supabase.rpc('archive_teaching_resource', { p_resource: id, p_archived: archived })
  if (error) throw error
}

export async function trashResource(id: string) {
  const { error } = await supabase.rpc('trash_teaching_resource', { p_resource: id })
  if (error) throw error
}

/**
 * What the program office has published, for everybody.
 *
 * A professor attaches one of these to a class exactly as they would their own:
 * it is the same table and the same id, which is why `classes.syllabus_id` and
 * the week map needed no change at all.
 */
export async function listProgramResources(kind: ResourceKind) {
  const { data, error } = await supabase
    .from('teaching_resources')
    .select('*')
    .eq('kind', kind)
    .eq('program_wide', true)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TeachingResource[]
}

export async function uploadResource(input: {
  professorId: string
  kind: ResourceKind
  title: string
  file: File
  /** Only an admin may set this; a trigger refuses anybody else. */
  programWide?: boolean
}) {
  const safeName = input.file.name.replace(/[^\w.-]+/g, '_')
  const path = `${input.professorId}/${input.kind}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.file, { contentType: input.file.type || undefined })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('teaching_resources')
    .insert({
      professor_id: input.professorId,
      kind: input.kind,
      title: input.title.trim(),
      file_path: path,
      file_name: input.file.name,
      size_bytes: input.file.size,
      program_wide: input.programWide ?? false,
    })
    .select('*')
    .single()

  if (error) {
    // Do not leave an orphan object behind if the row insert is rejected.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data as TeachingResource
}

/** The bucket is private, so viewing goes through a short-lived signed URL. */
export async function resourceUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

/**
 * Deletes an archived syllabus or curriculum for good, skipping the 30 days in
 * Trash: it goes to Trash and is deleted from there in the same breath, so the
 * same checks and the same storage sweep apply. Classes using it lose it.
 */
export async function deleteResourceForGood(id: string) {
  await trashResource(id)
  const { error } = await supabase.rpc('delete_trashed_resource', { p_resource: id })
  if (error) throw error
}
