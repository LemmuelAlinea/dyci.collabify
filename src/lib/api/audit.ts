import { supabase } from '../supabase'
import type { AuditEvent } from '../types'

/**
 * The log. RLS keeps it to the admin, and there is no write path from a client
 * at all — the entries come from database triggers.
 */
export async function listAuditEvents(limit = 200) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as AuditEvent[]
}
