import { supabase } from '../supabase'
import type { Account } from '../types'

/**
 * Every account, for the admin. RLS decides the audience — `profiles_select_own`
 * opens the table to an admin and to nobody else outside their own classes.
 */
export async function listAccounts() {
  const { data, error } = await supabase
    .from('account_overview')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Account[]
}

/**
 * Move somebody between student and member. A member starts with both switches
 * off; the admin turns them on one at a time.
 */
export async function setAccountRole(userId: string, role: 'student' | 'member') {
  const { error } = await supabase.rpc('set_account_role', {
    p_user: userId,
    p_role: role,
  })
  if (error) throw error
}

/** Let a member or an admin create and run projects, or stop it. */
export async function setProjectManager(userId: string, on: boolean) {
  const { error } = await supabase.rpc('set_project_manager', {
    p_user: userId,
    p_on: on,
  })
  if (error) throw error
}

/** Offboarding, and undoing it. There is deliberately no delete. */
export async function setAccountActive(userId: string, active: boolean) {
  const { error } = await supabase.rpc('set_account_active', {
    p_user: userId,
    p_active: active,
  })
  if (error) throw error
}
