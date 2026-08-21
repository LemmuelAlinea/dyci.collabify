import { supabase } from '../supabase'
import type {
  BoardBurn,
  ClassGap,
  ClassHealth,
  ClassPace,
  ClassUnmeasured,
  MemberLoad,
  TaskState,
} from '../types'

/**
 * Everything the analytics page reads. Each view is scoped to the class's own
 * professor in the database, so nothing here filters by class or by role — an
 * unfiltered select already returns only what the caller owns.
 */
export async function classPace() {
  const { data, error } = await supabase.from('class_pace').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassPace[]
}

/**
 * The classes the pace figure cannot speak for. Read alongside `classPace` so
 * a class missing its term dates or its syllabus says so instead of vanishing.
 */
export async function classesUnmeasured() {
  const { data, error } = await supabase.from('class_unmeasured').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassUnmeasured[]
}

export async function classGaps() {
  const { data, error } = await supabase.from('class_gaps').select('*').order('week_no')
  if (error) throw error
  return (data ?? []) as ClassGap[]
}

export async function classHealth() {
  const { data, error } = await supabase.from('class_health').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassHealth[]
}

export async function memberLoad() {
  const { data, error } = await supabase.from('class_member_load').select('*')
  if (error) throw error
  return (data ?? []) as MemberLoad[]
}

/** Board-level burn: the projection one level below the syllabus. */
export async function boardBurn() {
  const { data, error } = await supabase.from('board_burn').select('*')
  if (error) throw error
  return (data ?? []) as BoardBurn[]
}

/** The leaf of the filter chain. */
export async function taskStates() {
  const { data, error } = await supabase.from('task_state').select('*').order('due_at', {
    nullsFirst: false,
  })
  if (error) throw error
  return (data ?? []) as TaskState[]
}
