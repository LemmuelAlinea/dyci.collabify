import { supabase } from '../supabase'
import type { FileRow } from '../types'

/**
 * Every file the viewer may reach, gathered but not moved. The view is
 * security_invoker, so a student comes back with their own board's files and a
 * professor with their classes' — no role logic here or in the view.
 */
export async function listFiles(scope?: {
  classId?: string
  projectId?: string
  groupId?: string
  boardId?: string
}) {
  let q = supabase.from('file_overview').select('*')
  if (scope?.classId) q = q.eq('class_id', scope.classId)
  if (scope?.projectId) q = q.eq('project_id', scope.projectId)
  if (scope?.groupId) q = q.eq('group_id', scope.groupId)
  if (scope?.boardId) q = q.eq('board_id', scope.boardId)
  const { data, error } = await q.order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FileRow[]
}

/**
 * A signed link. The four stores are four buckets and each row carries its own,
 * so this asks the right one rather than guessing from the path.
 */
export async function fileUrl(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}
