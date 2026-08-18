import { supabase } from '../supabase'
import type { TaskComment, TaskDetail, TaskEvent, TaskFile, WorkLogEntry } from '../types'

const PROFILE_COLS = 'id, first_name, middle_name, last_name, avatar_url'

/* ---------------------------------------------------------------- the task */

export async function getTaskDetail(taskId: string) {
  const { data, error } = await supabase
    .from('task_detail_overview')
    .select('*')
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const task = data as TaskDetail
  const { data: rows, error: aErr } = await supabase
    .from('task_assignees')
    .select(
      `task_id, student_id, claimed_by, claimed_at, profile:profiles!task_assignees_student_id_fkey (${PROFILE_COLS})`,
    )
    .eq('task_id', taskId)
  if (aErr) throw aErr

  return { ...task, assignees: (rows ?? []) as unknown as TaskDetail['assignees'] }
}

/* ---------------------------------------------------------------- comments */

export async function listComments(taskId: string) {
  const { data, error } = await supabase
    .from('task_comments')
    .select(
      `id, task_id, author_id, body, edited_at, created_at, author:profiles!task_comments_author_id_fkey (${PROFILE_COLS})`,
    )
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as TaskComment[]
}

export async function addComment(taskId: string, body: string, authorId: string) {
  const { data, error } = await supabase
    .from('task_comments')
    .insert({ task_id: taskId, body: body.trim(), author_id: authorId })
    .select('*')
    .single()
  if (error) throw error
  return data as TaskComment
}

export async function editComment(commentId: string, body: string) {
  const { error } = await supabase
    .from('task_comments')
    .update({ body: body.trim() })
    .eq('id', commentId)
  if (error) throw error
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.from('task_comments').delete().eq('id', commentId)
  if (error) throw error
}

/* ----------------------------------------------------------------- history */

export async function listEvents(taskId: string) {
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

/** The trail across a whole project, for the summary's activity feed. */
export async function listEventsForTasks(taskIds: string[], limit = 20) {
  if (taskIds.length === 0) return []
  const { data, error } = await supabase
    .from('task_events')
    .select(
      `id, task_id, actor_id, kind, detail, at, actor:profiles!task_events_actor_id_fkey (first_name, last_name, avatar_url)`,
    )
    .in('task_id', taskIds)
    .order('at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as TaskEvent[]
}

/* ------------------------------------------------------------------ files */

const BUCKET = 'task-files'

export async function listFiles(taskId: string) {
  const { data, error } = await supabase
    .from('task_files')
    .select(
      `id, task_id, uploaded_by, file_path, file_name, mime_type, size_bytes, created_at, uploader:profiles!task_files_uploaded_by_fkey (${PROFILE_COLS})`,
    )
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as TaskFile[]
}

export async function uploadTaskFile(taskId: string, file: File) {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  // The storage policy reads the task id off the first path segment.
  const path = `${taskId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('task_files')
    .insert({
      task_id: taskId,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select('*')
    .single()

  if (error) {
    // Do not leave an orphan object behind if the row is rejected.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data as TaskFile
}

export async function deleteTaskFile(file: TaskFile) {
  const { error } = await supabase.from('task_files').delete().eq('id', file.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([file.file_path])
}

/** The bucket is private, so viewing goes through a short-lived signed URL. */
export async function taskFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

/* ---------------------------------------------------------------- worklog */

export async function listWorkLog(taskId: string) {
  const { data, error } = await supabase
    .from('task_worklog')
    .select(
      `id, task_id, student_id, minutes, note, worked_on, created_at, student:profiles!task_worklog_student_id_fkey (${PROFILE_COLS})`,
    )
    .eq('task_id', taskId)
    .order('worked_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as WorkLogEntry[]
}

export async function logTime(input: {
  taskId: string
  studentId: string
  minutes: number
  note: string
  workedOn: string
}) {
  const { error } = await supabase.from('task_worklog').insert({
    task_id: input.taskId,
    student_id: input.studentId,
    minutes: input.minutes,
    note: input.note.trim(),
    worked_on: input.workedOn,
  })
  if (error) throw error
}

export async function deleteWorkLog(entryId: string) {
  const { error } = await supabase.from('task_worklog').delete().eq('id', entryId)
  if (error) throw error
}

/* ---------------------------------------------------------------- realtime */

/** Comments and files land without a refresh, same shape as the message thread. */
export function subscribeToTask(taskId: string, onChange: () => void) {
  const topic = `task:${taskId}:${Math.random().toString(36).slice(2)}`

  let channel = supabase.channel(topic)
  for (const table of ['task_comments', 'task_files', 'project_tasks']) {
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: table === 'project_tasks' ? `id=eq.${taskId}` : `task_id=eq.${taskId}`,
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
