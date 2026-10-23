/**
 * Who may do what, as the screens need to know it.
 *
 * The database decides; these only keep a screen from offering what it would
 * refuse. Each mirrors a function in supabase/access.sql of the same meaning.
 */
import type { GeneralProjectSummary, GeneralSpaceSummary } from './general/types'
import type { Profile, Role } from './types'

export type AccessProfile =
  | Pick<Profile, 'role' | 'status' | 'can_teach' | 'can_manage_projects'>
  | null
  | undefined
export type HomeProfile = Pick<Profile, 'role' | 'status'> | null | undefined

export function isMemberRole(role: Role | null | undefined): boolean {
  return role === 'member'
}

/** Approved members, who work in the company. Never the admin. */
export function isMember(p: AccessProfile): boolean {
  return Boolean(p && p.status === 'active' && isMemberRole(p.role))
}

/** Members the admin lets open classes. Mirrors `is_teaching_faculty`. */
export function canTeach(p: AccessProfile): boolean {
  return Boolean(isMember(p) && p?.can_teach)
}

/**
 * Who opens the teaching pages (/teaching/*): members who can teach, and the
 * admin, who reads them across the program without teaching.
 */
export function opensTeaching(p: AccessProfile): boolean {
  return canTeach(p) || Boolean(p && p.status === 'active' && p.role === 'admin')
}

/**
 * Members and admins the admin lets create and run projects. Mirrors
 * `is_project_manager`.
 */
export function canManageProjects(p: AccessProfile): boolean {
  if (!p || p.status !== 'active') return false
  if (!isMemberRole(p.role) && p.role !== 'admin') return false
  return p.can_manage_projects
}

/**
 * Who gets Join with a code on the Spaces page. Creating a space stays with
 * `canManageProjects` — it always makes a work space — but a teacher without
 * the switch may still join one somebody shared a code for.
 */
export function joinsSpaces(p: AccessProfile): boolean {
  return canManageProjects(p) || canTeach(p)
}

/** Whether this account sits in any class, whatever its role there. */
export function inAnyClass(spaces: Pick<GeneralSpaceSummary, 'kind' | 'my_level'>[] | null): boolean {
  return Boolean(spaces?.some((s) => s.kind === 'education' && s.my_level))
}

/** What the account belongs to, which decides how much of the rail an admin gets. */
export type Membership = {
  inClass: boolean
  hasWork: boolean
  /** An invitation is waiting for an answer. Filled in by the rail, which counts them. */
  invited?: boolean
}

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
 * or project somebody invited them into. Members and admins always may have
 * work, so for them it waits on a class. Still loading counts as no, so the
 * filter does not flash.
 */
export function showsClassScope(p: AccessProfile, membership: Membership | undefined): boolean {
  if (!membership) return false
  if (p?.role === 'student') return membership.hasWork
  return (isMember(p) || p?.role === 'admin') && membership.inClass
}

/** Where an admitted account lands. */
export function homeFor(profile: HomeProfile): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return '/home'
}
