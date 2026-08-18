import { supabase } from '../supabase'
import type { TaskComment, TaskDetail, TaskEvent } from '../types'

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
