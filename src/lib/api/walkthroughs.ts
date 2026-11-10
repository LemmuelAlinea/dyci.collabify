import { supabase } from '../supabase'

/**
 * Reading and writing first-run walkthrough progress.
 *
 * One row per person and flow, in `user_walkthroughs` (see `supabase/walkthroughs.sql`).
 * Row-level security limits every read and write to the signed-in person, and the
 * database keeps a skipped or done row from going back to active.
 */

export type ProgressKey = 'account' | 'teaching' | 'project_manager' | 'student' | 'member'
export type FlowStatus = 'active' | 'paused' | 'skipped' | 'done'
export type ProgressRow = { flow: ProgressKey; status: FlowStatus; done_steps: string[] }

/** The signed-in person's saved progress, one row per flow they have started. */
export async function listMyWalkthroughs(): Promise<ProgressRow[]> {
  const { data, error } = await supabase
    .from('user_walkthroughs')
    .select('flow, status, done_steps')
  if (error) throw error
  return (data ?? []) as ProgressRow[]
}

/** Saves progress for the given flows in one upsert. An empty list does nothing. */
export async function saveWalkthroughs(userId: string, rows: ProgressRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('user_walkthroughs')
    .upsert(
      rows.map((row) => ({ ...row, user_id: userId })),
      { onConflict: 'user_id,flow' },
    )
  if (error) throw error
}
