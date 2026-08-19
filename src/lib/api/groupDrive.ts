import { supabase } from './../supabase'
import { uploadTaskFile } from './taskDetail'
import type { GroupFile } from '../types'

const BUCKET = 'group-files'

/**
 * The group's space for work that is not a deliverable yet.
 *
 * The rule that keeps it meaning one thing is in `attachToTask` below: a file
 * leaves the drive when it becomes an attachment, so nothing is ever in both
 * places and there is never a question about which copy counts.
 */
export async function listGroupFiles(groupId: string) {
  const { data, error } = await supabase
    .from('group_file_overview')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GroupFile[]
}

/** Bytes used and the ceiling, so the UI can warn before a long upload fails. */
export async function groupDriveUsage(groupId: string) {
  const [used, limit] = await Promise.all([
    supabase.rpc('group_drive_used', { p_group: groupId }),
    supabase.rpc('group_drive_limit'),
  ])
  if (used.error) throw used.error
  if (limit.error) throw limit.error
  return { used: Number(used.data ?? 0), limit: Number(limit.data ?? 0) }
}

export async function uploadGroupFile(groupId: string, file: File, note = '') {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  // The storage policy reads the group id off the first path segment.
  const path = `${groupId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { error } = await supabase.from('group_files').insert({
    group_id: groupId,
    file_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    note: note.trim(),
  })
  if (error) {
    // The quota check lives in a trigger, so a refusal lands here — do not
    // leave the object behind paying for space the row was denied.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function deleteGroupFile(file: Pick<GroupFile, 'id' | 'file_path'>) {
  const { error } = await supabase.from('group_files').delete().eq('id', file.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([file.file_path])
}

/**
 * Hand a staged file up as the deliverable. This is the one operation that
 * makes the drive mean "not handed in yet".
 *
 * The two buckets have different policies, so the object genuinely moves rather
 * than being re-pointed: fetch, upload under the task, then let go of the
 * original. The drive copy is released **last**, so a failure anywhere leaves
 * the file where the group left it rather than nowhere at all.
 */
export async function attachToTask(file: GroupFile, taskId: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(file.file_path)
  if (error) throw error

  const blob = new File([data], file.file_name, {
    type: file.mime_type || 'application/octet-stream',
  })
  await uploadTaskFile(taskId, blob)

  await deleteGroupFile(file)
}
