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
  | 'people'
  | 'syllabus'
  | 'reports'
  | 'settings'

const SHARED: ClassTab[] = ['overview', 'projects', 'people', 'syllabus']
// A teacher's people live in Settings; Reports sits ahead of Syllabus and Settings.
const TEACHING: ClassTab[] = ['overview', 'projects', 'reports', 'syllabus', 'settings']

/** A teacher's class Settings, one section at a time. */
export type ClassSettingsSection = 'general' | 'members' | 'groups'

/** The open Settings section; General unless `?section=` names another. */
export function readClassSettingsSection(value: string | null): ClassSettingsSection {
  return value === 'members' || value === 'groups' ? value : 'general'
}

/**
 * The Settings section a teacher's address opens: `?section=`, or, for an old
 * People, Groups or Members link, the section that holds it now.
 */
export function teacherSettingsSection(
  tab: string | null,
  view: string | null,
  section: string | null,
): ClassSettingsSection {
  if (tab === 'groups' || (tab === 'people' && view === 'groups')) return 'groups'
  if (tab === 'people' || tab === 'members') return 'members'
  return readClassSettingsSection(section)
}

/** People holds the class's students and its groups, one at a time. */
export type PeopleView = 'students' | 'groups'

/** Groups and Members were two tabs before People held both; old links still name them. */
const PEOPLE_TABS = new Set(['groups', 'members'])

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
  // A teacher's people moved into Settings; a student's stay on People.
  if (value && (PEOPLE_TABS.has(value) || value === 'people')) return teaching ? 'settings' : 'people'
  const tabs = classTabs(teaching)
  const tab = (teaching && value && RETIRED.get(value)) || value
  return tabs.includes(tab as ClassTab) ? (tab as ClassTab) : 'overview'
}

/**
 * Which half of People is open: `?view=groups`, or an old Groups link, opens
 * the groups; everything else the students.
 */
export function readPeopleView(tab: string | null, view: string | null): PeopleView {
  return tab === 'groups' || view === 'groups' ? 'groups' : 'students'
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
 * only class's Settings → Groups, or the Classes page to pick one.
 */
export function groupsHomeFor(classIds: string[]): string {
  return classIds.length === 1 ? classGroupsPath(classIds[0]) : paths.classes
}

/** A teacher's way to a class's groups: Settings → Groups. */
export function classGroupsPath(classId: string): string {
  return `${paths.class(classId)}?tab=settings&section=groups`
}

/** A teacher's way to a class's roster: Settings → Members. */
export function classStudentsPath(classId: string): string {
  return `${paths.class(classId)}?tab=settings&section=members`
}
