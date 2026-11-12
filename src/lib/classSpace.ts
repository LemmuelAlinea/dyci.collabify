import type { GeneralLevel } from './general/permissions'
import { isMemberRole } from './access'
import { paths } from './paths'
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
  | 'reports'
  | 'settings'

const SHARED: ClassTab[] = ['overview', 'projects', 'groups', 'members', 'syllabus']
// Teaching puts Reports beside Students, ahead of Syllabus and Settings.
const TEACHING: ClassTab[] = ['overview', 'projects', 'groups', 'members', 'reports', 'syllabus', 'settings']

/**
 * Tabs a class page used to have, and where they live now: hand-ins moved to
 * Overview (and Waiting on you), figures into Reports.
 */
const RETIRED = new Map<string, ClassTab>([
  ['submissions', 'overview'],
  ['analytics', 'reports'],
])

/**
 * Whether this viewer teaches the class: its professor, or a member with Can
 * teach holding Owner or Manager in its space. The same rule as
 * is_class_professor (with teaches_in_space), so the page never offers a tool
 * the database would then refuse.
 */
export function teachesClass(
  viewer: { id: string; role: Role | null; can_teach: boolean } | null,
  professorId: string,
  myLevel: GeneralLevel | null,
): boolean {
  if (!viewer || !isMemberRole(viewer.role)) return false
  if (viewer.id === professorId) return true
  return viewer.can_teach && (myLevel === 'owner' || myLevel === 'manager')
}

export function classTabs(teaching: boolean): ClassTab[] {
  return teaching ? [...TEACHING] : [...SHARED]
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

/**
 * The `?tab=` value, if the viewer has that tab; Overview otherwise. A
 * teacher's old Submissions and Analytics tabs land where their content went.
 */
export function readClassTab(value: string | null, teaching: boolean): ClassTab {
  const tabs = classTabs(teaching)
  const tab = (teaching && value && RETIRED.get(value)) || value
  return tabs.includes(tab as ClassTab) ? (tab as ClassTab) : 'overview'
}

/**
 * An old `?tab=submissions&status=…` link a teacher follows: the status
 * filter now lives on Waiting on you. Null when the class page answers it.
 */
export function classTabRedirect(
  tab: string | null,
  status: string | null,
  teaching: boolean,
): string | null {
  if (!teaching || tab !== 'submissions' || !status) return null
  return `${paths.waiting}?status=${encodeURIComponent(status)}`
}

/** A class with nobody in it and nothing set: its Overview points to the next step. */
export function isEmptyClass(students: number, projects: number): boolean {
  return students === 0 && projects === 0
}

/**
 * Where `/groups` sends a teacher now that groups live in each class: the
 * only class's Groups tab, or the Classes page to pick one.
 */
export function groupsHomeFor(classIds: string[]): string {
  return classIds.length === 1 ? `${paths.class(classIds[0])}?tab=groups` : paths.classes
}
