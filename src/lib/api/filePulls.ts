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
