import type { GeneralLevel } from './general/permissions'
import type { Role } from './types'

/**
 * The classes somebody teaches: the ones they own, and the ones whose space
 * holds them at Owner or Manager (co-teaching). As a PostgREST `or` filter,
 * or null when they hold no seat and professor_id alone answers it.
 *
 * Ids come from the database, never from input, so they need no escaping.
 */
export function teachingClassFilter(userId: string, spaceIds: string[]): string | null {
  if (spaceIds.length === 0) return null
  return `professor_id.eq.${userId},space_id.in.(${spaceIds.join(',')})`
}

export type ClassTab =
  | 'overview'
  | 'projects'
  | 'groups'
  | 'members'
  | 'syllabus'
  | 'submissions'
  | 'analytics'
  | 'reports'
  | 'settings'

const SHARED: ClassTab[] = ['overview', 'projects', 'groups', 'members', 'syllabus']
const TEACHING: ClassTab[] = ['submissions', 'analytics', 'reports', 'settings']

/**
 * Whether this viewer teaches the class: its professor, or faculty holding
 * Owner or Manager in its space. The same rule as is_class_professor, so the
 * page never offers a tool the database would then refuse.
 */
export function teachesClass(
  viewer: { id: string; role: Role | null } | null,
  professorId: string,
  myLevel: GeneralLevel | null,
): boolean {
  if (!viewer || viewer.role !== 'faculty') return false
  return viewer.id === professorId || myLevel === 'owner' || myLevel === 'manager'
}

export function classTabs(teaching: boolean): ClassTab[] {
  return teaching ? [...SHARED, ...TEACHING] : [...SHARED]
}

/**
 * Whether the page knows enough to pick student or teaching tabs. A student's
 * seat is never in question, and neither is the class professor's — everyone
 * else's teaching seat lives in the space list, so it isn't known until that
 * has loaded at least once.
 */
export function seatKnown(
  role: Role | null | undefined,
  viewerId: string | undefined,
  professorId: string,
  spacesLoaded: boolean,
): boolean {
  return role === 'student' || viewerId === professorId || spacesLoaded
}

/** The `?tab=` value, if the viewer has that tab; Overview otherwise. */
export function readClassTab(value: string | null, teaching: boolean): ClassTab {
  const tabs = classTabs(teaching)
  return tabs.includes(value as ClassTab) ? (value as ClassTab) : 'overview'
}
