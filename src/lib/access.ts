/**
 * Who may do what, as the screens need to know it.
 *
 * The database decides; these only keep a screen from offering what it would
 * refuse. Each mirrors a function in supabase/access.sql of the same meaning.
 */
import type { GeneralProjectSummary, GeneralSpaceSummary } from './general/types'
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

/** What the account belongs to, which decides how much of the rail an admin gets. */
export type Membership = { inClass: boolean; hasWork: boolean }

/** Undefined while either list is still loading. */
export function membershipOf(
  spaces: GeneralSpaceSummary[] | null,
  projects: GeneralProjectSummary[] | null,
): Membership | undefined {
  if (spaces === null || projects === null) return undefined
  return {
    inClass: inAnyClass(spaces),
    hasWork:
      spaces.some((s) => s.kind === 'work' && s.my_level && !s.archived_at) ||
      projects.some((p) => p.my_level && !p.archived_at),
  }
}

/**
 * Whether a page offers the Classes · Work split — only to someone who has
 * both. Students always have classes, so for them it waits on work: a space
 * or project somebody invited them into. Faculty and admins always may have
 * work, so for them it waits on a class. Still loading counts as no, so the
 * filter does not flash.
 */
export function showsClassScope(p: AccessProfile, membership: Membership | undefined): boolean {
  if (!membership) return false
  if (p?.role === 'student') return membership.hasWork
  return (p?.role === 'faculty' || p?.role === 'admin') && membership.inClass
}

/** Where an admitted account lands. */
export function homeFor(profile: HomeProfile): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return '/home'
}
