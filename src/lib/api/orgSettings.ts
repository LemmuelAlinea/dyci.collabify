import { supabase } from '../supabase'

export type OrgSettings = {
  quiet_days: number
  trash_retention_days: number
  new_project_visibility: 'private' | 'workspace'
  school_email_domain: string
}

const COLUMNS = 'quiet_days, trash_retention_days, new_project_visibility, school_email_domain'

/** The one row every signed-in account reads. */
export async function getOrganizationSettings() {
  const { data, error } = await supabase.from('organization_settings').select(COLUMNS).single()
  if (error) throw error
  return data as OrgSettings
}

/**
 * Saves the four values. The database leaves a null alone, so the page sends only what changed
 * and a second admin's edit to another value is never overwritten.
 */
export async function setOrganizationSettings(next: Partial<OrgSettings>) {
  const { data, error } = await supabase.rpc('set_organization_settings', {
    p_quiet_days: next.quiet_days ?? null,
    p_trash_retention_days: next.trash_retention_days ?? null,
    p_new_project_visibility: next.new_project_visibility ?? null,
    p_school_email_domain: next.school_email_domain ?? null,
  })
  if (error) throw error
  return data as OrgSettings
}

/** An upper bound on the trashed items past the limit if the trash kept items for `days`. */
export async function trashPurgePreview(days: number) {
  const { data, error } = await supabase.rpc('admin_trash_purge_preview', { p_days: days })
  if (error) throw error
  return data as number
}
