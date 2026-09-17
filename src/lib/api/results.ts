import { supabase } from '../supabase'
import type { BoardResult, BoardSummary, ResultVerdict } from '../types'

/**
 * The professor's answer to what a group handed in.
 *
 * Returning it un-submits the board, which is what gives the group their work
 * back — that happens inside `record_board_result`, so the row and the board
 * can never disagree about whether a project is open.
 */
export async function boardResult(boardId: string) {
  const { data, error } = await supabase
    .from('board_result_overview')
    .select('*')
    .eq('board_id', boardId)
    .maybeSingle()
  if (error) throw error
  return (data as BoardResult | null) ?? null
}

export async function recordResult(input: {
  boardId: string
  verdict: ResultVerdict
  feedback?: string
}) {
  const { error } = await supabase.rpc('record_board_result', {
    p_board: input.boardId,
    p_verdict: input.verdict,
    p_feedback: input.feedback?.trim() ?? '',
  })
  if (error) throw error
}

/**
 * Every board on these projects that has been handed in at least once.
 *
 * Filtered on the verdict as well as `submitted_at`, because returning work
 * nulls `submitted_at` — without the second half a returned board would vanish
 * the moment it was answered. `toSubmissions` then drops the one case the query
 * cannot: accepted work the group has since taken back.
 */
export async function listHandedInBoards(projectIds: string[]) {
  if (projectIds.length === 0) return []
  const { data, error } = await supabase
    .from('task_board_overview')
    .select('*')
    .in('project_id', projectIds)
    .or('submitted_at.not.is.null,result_verdict.not.is.null')
  if (error) throw error
  return (data ?? []) as BoardSummary[]
}
