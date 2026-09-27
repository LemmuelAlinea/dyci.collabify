import { getRepo, listTree } from '../api/general'
import { repoFileAsUpload } from './repoAttach'
export { attachSummary } from './attachSummary'
import type { GeneralTreeFile } from './types'

/** Main of a project's Files, or nothing if its Files were never started. */
export async function repoTree(generalProjectId: string) {
  const repo = await getRepo(generalProjectId)
  return repo ? listTree(repo.id) : []
}

/**
 * Attach picked Files to a task one at a time, so one that fails never takes
 * the rest with it. Returns the paths that went, and the ones that did not
 * with why.
 */
export async function attachFromRepo(
  files: GeneralTreeFile[],
  fromFolder: boolean,
  upload: (file: File) => Promise<unknown>,
  maxBytes: number,
) {
  const added: string[] = []
  const failed: { path: string; reason: string }[] = []
  for (const f of files) {
    try {
      const file = await repoFileAsUpload(f, fromFolder)
      if (file.size > maxBytes) {
        failed.push({ path: f.path, reason: `over ${Math.round(maxBytes / 1024 / 1024)} MB` })
        continue
      }
      await upload(file)
      added.push(f.path)
    } catch (err) {
      failed.push({ path: f.path, reason: err instanceof Error ? err.message : 'could not be attached' })
    }
  }
  return { added, failed }
}
