import { supabase } from '../supabase'
import type { BoardSummary, MemberProgress } from '../types'

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

export type GroupMemberLoad = {
  student_id: string
  task_count: number
  done_count: number
  /** Of the work they hold across this group's projects, how much is finished. */
  personal_pct: number | null
  /** How much of those projects they are carrying, averaged over them. */
  held_pct: number
}

/**
 * Each member's finished-over-held across every project the group has, not just
 * one board — a group with three projects has three boards, and a member's
 * standing is the sum of them.
 */
export async function groupMemberLoad(groupId: string) {
  const boards = await listGroupBoards([groupId])
  if (boards.length === 0) return new Map<string, GroupMemberLoad>()

  const { data, error } = await supabase
    .from('task_member_progress')
    .select('*')
    .in(
      'board_id',
      boards.map((b) => b.id),
    )
  if (error) throw error

  const out = new Map<string, GroupMemberLoad & { held: number; done: number }>()
  for (const row of (data ?? []) as MemberProgress[]) {
    const seen = out.get(row.student_id) ?? {
      student_id: row.student_id,
      task_count: 0,
      done_count: 0,
      personal_pct: null,
      held_pct: 0,
      held: 0,
      done: 0,
    }
    seen.task_count += row.task_count
    seen.done_count += row.done_count
    seen.held += Number(row.held_weight)
    seen.done += Number(row.done_weight)
    seen.held_pct += Number(row.held_pct)
    out.set(row.student_id, seen)
  }

  const merged = new Map<string, GroupMemberLoad>()
  for (const [id, r] of out) {
    merged.set(id, {
      student_id: id,
      task_count: r.task_count,
      done_count: r.done_count,
      // Null rather than zero: holding nothing is not the same as finishing none.
      personal_pct: r.held > 0 ? Math.round((r.done / r.held) * 1000) / 10 : null,
      held_pct: Math.round((r.held_pct / boards.length) * 10) / 10,
    })
  }
  return merged
}
