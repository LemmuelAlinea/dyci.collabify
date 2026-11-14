import { supabase } from '../supabase'
import type {
  HeadedOffice,
  OfficeAttention,
  OfficeHead,
  OfficeOverview,
  OfficePersonRow,
  OfficeSpaceRow,
} from '../officeHeads'

export async function setOfficeHead(officeId: string, userId: string | null) {
  const { error } = await supabase.rpc('set_office_head', { p_office: officeId, p_user: userId })
  if (error) throw error
}

export async function adminOfficeHeads() {
  const { data, error } = await supabase.rpc('admin_office_heads')
  if (error) throw error
  return (data ?? []) as OfficeHead[]
}

/** The office the caller heads, or null when they head none. */
export async function myHeadedOffice() {
  const { data, error } = await supabase.rpc('my_headed_office')
  if (error) throw error
  return ((data ?? []) as HeadedOffice[])[0] ?? null
}

export async function myOfficeOverview() {
  const { data, error } = await supabase.rpc('my_office_overview')
  if (error) throw error
  return ((data ?? []) as OfficeOverview[])[0] ?? null
}

export async function myOfficeAttention() {
  const { data, error } = await supabase.rpc('my_office_attention')
  if (error) throw error
  return (data ?? []) as OfficeAttention[]
}

export async function myOfficeSpaces() {
  const { data, error } = await supabase.rpc('my_office_spaces')
  if (error) throw error
  return (data ?? []) as OfficeSpaceRow[]
}

export async function myOfficePeople() {
  const { data, error } = await supabase.rpc('my_office_people')
  if (error) throw error
  return (data ?? []) as OfficePersonRow[]
}
