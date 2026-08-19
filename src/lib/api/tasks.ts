import { supabase } from '../supabase'
import { byLastName } from '../types'
import type {
  BoardSummary,
  MemberProgress,
  ProjectTask,
  TaskAssignee,
  TaskEvent,
  TaskStatus,
} from '../types'

const PROFILE_COLS = 'id, first_name, middle_name, last_name, avatar_url'

/* ---------------------------------------------------------------- boards */

export async function listBoards(projectId: string) {
  const { data, error } = await supabase
    .from('task_board_overview')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return ((data ?? []) as BoardSummary[]).sort((a, b) =>
    (a.group_name ?? '').localeCompare(b.group_name ?? '', 'en', { numeric: true }),
  )
}

/** The one board this viewer works on, if they are a student. */
export async function myBoard(projectId: string, studentId: string) {
  const boards = await listBoards(projectId)
  return (
    boards.find((b) => b.student_id === studentId) ??
    boards.find((b) => b.group_id) ??
    null
  )
}

/**
 * How far each member has got, on one board. The names are fetched separately:
 * a view carries no foreign keys, so PostgREST cannot embed through it.
 */
export async function listMemberProgress(boardId: string) {
  const { data, error } = await supabase
    .from('task_member_progress')
    .select('*')
    .eq('board_id', boardId)
  if (error) throw error

  const rows = (data ?? []) as MemberProgress[]
  if (rows.length === 0) return []

  const { data: people, error: pErr } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .in(
      'id',
      rows.map((r) => r.student_id),
    )
  if (pErr) throw pErr

  const byId = new Map(
    ((people ?? []) as MemberProgress['profile'][]).map((p) => [p!.id, p!]),
  )
  return rows
    .map((r) => ({ ...r, profile: byId.get(r.student_id) }))
    .sort((a, b) => (a.profile && b.profile ? byLastName(a.profile, b.profile) : 0))
}

/** Board progress for a list of projects, keyed by project — for cards. */
export async function boardProgressFor(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, BoardSummary>()
  const { data, error } = await supabase
    .from('task_board_overview')
    .select('*')
    .in('project_id', projectIds)
  if (error) throw error
  const map = new Map<string, BoardSummary>()
  for (const row of (data ?? []) as BoardSummary[]) {
    // A student sees one board per project; a professor sees many, so keep the
    // first and let the project page show the per-group breakdown.
    if (!map.has(row.project_id)) map.set(row.project_id, row)
  }
  return map
}

/* ----------------------------------------------------------------- tasks */

export async function listTasks(boardId: string) {
  // Read through the detail view rather than the table: it carries the same
  // columns plus the file and comment counts, so a card can show them without
  // a query each.
  const { data, error } = await supabase
    .from('task_detail_overview')
    .select('*')
    .eq('board_id', boardId)
    .order('position')
  if (error) throw error
  const tasks = (data ?? []) as ProjectTask[]
  if (tasks.length === 0) return []

  const { data: rows, error: aErr } = await supabase
    .from('task_assignees')
    .select(
      `task_id, student_id, claimed_by, claimed_at, profile:profiles!task_assignees_student_id_fkey (${PROFILE_COLS})`,
    )
    .in(
      'task_id',
      tasks.map((t) => t.id),
    )
  if (aErr) throw aErr

  const assignees = (rows ?? []) as unknown as TaskAssignee[]
  return tasks.map((t) => ({
    ...t,
    assignees: assignees
      .filter((a) => a.task_id === t.id && a.profile)
      .sort((a, b) => byLastName(a.profile!, b.profile!)),
  }))
}

/** Every task on a project, with who is on it and which group it belongs to. */
export type ProjectTaskRow = ProjectTask & {
  group_id: string | null
  group_name: string | null
  file_count: number
  comment_count: number
  logged_minutes: number
}

export async function listProjectTaskRows(projectId: string) {
  const boards = await listBoards(projectId)
  if (boards.length === 0) return { boards, rows: [] as ProjectTaskRow[] }

  const { data, error } = await supabase
    .from('task_detail_overview')
    .select('*')
    .in(
      'board_id',
      boards.map((b) => b.id),
    )
    .order('position')
  if (error) throw error

  const rows = (data ?? []) as (ProjectTask & {
    file_count: number
    comment_count: number
    logged_minutes: number
  })[]
  if (rows.length === 0) return { boards, rows: [] as ProjectTaskRow[] }

  const { data: people, error: aErr } = await supabase
    .from('task_assignees')
    .select(
      `task_id, student_id, claimed_by, claimed_at, profile:profiles!task_assignees_student_id_fkey (${PROFILE_COLS})`,
    )
    .in(
      'task_id',
      rows.map((t) => t.id),
    )
  if (aErr) throw aErr

  const assignees = (people ?? []) as unknown as TaskAssignee[]
  const boardById = new Map(boards.map((b) => [b.id, b]))

  return {
    boards,
    rows: rows.map<ProjectTaskRow>((t) => ({
      ...t,
      assignees: assignees
        .filter((a) => a.task_id === t.id && a.profile)
        .sort((a, b) => byLastName(a.profile!, b.profile!)),
      group_id: boardById.get(t.board_id)?.group_id ?? null,
      group_name: boardById.get(t.board_id)?.group_name ?? null,
    })),
  }
}

