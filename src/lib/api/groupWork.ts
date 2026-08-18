import { supabase } from '../supabase'
import type { BoardSummary } from '../types'

/**
 * The boards belonging to a set of groups — one query for a whole page of
 * cards rather than one per card. RLS already narrows a student to their own.
 */
export async function listGroupBoards(groupIds: string[]) {
  if (groupIds.length === 0) return []
  const { data, error } = await supabase
    .from('task_board_overview')
    .select('*')
    .in('group_id', groupIds)
  if (error) throw error
  return (data ?? []) as BoardSummary[]
}

export type GroupWorkSummary = {
  projects: number
  tasks: number
  done: number
  /** Weighted, so it matches what the project page reports. */
  pct: number
}

/** What a group card shows: how much work it holds and how far it has got. */
export function summariseGroupWork(boards: BoardSummary[]): GroupWorkSummary {
  if (boards.length === 0) return { projects: 0, tasks: 0, done: 0, pct: 0 }
  const tasks = boards.reduce((n, b) => n + b.task_count, 0)
  const done = boards.reduce((n, b) => n + b.done_count, 0)
  const withWork = boards.filter((b) => b.task_count > 0)
  const pct = withWork.length
    ? Math.round((withWork.reduce((n, b) => n + Number(b.done_pct), 0) / withWork.length) * 10) /
      10
    : 0
  return { projects: boards.length, tasks, done, pct }
}

/** Keyed by group, for a board of cards. */
export function groupWorkByGroup(boards: BoardSummary[]) {
  const map = new Map<string, BoardSummary[]>()
  for (const b of boards) {
    if (!b.group_id) continue
    map.set(b.group_id, [...(map.get(b.group_id) ?? []), b])
  }
  const out = new Map<string, GroupWorkSummary>()
  for (const [groupId, list] of map) out.set(groupId, summariseGroupWork(list))
  return out
}
