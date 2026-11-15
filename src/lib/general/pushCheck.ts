import type { PushState } from './types'

/** A pull stays live this many days. */
export const PULL_DAYS = 7

export type PushVerdict =
  | { kind: 'clear' }
  | { kind: 'unknown' }
  | { kind: 'held'; by: string | null; at: string | null; removed: boolean; mainSeq: number; baseSeq: number }

/** Whether pushing a Word or Excel file would replace a newer version in Main. */
export function pushVerdict(state: PushState | null, existsInMain: boolean): PushVerdict {
  if (!state) return existsInMain ? { kind: 'unknown' } : { kind: 'clear' }
  if (state.main_seq <= state.base_seq) return { kind: 'clear' }
  return {
    kind: 'held',
    by: state.main_author,
    at: state.main_at,
    removed: state.main_removed,
    mainSeq: state.main_seq,
    baseSeq: state.base_seq,
  }
}

/** The database's refusal of a push from a copy Main has moved past. */
export function isStalePushError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.startsWith('Main has a newer version of')
}

/** The database's refusal to record a base on an object someone else uploaded (a copied share). */
export function isOthersCopyError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.startsWith('Only whoever uploaded that copy')
}
