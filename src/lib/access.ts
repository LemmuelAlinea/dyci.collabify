/**
 * Who may do what, as the screens need to know it.
 *
 * The database decides; these only keep a screen from offering what it would
 * refuse. Each mirrors a function in supabase/access.sql of the same meaning.
 */
import type { GeneralSpaceSummary } from './general/types'
import type { Profile } from './types'

export type AccessProfile = Pick<Profile, 'role' | 'status' | 'can_teach'> | null | undefined
export type HomeProfile = Pick<Profile, 'role' | 'status'> | null | undefined

/** Approved faculty, and the admin. Mirrors `is_faculty`. */
export function isFaculty(p: AccessProfile): boolean {
  return Boolean(p && p.status === 'active' && (p.role === 'faculty' || p.role === 'admin'))
}

/** Faculty the admin lets open classes. Mirrors `is_teaching_faculty`. */
export function canTeach(p: AccessProfile): boolean {
  return Boolean(p && p.status === 'active' && p.role === 'faculty' && p.can_teach)
}

/** Whether this account sits in any class, whatever its role there. */
export function inAnyClass(spaces: Pick<GeneralSpaceSummary, 'kind' | 'my_level'>[] | null): boolean {
  return Boolean(spaces?.some((s) => s.kind === 'education' && s.my_level))
}

/**
 * Whether a page offers the Classes · Work split. Students always have
 * classes; faculty only once they are in one, teaching or not; admins never
 * are. Spaces still loading count as no class, so the filter does not flash.
 */
export function showsClassScope(
  p: AccessProfile,
  spaces: Pick<GeneralSpaceSummary, 'kind' | 'my_level'>[] | null,
): boolean {
  if (p?.role === 'student') return true
  return p?.role === 'faculty' && inAnyClass(spaces)
}

/** Where an admitted account lands. */
export function homeFor(profile: HomeProfile): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return '/home'
}
