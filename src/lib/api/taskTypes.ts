// src/lib/api/taskTypes.ts
/** Saving a project's task types and counting their tasks (supabase/task-type-looks.sql). */
import { supabase } from '../supabase'
import type { TaskTypeDraft, TypeFamily } from '../taskTypes/typeSet'

/**
 * Saves the whole ordered set. `shown` is the task_type_set_shown the editor loaded; a save made
 * from an out-of-date list is refused (see isStaleTypes). A null preset keeps the stored one.
 */
export async function saveTaskTypes(
  family: TypeFamily,
  projectId: string,
  types: TaskTypeDraft[],
  shown: string,
  preset: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc(family === 'work' ? 'save_general_task_types' : 'save_class_task_types', {
    p_project: projectId,
    p_types: types,
    p_shown: shown,
    p_preset: preset,
  })
  if (error) throw error
}

/** Live tasks per custom type name, for the delete and preset confirmations. */
export async function taskTypeCounts(family: TypeFamily, projectId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc(family === 'work' ? 'general_task_type_counts' : 'class_task_type_counts', {
    p_project: projectId,
  })
  if (error) throw error
  return new Map(((data ?? []) as { name: string; tasks: number }[]).map((row) => [row.name, row.tasks]))
}

export const STALE_TYPES = 'Someone changed these task types'

export const isStaleTypes = (err: unknown): boolean =>
  typeof (err as { message?: unknown } | null)?.message === 'string' && (err as { message: string }).message.startsWith(STALE_TYPES)
