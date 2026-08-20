import { supabase } from '../supabase'
import type { ProfessorAccount } from '../types'

/**
 * Faculty accounts and their standing.
 *
 * RLS decides the audience, not this file: `profiles_select_own` opens the whole
 * table to a superadmin and to nobody else who is not in the same class, so a
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

/** Approve a waiting professor, or turn one down. Reversible either way. */
export async function decideProfessor(userId: string, approve: boolean) {
  const { error } = await supabase.rpc('decide_professor', {
    p_user: userId,
    p_approve: approve,
  })
  if (error) throw error
}
