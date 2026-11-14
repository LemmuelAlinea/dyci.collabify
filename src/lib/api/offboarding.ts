import { supabase } from '../supabase'
import type { OffboardLine } from '../offboarding'

export async function offboardingPreview(userId: string) {
  const { data, error } = await supabase.rpc('admin_offboarding_preview', { p_user: userId })
  if (error) throw error
  return (data ?? []) as OffboardLine[]
}

export async function offboardMember(userId: string, successorId: string, overrides: Record<string, string>) {
  const { error } = await supabase.rpc('admin_offboard_member', {
    p_user: userId,
    p_successor: successorId,
    p_overrides: overrides,
  })
  if (error) throw error
}

export async function assignSpacePm(spaceId: string, userId: string) {
  const { error } = await supabase.rpc('admin_assign_space_pm', { p_space: spaceId, p_user: userId })
  if (error) throw error
}

export async function spacesWithoutPm() {
  const { data, error } = await supabase.rpc('admin_spaces_without_pm')
  if (error) throw error
  return (data ?? []) as { space_id: string; space_name: string; office_name: string }[]
}

export async function projectOffices() {
  const { data, error } = await supabase.rpc('admin_project_offices')
  if (error) throw error
  return (data ?? []) as { project_id: string; office_id: string | null; office_name: string }[]
}
