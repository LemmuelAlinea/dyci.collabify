import { supabase } from '../supabase'
import type { ClassGap, ClassHealth, ClassPace, MemberLoad } from '../types'

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
