import { supabase } from '../supabase'
import type { ReportConfig } from '../general/reportConfig'

/**
 * General workplace reports. Every figure is computed by a report function in
 * the database (supabase/general-reports.sql), which also decides whose work
 * the caller may see — a member's report comes back locked to themselves no
 * matter what is asked for here.
 */

export type ReportArgs = {
  spaceId: string
  projectIds: string[] | null
  from: string
  to: string
  people: string[]
  teams: string[]
  includeArchived: boolean
  tz: string
}

function common(a: ReportArgs) {
  return {
    p_space: a.spaceId,
    p_projects: a.projectIds && a.projectIds.length ? a.projectIds : null,
    p_from: a.from,
    p_to: a.to,
    p_people: a.people.length ? a.people : null,
    p_teams: a.teams.length ? a.teams : null,
    p_include_archived: a.includeArchived,
    p_tz: a.tz,
  }
}

async function rpc<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  let q = supabase.rpc(name, args)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as T[]
}

export type ScopeRow = {
  project_id: string
  name: string
  status: string
  archived: boolean
  is_lead: boolean
  points_enabled: boolean
  starts_on: string | null
  ends_on: string | null
  member_count: number
}

export type SummaryRow = {
  project_id: string
  tasks_total: number
  todo: number
  in_progress: number
  done: number
  done_in_range: number
  created_in_range: number
  overdue_now: number
  due_in_range: number
  points_total: number
  points_done: number
  minutes_in_range: number
  comments_in_range: number
  files_in_range: number
  commits_in_range: number
  reviews_opened: number
  reviews_applied: number
  reviews_declined: number
  members_active: number
}

export type SeriesRow = {
  project_id: string
  day: string
  done_count: number
  total_count: number
  done_points: number
  total_points: number
}

export type PeopleRow = {
  project_id: string
  user_id: string
  name: string | null
  level: string | null
  teams: string[]
  tasks_held_now: number
  tasks_finished_in_range: number
  tasks_finished_late: number
  points_finished: number
  minutes_logged: number
  comments: number
  files_uploaded: number
  commits: number
  files_changed: number
  reviews_requested: number
  reviews_done: number
  reviews_applied_as_author: number
  first_activity: string | null
  last_activity: string | null
}

export type ActivityRow = {
  at: string
  id: string
  project_id: string
  actor_id: string | null
  actor_name: string | null
  subject_id: string | null
  subject_name: string | null
  kind: string
  task_id: string | null
  task_title: string | null
  detail: Record<string, unknown>
  total: number
}

export type TaskRow = {
  task_id: string
  project_id: string
  title: string
  status: string
  team: string
  holders: string[]
  holder_count: number
  created_by: string | null
  created_at: string
  starts_at: string | null
  due_at: string | null
  completed_at: string | null
  late: boolean
  weight: number
  minutes_in_range: number
  minutes_total: number
  comments: number
  files: number
  archived: boolean
  truncated: boolean
}

export type TimeLogRow = {
  id: string
  project_id: string
  logged_on: string
  user_id: string
  user_name: string | null
  task_id: string
  task_title: string
  minutes: number
  note: string
}

export type CommitRow = {
  id: string
  project_id: string
  seq: number
  at: string
  author: string | null
  message: string
  added: number
  changed: number
  removed: number
  change_title: string | null
  reviewer: string | null
}

export type ReviewRow = {
  id: string
  project_id: string
  title: string
  author: string | null
  reviewer: string | null
  status: string
  opened_at: string
  decided_at: string | null
  decided_by: string | null
  files: number
  comments: number
  hours_open: number
}

const num = <T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) =>
  rows.map((r) => {
    const out = { ...r }
    for (const k of keys) out[k] = Number(r[k] ?? 0) as T[keyof T]
    return out
  })

export const reportScope = (spaceId: string, signal?: AbortSignal) =>
  rpc<ScopeRow>('general_report_scope', { p_space: spaceId, p_projects: null }, signal)

export const reportHistorySince = async () => {
  const { data, error } = await supabase.rpc('general_report_history_since')
  if (error) throw error
  return (data as string | null) ?? null
}

export const reportSummary = async (a: ReportArgs, signal?: AbortSignal) =>
  num(await rpc<SummaryRow>('general_report_summary', common(a), signal), ['points_total', 'points_done'])

export const reportSeries = async (a: ReportArgs, signal?: AbortSignal) =>
  num(await rpc<SeriesRow>('general_report_progress_series', common(a), signal), ['done_points', 'total_points'])

export const reportPeople = async (a: ReportArgs, signal?: AbortSignal) =>
  num(await rpc<PeopleRow>('general_report_people', common(a), signal), ['points_finished'])

export const reportActivity = (
  a: ReportArgs,
  opts: { kinds?: string[]; before?: { at: string; id: string } | null; limit?: number } = {},
  signal?: AbortSignal,
) =>
  rpc<ActivityRow>(
    'general_report_activity',
    {
      ...common(a),
      p_kinds: opts.kinds && opts.kinds.length ? opts.kinds : null,
      p_before: opts.before?.at ?? null,
      p_before_id: opts.before?.id ?? null,
      p_limit: opts.limit ?? 200,
    },
    signal,
  )

export const reportTasks = async (a: ReportArgs, signal?: AbortSignal) =>
  num(await rpc<TaskRow>('general_report_tasks', common(a), signal), ['weight'])

export const reportTimeLogs = (a: ReportArgs, signal?: AbortSignal) =>
  rpc<TimeLogRow>('general_report_time_logs', common(a), signal)

export const reportCommits = (a: ReportArgs, signal?: AbortSignal) =>
  rpc<CommitRow>('general_report_commits', common(a), signal)

export const reportReviews = async (a: ReportArgs, signal?: AbortSignal) =>
  num(await rpc<ReviewRow>('general_report_reviews', common(a), signal), ['hours_open'])

/* -------------------------------------------------------------- templates */

export type ReportTemplate = {
  id: string
  space_id: string
  owner_id: string
  name: string
  description: string
  shared: boolean
  config: ReportConfig
  created_at: string
  updated_at: string
}

export async function listReportTemplates(spaceId: string) {
  const { data, error } = await supabase
    .from('general_report_templates')
    .select('*')
    .eq('space_id', spaceId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ReportTemplate[]
}

export async function createReportTemplate(input: {
  spaceId: string
  ownerId: string
  name: string
  description: string
  shared: boolean
  config: ReportConfig
}) {
  const { data, error } = await supabase
    .from('general_report_templates')
    .insert({
      space_id: input.spaceId,
      owner_id: input.ownerId,
      name: input.name.trim(),
      description: input.description.trim(),
      shared: input.shared,
      config: input.config,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ReportTemplate
}

export async function updateReportTemplate(
  id: string,
  patch: Partial<Pick<ReportTemplate, 'name' | 'description' | 'shared' | 'config'>>,
) {
  const { data, error } = await supabase
    .from('general_report_templates')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('That saved report is not yours to change. Save a copy instead.')
  }
}

export async function deleteReportTemplate(id: string) {
  const { data, error } = await supabase.from('general_report_templates').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('That saved report is already gone, or it is not yours to delete.')
  }
}

/** Project teams in the chosen projects, for the builder's team filter. */
export async function listProjectTeams(projectIds: string[]) {
  if (projectIds.length === 0) return []
  const { data, error } = await supabase
    .from('general_teams')
    .select('id, project_id, name')
    .in('project_id', projectIds)
    .order('name')
  if (error) throw error
  return (data ?? []) as { id: string; project_id: string; name: string }[]
}
