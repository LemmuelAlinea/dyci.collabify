/**
 * Trash: files and folders someone threw away, kept 30 days before they go
 * for good. Separate from Archive, which hides what a project may want again.
 * See supabase/trash.sql.
 *
 * Deleting here removes the row only. The storage sweep takes the bytes once
 * nothing points at them, so no delete here can half-succeed.
 */
import { supabase } from '../supabase'

export type TrashItem = {
  kind: 'draft' | 'task_file' | 'resource'
  /** The task file or the syllabus or curriculum. */
  id: string | null
  /** The repository and trashed path, for kind 'draft'. */
  repo_id: string | null
  root: string | null
  name: string
  is_folder: boolean
  file_count: number
  size_bytes: number | null
  trashed_at: string
  purge_at: string
  /** Empty for a syllabus or curriculum, which belongs to nobody's project. */
  project_id: string | null
  /** The project, or Syllabi or Curriculum. */
  project_name: string
  /** Set when the files belong to a class project's board. */
  class_project_id: string | null
  task_title: string | null
  /** The project is archived or handed in, so nothing can come back yet. */
  frozen: boolean
  resource_kind: 'syllabus' | 'curriculum' | null
}

export async function listMyTrash() {
  const { data, error } = await supabase.rpc('list_my_trash')
  if (error) throw error
  return (data ?? []) as TrashItem[]
}

export async function trashDraftPath(repoId: string, path: string) {
  const { error } = await supabase.rpc('trash_general_draft_path', { p_repo: repoId, p_path: path })
  if (error) throw error
}

export async function trashTaskFile(fileId: string) {
  const { error } = await supabase.rpc('trash_general_task_file', { p_file: fileId })
  if (error) throw error
}

export async function restoreTrashItem(item: TrashItem) {
  const { error } =
    item.kind === 'draft'
      ? await supabase.rpc('restore_trashed_draft_path', { p_repo: item.repo_id, p_root: item.root })
      : item.kind === 'resource'
        ? await supabase.rpc('restore_trashed_resource', { p_resource: item.id })
        : await supabase.rpc('restore_trashed_task_file', { p_file: item.id })
  if (error) throw error
}

export async function deleteTrashItem(item: TrashItem) {
  const { error } =
    item.kind === 'draft'
      ? await supabase.rpc('delete_trashed_draft_path', { p_repo: item.repo_id, p_root: item.root })
      : item.kind === 'resource'
        ? await supabase.rpc('delete_trashed_resource', { p_resource: item.id })
        : await supabase.rpc('delete_trashed_task_file', { p_file: item.id })
  if (error) throw error
}

export async function emptyMyTrash() {
  const { data, error } = await supabase.rpc('empty_my_trash')
  if (error) throw error
  return (data ?? 0) as number
}