/** A task carrying enough of its project to be read out of context. */
export type MyTask = ProjectTask & {
  project_id: string
  project_title: string
  class_initial: string
  class_name: string
  group_name: string | null
  file_count: number
  comment_count: number
  logged_minutes: number
  /** Total weight on its board, so the task's share can be worked out. */
  board_weight: number
}

/** Everything assigned to one student, across every project they are in. */
export async function myTasks(studentId: string) {
  const { data, error } = await supabase
    .from('task_assignees')
    .select('task_id')
    .eq('student_id', studentId)
  if (error) throw error
  const ids = (data ?? []).map((r) => (r as { task_id: string }).task_id)
  if (ids.length === 0) return []

  const { data: tasks, error: tErr } = await supabase
    .from('project_tasks')
    .select(
      `*, board:project_boards!inner (
         project:projects!inner (id, title, class:classes!inner (initial, name)),
         group:groups (name)
       )`,
    )
    .in('id', ids)
    .order('due_at', { nullsFirst: false })
  if (tErr) throw tErr

  type Row = ProjectTask & {
    board: {
      project: { id: string; title: string; class: { initial: string; name: string } }
      group: { name: string } | null
    }
  }

  const rows = (tasks ?? []) as unknown as Row[]
  if (rows.length === 0) return []

  // Counts and board weight come from the views, which carry no foreign keys to
  // embed through — two small lookups rather than one per card.
  const [{ data: counts }, { data: boards }] = await Promise.all([
    supabase
      .from('task_detail_overview')
      .select('id, file_count, comment_count, logged_minutes')
      .in('id', rows.map((t) => t.id)),
    supabase
      .from('task_board_overview')
      .select('id, total_weight')
      .in('id', rows.map((t) => t.board_id)),
  ])

  type Count = { id: string; file_count: number; comment_count: number; logged_minutes: number }
  const byTask = new Map(((counts ?? []) as Count[]).map((c) => [c.id, c]))
  const byBoard = new Map(
    ((boards ?? []) as { id: string; total_weight: number }[]).map((b) => [
      b.id,
      Number(b.total_weight),
    ]),
  )

  return rows.map<MyTask>((t) => ({
    ...t,
    assignees: [],
    project_id: t.board.project.id,
    project_title: t.board.project.title,
    class_initial: t.board.project.class.initial,
    class_name: t.board.project.class.name,
    group_name: t.board.group?.name ?? null,
    file_count: byTask.get(t.id)?.file_count ?? 0,
    comment_count: byTask.get(t.id)?.comment_count ?? 0,
    logged_minutes: byTask.get(t.id)?.logged_minutes ?? 0,
    board_weight: byBoard.get(t.board_id) ?? 0,
  }))
}

export type TaskInput = {
  title: string
  details: string
  weight: number
  dueAt: string | null
}

export async function addTask(
  boardId: string,
  input: TaskInput,
  createdBy: string,
  aiGenerated = false,
) {
  const { data: last } = await supabase
    .from('project_tasks')
    .select('position')
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('project_tasks')
    .insert({
      board_id: boardId,
      title: input.title.trim(),
      details: input.details.trim(),
      weight: input.weight,
      due_at: input.dueAt,
      position: ((last as { position: number } | null)?.position ?? 0) + 1,
      created_by: createdBy,
      author_role: 'student',
      ai_generated: aiGenerated,
    })
    .select('*')
    .single()
  if (error) throw error
  return { ...(data as ProjectTask), assignees: [] }
}

export async function updateTask(taskId: string, input: TaskInput) {
  const { error } = await supabase
    .from('project_tasks')
    .update({
      title: input.title.trim(),
      details: input.details.trim(),
      weight: input.weight,
      due_at: input.dueAt,
    })
    .eq('id', taskId)
  if (error) throw error
}

export async function setTaskStatus(taskId: string, status: TaskStatus) {
  const { error } = await supabase.from('project_tasks').update({ status }).eq('id', taskId)
  if (error) throw error
}

export async function deleteTask(taskId: string) {
  const { error } = await supabase.from('project_tasks').delete().eq('id', taskId)
  if (error) throw error
}

/* ------------------------------------------------------------- assignees */

export async function claimTask(taskId: string, studentId: string, byStudentId: string) {
  const { error } = await supabase
    .from('task_assignees')
    .insert({ task_id: taskId, student_id: studentId, claimed_by: byStudentId })
  if (error) throw error
}

export async function releaseTask(taskId: string, studentId: string) {
  const { error } = await supabase
    .from('task_assignees')
    .delete()
    .eq('task_id', taskId)
    .eq('student_id', studentId)
  if (error) throw error
}

/* ---------------------------------------------------------------- trail */

