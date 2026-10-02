import { downloadDiscussionFile } from '../api/discussions'
import type { DraftSharedFile } from '../api/workAi'

/**
 * Copies a discussion's shared files onto a saved task, through `upload` (the
 * task's own Files, work or class). Answers how many could not go.
 */
export async function attachSharedFiles(
  ids: string[],
  shared: DraftSharedFile[],
  limit: number,
  upload: (file: File) => Promise<unknown>,
) {
  let missed = 0
  for (const id of ids) {
    const f = shared.find((x) => x.id === id)
    if (!f || f.size > limit) {
      missed++
      continue
    }
    try {
      await upload(await downloadDiscussionFile(f.path, f.name, f.mime))
    } catch {
      missed++
    }
  }
  return missed
}
