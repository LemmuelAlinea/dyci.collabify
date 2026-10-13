import { supabase } from '../supabase'
import type { BoardScore, MyGrade, ScoreSheetRow } from '../types'

export type CriterionPoints = { criterion_id: string; points: number }
export type MemberFinal = { student_id: string; final: number }

/** Professor: every criterion's points for one board. The database refuses a partial list. */
export async function saveBoardScores(boardId: string, points: CriterionPoints[]) {
  const { error } = await supabase.rpc('save_board_scores', { p_board: boardId, p_points: points })
  if (error) throw error
}

/** Professor: each member's score. An individual board takes an empty list. */
export async function confirmMemberScores(boardId: string, rows: MemberFinal[]) {
  const { error } = await supabase.rpc('confirm_member_scores', { p_board: boardId, p_rows: rows })
  if (error) throw error
}

/** Returns how many students were notified. Zero when it was already released. */
export async function releaseProjectScores(projectId: string) {
  const { data, error } = await supabase.rpc('release_project_scores', { p_project: projectId })
  if (error) throw error
  return (data as number | null) ?? 0
}

export async function unreleaseProjectScores(projectId: string) {
  const { error } = await supabase.rpc('unrelease_project_scores', { p_project: projectId })
  if (error) throw error
}

export async function clearProjectScores(projectId: string) {
  const { error } = await supabase.rpc('clear_project_scores', { p_project: projectId })
  if (error) throw error
}

export async function scoreSheet(projectId: string) {
  const { data, error } = await supabase.rpc('score_sheet', { p_project: projectId })
  if (error) throw error
  return ((data ?? []) as ScoreSheetRow[]).map((r) => ({
    ...r,
    group_total: r.group_total === null ? null : Number(r.group_total),
    factor: r.factor === null ? null : Number(r.factor),
    suggested_now: r.suggested_now === null ? null : Number(r.suggested_now),
    suggested_saved: r.suggested_saved === null ? null : Number(r.suggested_saved),
    final: r.final === null ? null : Number(r.final),
    factor_saved: r.factor_saved === null ? null : Number(r.factor_saved),
  }))
}

/** Criterion points on the given boards. A project's boards number in the tens. */
export async function projectBoardScores(boardIds: string[]) {
  if (boardIds.length === 0) return []
  const { data, error } = await supabase
    .from('board_scores')
    .select('board_id, criterion_id, points, scored_at')
    .in('board_id', boardIds)
  if (error) throw error
  return ((data ?? []) as BoardScore[]).map((s) => ({ ...s, points: Number(s.points) }))
}

/** Professor: whether the rubric is locked by scores. False for anyone else. */
export async function projectHasScores(projectId: string) {
  const { data, error } = await supabase.rpc('project_has_scores', { p_project: projectId })
  if (error) throw error
  return Boolean(data)
}

/** Student: the released grade, or null. */
export async function myGrade(projectId: string) {
  const { data, error } = await supabase.rpc('my_grade', { p_project: projectId })
  if (error) throw error
  return (data as MyGrade | null) ?? null
}
