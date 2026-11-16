import { supabase } from '../supabase'
import type { FileVersion } from '../general/fileHistory'
import type { FileAction, GeneralBlob, GeneralCommit, GeneralCommitOrigin } from '../general/types'
import { copyProjectFile, saveDraftFile } from './general'
import { mainSeq, recordBase } from './filePulls'

/** Every version of one path in Main, newest first, with its commit. */
export async function fileVersions(
  repoId: string,
  path: string,
): Promise<(GeneralBlob & { commit: GeneralCommit })[]> {
  const { data, error } = await supabase
    .from('general_blobs')
    .select('*, general_commits(*)')
    .eq('repo_id', repoId)
    .eq('path', path)
    .order('seq', { ascending: false })
  if (error) throw error
  return ((data ?? []) as (GeneralBlob & { general_commits: GeneralCommit })[]).map(
    ({ general_commits, ...blob }) => ({ ...blob, commit: general_commits }),
  )
}

/** Which commits in a repo came from a revert or restore, keyed by commit id. */
export async function commitOrigins(repoId: string): Promise<Record<string, GeneralCommitOrigin>> {
  const { data, error } = await supabase
    .from('general_commit_origins')
    .select('*, general_commits!general_commit_origins_commit_id_fkey!inner(repo_id)')
    .eq('general_commits.repo_id', repoId)
  if (error) throw error
  const out: Record<string, GeneralCommitOrigin> = {}
  for (const row of (data ?? []) as (GeneralCommitOrigin & { general_commits?: unknown })[]) {
    const { general_commits: _join, ...origin } = row
    out[origin.commit_id] = origin
  }
  return out
}

export async function revertCommit(
  commitId: string,
  baseSeq: number,
  path?: string,
  message = '',
): Promise<GeneralCommit> {
  const { data, error } = await supabase.rpc('revert_general_commit', {
    p_commit: commitId,
    p_base_seq: baseSeq,
    p_path: path ?? null,
    p_message: message,
  })
  if (error) throw error
  return data as GeneralCommit
}

export async function restoreFile(
  repoId: string,
  path: string,
  seq: number,
  baseSeq: number,
  message = '',
): Promise<GeneralCommit> {
  const { data, error } = await supabase.rpc('restore_general_file', {
    p_repo: repoId,
    p_path: path,
    p_seq: seq,
    p_base_seq: baseSeq,
    p_message: message,
  })
  if (error) throw error
  return data as GeneralCommit
}

/** Puts an old version into the person's draft; nothing reaches Main until they commit. */
export async function restoreToDraft(input: {
  repoId: string
  projectId: string
  path: string
  target: FileVersion | null
  mainHas: boolean
}): Promise<void> {
  const { repoId, projectId, path } = input
  const target = input.target?.action === 'removed' ? null : input.target
  if (!target) {
    await saveDraftFile({ repoId, path, action: 'removed', kind: 'text', content: '' })
    return
  }
  const action: FileAction = input.mainHas ? 'changed' : 'added'
  if (target.kind === 'binary') {
    const copy = await copyProjectFile(projectId, target.storage_path ?? '')
    await saveDraftFile({ repoId, path, action, kind: 'binary', storagePath: copy })
    await recordBase(repoId, path, copy, await mainSeq(repoId, path))
    return
  }
  await saveDraftFile({ repoId, path, action, kind: target.kind, content: target.content })
}
