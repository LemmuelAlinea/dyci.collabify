import { supabase } from '../supabase'
import { addDays } from '../analyticsMath'
import type {
  BoardDecision,
  DeliverableRow,
  MemberLoad,
  ReportEventRow,
  ReportSprint,
  ResultVerdict,
  TaskState,
} from '../types'
import { pageAll, pageAllIn } from './paging'

/**
 * Reads for the B3 reports, each scoped to one class. The views are already
 * scoped to the class's own professor; the class filter keeps a professor with
 * many classes from loading all of them for one report. A project id narrows a
 * read to that one project, for a report about it alone.
 */

export async function listDeliverables(classId: string, projectId?: string) {
  return pageAll<DeliverableRow>(async (from, to) => {
    const q = supabase.from('report_deliverables').select('*').eq('class_id', classId)
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q)
      .order('project_id')
      .order('board_id')
      .order('kind')
      .order('ref_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as DeliverableRow[]
  })
}

export async function listReportSprints(classId: string, projectId?: string) {
  return pageAll<ReportSprint>(async (from, to) => {
    const q = supabase.from('report_sprints').select('*').eq('class_id', classId)
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q)
      .order('starts_on')
      .order('sprint_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ReportSprint[]
  })
}

export async function classTaskStates(classId: string, projectId?: string) {
  return pageAll<TaskState>(async (from, to) => {
    const q = supabase.from('task_state').select('*').eq('class_id', classId)
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q)
      .order('task_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as TaskState[]
  })
}

export async function classMemberLoad(classId: string, projectId?: string) {
  return pageAll<MemberLoad>(async (from, to) => {
    const q = supabase.from('class_member_load').select('*').eq('class_id', classId)
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q)
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as MemberLoad[]
  })
}

type DecisionRow = {
  id: string
  board_id: string
  verdict: ResultVerdict
  feedback: string
  decided_at: string
  decided_by: string | null
}

/** Every answer on these boards, oldest first, with who gave it. */
export async function boardHistoryFor(boardIds: string[]): Promise<BoardDecision[]> {
  const rows = await pageAllIn<DecisionRow>(boardIds, async (ids, from, to) => {
    const { data, error } = await supabase
      .from('board_results')
      .select('id, board_id, verdict, feedback, decided_at, decided_by')
      .in('board_id', ids)
      .order('decided_at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as DecisionRow[]
  })
  const people = [...new Set(rows.map((r) => r.decided_by).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  const found = await pageAllIn<{ id: string; first_name: string; last_name: string }>(people, async (ids, from, to) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', ids)
      .order('id')
      .range(from, to)
    if (error) throw error
    return data ?? []
  })
  for (const p of found) names.set(p.id, `${p.first_name} ${p.last_name}`.trim())
  return rows
    .sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      board_id: r.board_id,
      verdict: r.verdict,
      feedback: r.feedback,
      decided_at: r.decided_at,
      decided_by_name: r.decided_by ? names.get(r.decided_by) ?? null : null,
    }))
}

/** Every task event in the class between two Manila days, both included, oldest first. */
export async function listTaskEvents(classId: string, range: { from: string; to: string }) {
  const start = new Date(`${range.from}T00:00:00+08:00`).toISOString()
  const end = new Date(`${addDays(range.to, 1)}T00:00:00+08:00`).toISOString()
  return pageAll<ReportEventRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('report_task_events')
      .select('*')
      .eq('class_id', classId)
      .gte('at', start)
      .lt('at', end)
      .order('at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ReportEventRow[]
  })
}
