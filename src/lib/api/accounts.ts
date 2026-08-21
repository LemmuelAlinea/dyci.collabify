import { supabase } from '../supabase'
import type { Account, Role } from '../types'

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
 * Move somebody between student and professor. Promotion lands them pending —
 * a promotion is not a verification, so they still go through approval.
 */
export async function setAccountRole(userId: string, role: Exclude<Role, 'admin'>) {
  const { error } = await supabase.rpc('set_account_role', {
    p_user: userId,
    p_role: role,
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
