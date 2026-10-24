import { supabase } from '../supabase'
import type { QaQueueRow } from '../work/qa'

/** QA or the project manager passes a task that is waiting in the QA stage. */
export async function passTask(taskId: string) {
  const { error } = await supabase.rpc('qa_pass_general_task', { p_task: taskId })
  if (error) throw error
}

/** Sends a task back to the stage before QA with a note for whoever holds it. */
export async function sendBackTask(taskId: string, note: string) {
  const { error } = await supabase.rpc('qa_send_back_general_task', { p_task: taskId, p_note: note.trim() })
  if (error) throw error
}

/** The caller's live work projects where they are QA, with what waits in each. */
export async function listMyQaQueue() {
  const { data, error } = await supabase.rpc('my_qa_queue')
  if (error) throw error
  return ((data ?? []) as QaQueueRow[]).map((r) => ({ ...r, waiting: Number(r.waiting) }))
}
