import { supabase } from '../supabase'
import { byLastName } from '../types'
import type {
  BoardSummary,
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

/* ----------------------------------------------------------------- tasks */

export async function listTasks(boardId: string) {
  const { data, error } = await supabase
    .from('project_tasks')
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
    .select('*')
    .in('id', ids)
    .order('due_at', { nullsFirst: false })
  if (tErr) throw tErr
  return ((tasks ?? []) as ProjectTask[]).map((t) => ({ ...t, assignees: [] }))
}

export type TaskInput = {
  title: string
  details: string
  weight: number
  dueAt: string | null
}

export async function addTask(boardId: string, input: TaskInput, createdBy: string) {
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
