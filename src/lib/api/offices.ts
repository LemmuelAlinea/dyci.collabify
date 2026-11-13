import { supabase } from '../supabase'
import type {
  AttentionProject,
  Office,
  OfficeOverviewRow,
  OfficePerson,
  OfficeSpace,
  OrgSummary,
} from '../offices'

/** Every office, archived ones included. */
export async function listOffices() {
  const { data, error } = await supabase
    .from('offices')
    .select('id, name, description, archived_at')
    .order('name')
  if (error) throw error
  return (data ?? []) as Office[]
}

export async function createOffice(name: string, description: string) {
  const { data, error } = await supabase.rpc('create_office', {
    p_name: name,
    p_description: description,
  })
  if (error) throw error
  return data as Office
}

export async function renameOffice(id: string, name: string, description: string) {
  const { error } = await supabase.rpc('rename_office', {
    p_office: id,
    p_name: name,
    p_description: description,
  })
  if (error) throw error
}

export async function archiveOffice(id: string) {
  const { error } = await supabase.rpc('archive_office', { p_office: id })
  if (error) throw error
}

export async function restoreOffice(id: string) {
  const { error } = await supabase.rpc('restore_office', { p_office: id })
  if (error) throw error
}

export async function deleteOffice(id: string) {
  const { error } = await supabase.rpc('delete_office', { p_office: id })
  if (error) throw error
}

export async function setMemberOffice(userId: string, officeId: string | null) {
  const { error } = await supabase.rpc('set_member_office', {
    p_user: userId,
    p_office: officeId,
  })
  if (error) throw error
}

export async function setSpaceOffice(spaceId: string, officeId: string | null) {
  const { error } = await supabase.rpc('set_space_office', {
    p_space: spaceId,
    p_office: officeId,
  })
  if (error) throw error
}

export async function listOfficePeople() {
  const { data, error } = await supabase.rpc('admin_office_people')
  if (error) throw error
  return (data ?? []) as OfficePerson[]
}

export async function listOfficeSpaces() {
  const { data, error } = await supabase.rpc('admin_office_spaces')
  if (error) throw error
  return (data ?? []) as OfficeSpace[]
}

export async function orgOverview() {
  const { data, error } = await supabase.rpc('admin_org_overview')
  if (error) throw error
  return (data ?? []) as OfficeOverviewRow[]
}

export async function attentionProjects() {
  const { data, error } = await supabase.rpc('admin_attention_projects')
  if (error) throw error
  return (data ?? []) as AttentionProject[]
}

/** One row of counts; zeros when the read returns none. */
export async function orgSummary() {
  const { data, error } = await supabase.rpc('admin_org_summary')
  if (error) throw error
  const row = (data ?? [])[0] as OrgSummary | undefined
  return row ?? { accounts_in_setup: 0, privacy_due: 0 }
}