export async function listTaskEvents(taskId: string) {
  const { data, error } = await supabase
    .from('task_events')
    .select(
      `id, task_id, actor_id, kind, detail, at, actor:profiles!task_events_actor_id_fkey (first_name, last_name, avatar_url)`,
    )
    .eq('task_id', taskId)
    .order('at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as TaskEvent[]
}

/* -------------------------------------------------------- professor side */

export type FanOutResult = {
  result: 'created' | 'not_found' | 'not_allowed' | 'no_title'
  origin_id?: string
  boards?: number
}

/** Writes one task to a single board, or to every board on the project. */
export async function createProfessorTask(input: {
  projectId: string
  title: string
  details: string
  weight: number
  dueAt: string | null
  /** Null hands it to every group in the set. */
  boardId: string | null
  aiGenerated?: boolean
}) {
  const { data, error } = await supabase.rpc('create_professor_task', {
    p_project: input.projectId,
    p_title: input.title,
    p_details: input.details,
    p_weight: input.weight,
    p_due_at: input.dueAt,
    p_board: input.boardId,
    p_ai: input.aiGenerated ?? false,
  })
  if (error) throw error
  return data as FanOutResult
}

export async function updateProfessorTask(
  originId: string,
  input: TaskInput,
): Promise<{ result: string; changed?: number; frozen?: number }> {
  const { data, error } = await supabase.rpc('update_professor_task', {
    p_origin: originId,
    p_title: input.title,
    p_details: input.details,
    p_weight: input.weight,
    p_due_at: input.dueAt,
  })
  if (error) throw error
  return data as { result: string; changed?: number; frozen?: number }
}

export async function deleteProfessorTask(originId: string) {
  const { data, error } = await supabase.rpc('delete_professor_task', { p_origin: originId })
  if (error) throw error
  return data as { result: string; removed?: number; kept?: number }
}

/**
 * One professor task, seen once rather than per group. The copies diverge as
 * groups edit theirs, so the newest wording is only a summary.
 */
export type ProfessorTaskGroup = {
  origin_id: string
  title: string
  details: string
  weight: number
  due_at: string | null
  boards: number
  started: number
  done: number
}

export function groupByOrigin(tasks: ProjectTask[]): ProfessorTaskGroup[] {
  const out = new Map<string, ProfessorTaskGroup>()
  for (const t of tasks) {
    if (!t.origin_id) continue
    const row = out.get(t.origin_id) ?? {
      origin_id: t.origin_id,
      title: t.title,
      details: t.details,
      weight: t.weight,
      due_at: t.due_at,
      boards: 0,
      started: 0,
      done: 0,
    }
    row.boards += 1
    if (t.status !== 'todo') row.started += 1
    if (t.status === 'done') row.done += 1
    out.set(t.origin_id, row)
  }
  return [...out.values()]
}

/** Every task on a project, for the professor's per-group view. */
export async function listProjectTasks(projectId: string) {
  const boards = await listBoards(projectId)
  if (boards.length === 0) return { boards, tasks: [] as ProjectTask[] }

  const { data, error } = await supabase
    .from('project_tasks')
    .select('*')
    .in(
      'board_id',
      boards.map((b) => b.id),
    )
    .order('position')
  if (error) throw error
  const tasks = ((data ?? []) as ProjectTask[]).map((t) => ({ ...t, assignees: [] }))
  return { boards, tasks }
}

/* ------------------------------------------------------------------- AI */

export type TaskDraft = { title: string; details: string; weight: number }

export type DraftResult = {
  result: 'ok' | 'failed'
  tasks?: TaskDraft[]
  note?: string
  message?: string
}

/**
 * Asks the server to draft a task list from the project. Nothing is saved: the
 * caller picks what to keep and edits it first.
 */
export async function generateTasks(projectId: string, boardId: string | null) {
  const { data, error } = await supabase.functions.invoke('generate-tasks', {
    body: { project_id: projectId, board_id: boardId },
  })
  if (error) throw error
  return data as DraftResult
}

/* ------------------------------------------------------------- realtime */

/** Same shape as subscribeToConversation — one channel, unique topic. */
export function subscribeToBoard(boardId: string, onChange: () => void) {
  const topic = `board:${boardId}:${Math.random().toString(36).slice(2)}`

  let channel = supabase.channel(topic)
  for (const table of ['project_tasks', 'task_assignees']) {
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        // Only project_tasks carries the board id; assignees are reached
        // through it, and RLS already limits them to this viewer.
        ...(table === 'project_tasks' ? { filter: `board_id=eq.${boardId}` } : {}),
      },
      onChange,
    )
  }

  channel.subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[collabify] realtime ${status} on ${topic}`, err?.message ?? '')
    }
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}

/**
 * The group's own word that the project is finished, and taking it back.
 * Freezes every task on the board without touching the conversation on them.
 */
export async function setBoardSubmitted(boardId: string, submitted: boolean) {
  const { error } = await supabase.rpc('set_board_submitted', {
    p_board: boardId,
    p_submitted: submitted,
  })
  if (error) throw error
}
