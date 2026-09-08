import { CONSENT_ITEMS } from '../legal'
import { supabase } from '../supabase'

/**
 * Reading and writing consent records.
 *
 * Three write paths exist and only two of them are here. The email signup path
 * writes its consent inside `handle_new_user()` in the database, because at the
 * moment the box is ticked there is no session and no row-level-security
 * identity to insert with — see `supabase/consent.sql`. This module covers the
 * other two: the Google path, where the box is ticked at onboarding with a
 * session in hand, and re-consent when a material version lands.
 */

export type ConsentRecord = {
  id: string
  document: 'privacy' | 'terms'
  version: string
  granted_at: string
  withdrawn_at: string | null
  surface: string
}

/** What the signed-in person has agreed to, newest first. */
export async function listMyConsent(): Promise<ConsentRecord[]> {
  const { data, error } = await supabase
    .from('consent_records')
    .select('id, document, version, granted_at, withdrawn_at, surface')
    .order('granted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ConsentRecord[]
}

/**
 * Record agreement to every current document, for a session that has one.
 *
 * Both rows go through the same call so a half-written consent — terms yes,
 * privacy silently missing — cannot be the result of one request failing. The
 * RPC is idempotent per version, so a retry after a dropped connection costs
 * nothing.
 */
export async function recordAllConsent(surface: 'onboarding' | 're-consent'): Promise<void> {
  for (const item of CONSENT_ITEMS) {
    const { error } = await supabase.rpc('record_consent', {
      p_document: item.document,
      p_version: item.version,
      p_surface: surface,
    })
    if (error) throw error
  }
}

/**
 * Which of the current documents this person has not yet agreed to.
 *
 * The re-consent gate reads this. A withdrawn row does not count as agreement,
 * which is what makes withdrawal mean anything.
 */
export async function outstandingConsent(): Promise<typeof CONSENT_ITEMS> {
  const held = await listMyConsent()
  return CONSENT_ITEMS.filter(
    (item) =>
      !held.some(
        (row) =>
          row.document === item.document && row.version === item.version && !row.withdrawn_at,
      ),
  )
}
