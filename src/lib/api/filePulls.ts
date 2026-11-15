import { supabase } from '../supabase'
import type { FilePull, PushState } from '../general/types'

export async function pullFile(repoId: string, path: string, fromMain: boolean): Promise<FilePull> {
  const { data, error } = await supabase.rpc('pull_general_file', {
    p_repo: repoId,
    p_path: path,
    p_from_main: fromMain,
  })
  if (error) throw error
  return data as FilePull
}

export async function endPull(repoId: string, path: string): Promise<void> {
  const { error } = await supabase.rpc('end_general_file_pull', { p_repo: repoId, p_path: path })
  if (error) throw error
}

/** Live pulls the caller may see (row-level security drops the rest). */
export async function listPulls(repoId: string): Promise<FilePull[]> {
  const { data, error } = await supabase
    .from('general_file_pulls')
    .select('*')
    .eq('repo_id', repoId)
    .order('pulled_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FilePull[]
}

export async function pushState(repoId: string, path: string, userId?: string): Promise<PushState | null> {
  const { data, error } = await supabase.rpc('general_file_push_state', {
    p_repo: repoId,
    p_path: path,
    p_user: userId ?? null,
  })
  if (error) throw error
  const rows = (data ?? []) as PushState[]
  return rows[0] ?? null
}

/**
 * Records the Main version an uploaded Word copy was made from, right after
 * the upload and before it is saved or committed. Main refuses the copy while
 * it has a newer version of the path than this base.
 */
export async function recordBase(repoId: string, path: string, storagePath: string, baseSeq: number): Promise<void> {
  const { error } = await supabase.rpc('record_general_file_base', {
    p_repo: repoId,
    p_path: path,
    p_storage: storagePath,
    p_base_seq: baseSeq,
  })
  if (error) throw error
}

/** An uploaded copy's base next to Main's newest version of its path; null when it has no base on record. */
export async function baseOf(storagePath: string): Promise<PushState | null> {
  const { data, error } = await supabase.rpc('general_file_base_state', { p_storage: storagePath })
  if (error) throw error
  const rows = (data ?? []) as PushState[]
  return rows[0] ?? null
}

/** Main's newest version of a path (a removal included); 0 when Main never had it. */
export async function mainSeq(repoId: string, path: string): Promise<number> {
  const { data, error } = await supabase.rpc('general_main_seq', { p_repo: repoId, p_path: path })
  if (error) throw error
  return Number(data ?? 0)
}
