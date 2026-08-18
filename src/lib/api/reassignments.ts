import { supabase } from '../supabase'
import type { ReassignmentOutcome, ReassignmentRow } from '../types'

/**
 * Asking for a task to change hands, and the professor's answer.
 *
 * Nothing here sets a status. The request is pinned to pending by a trigger
 * whatever the client sends, and only the two database functions below move it
 * on — an update policy wide enough to let a student withdraw their own would
 * also be wide enough to let them approve it.
 */

/** Every request the viewer may read: their own, or all of theirs if professor. */
export async function listReassignments() {
  const { data, error } = await supabase
    .from('reassignment_overview')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ReassignmentRow[]
}

/** The live request on one task, when there is one. */
export async function pendingReassignment(taskId: string) {
  const { data, error } = await supabase
    .from('reassignment_overview')
    .select('*')
    .eq('task_id', taskId)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw error
  return (data as ReassignmentRow | null) ?? null
}

export async function requestReassignment(input: {
  taskId: string
  wants: ReassignmentOutcome
  reason: string
}) {
  const { error } = await supabase.from('task_reassignments').insert({
    task_id: input.taskId,
    wants: input.wants,
    reason: input.reason.trim(),
  })
  if (error) throw error
}

export async function withdrawReassignment(id: string) {
  const { error } = await supabase.rpc('withdraw_reassignment', { p_request: id })
  if (error) throw error
}

/**
 * The professor's answer. `toStudent` overrides what was asked for — approving a
 * request to take something on while handing it to somebody else entirely.
 */
export async function decideReassignment(input: {
  id: string
  approve: boolean
  toStudent?: string | null
  note?: string
}) {
  const { error } = await supabase.rpc('decide_reassignment', {
    p_request: input.id,
    p_approve: input.approve,
    p_to_student: input.toStudent ?? null,
    p_note: input.note?.trim() ?? '',
  })
  if (error) throw error
}
