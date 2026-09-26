import { supabase } from '../supabase'
import type { ProgramClass } from '../program'
import type { ProfessorAccount } from '../types'

/**
 * Faculty accounts and their standing.
 *
 * RLS decides the audience, not this file: `profiles_select_own` opens the whole
 * table to an admin and to nobody else who is not in the same class, so a
 * professor calling this reads only themselves.
 */
export async function listProfessorAccounts() {
  const { data, error } = await supabase
    .from('professor_accounts')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProfessorAccount[]
}

/**
 * Approve a waiting faculty account, or turn one down. Reversible either way.
 * `canTeach` is sent only on an approval; leaving it out keeps what is set.
 */
export async function decideFaculty(userId: string, approve: boolean, canTeach?: boolean) {
  const { error } = await supabase.rpc('decide_faculty', {
    p_user: userId,
    p_approve: approve,
    p_can_teach: canTeach ?? null,
  })
  if (error) throw error
}

/** Let an approved faculty account open classes, or stop it. */
export async function setFacultyTeaching(userId: string, canTeach: boolean) {
  const { error } = await supabase.rpc('set_faculty_teaching', {
    p_user: userId,
    p_can_teach: canTeach,
  })
  if (error) throw error
}

/**
 * Every class in the program, as figures.
 *
 * `admin_class_overview` is gated on `is_admin()` in the database, so a
 * professor or student calling this reads an empty list rather than an error.
 */
export async function programClasses() {
  const { data, error } = await supabase
    .from('admin_class_overview')
    .select('*')
    .order('year_level')
    .order('class_name')
  if (error) throw error
  return (data ?? []) as ProgramClass[]
}
