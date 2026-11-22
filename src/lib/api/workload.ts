import { supabase } from '../supabase'

/** Sets or clears a work task's estimate, in minutes. Planners and holders only. */
export async function setTaskEstimate(taskId: string, minutes: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_work_task_estimate', { p_task: taskId, p_minutes: minutes })
  if (error) throw error
}
