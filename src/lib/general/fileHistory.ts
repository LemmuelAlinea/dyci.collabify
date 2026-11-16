import type { FileAction, FileKind } from './types'

/** One version of a file path in Main, as the history lists it. */
export type FileVersion = {
  seq: number
  action: FileAction
  kind: FileKind
  content: string
  storage_path: string | null
}

/** The file as it stood before `seq`: the newest lower version, or null when none or it was a removal. */
export function stateBefore(versions: FileVersion[], seq: number): FileVersion | null {
  let best: FileVersion | null = null
  for (const v of versions) {
    if (v.seq < seq && (!best || v.seq > best.seq)) best = v
  }
  return best && best.action !== 'removed' ? best : null
}

/** What putting `target` back over `current` does to the file, or null when nothing changes. */
export function putBack(target: FileVersion | null, current: FileVersion | null): FileAction | null {
  if (target?.action === 'removed') target = null
  if (current?.action === 'removed') current = null
  if (!target && !current) return null
  if (!target) return 'removed'
  if (!current) return 'added'
  const same =
    target.kind === current.kind &&
    target.content === current.content &&
    target.storage_path === current.storage_path
  return same ? null : 'changed'
}

/** Paths with a version after `seq`, sorted and unique. Any of them blocks a revert. */
export function laterEdits(blobs: { path: string; seq: number }[], seq: number): string[] {
  return [...new Set(blobs.filter((b) => b.seq > seq).map((b) => b.path))].sort()
}

/** The line a commit made by a revert or restore shows. */
export function originLabel(o: {
  kind: 'revert' | 'restore'
  source_seq: number
  path: string | null
}): string {
  if (o.kind === 'restore') return `Restores ${o.path} to #${o.source_seq}`
  return o.path ? `Undoes #${o.source_seq} on ${o.path}` : `Reverts #${o.source_seq}`
}
