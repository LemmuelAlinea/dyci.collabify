/**
 * The Archive page: what goes in it, and which of it a person sees.
 *
 * The database decides which rows come back and who may restore or trash each
 * (supabase/archive-page.sql). This decides which sections a person is shown
 * at all, from what they can do in the product: a section about classes means
 * nothing to faculty who do not teach, and work sections mean nothing to a
 * student nobody has invited to any work. A section shows whether or not it
 * has anything in it, so the page also says what can be archived and where.
 */
import { canTeach } from './access'
import type { AccessProfile, Membership } from './access'
import { paths } from './paths'

export type ArchiveKind =
  | 'class'
  | 'group'
  | 'class_project'
  | 'class_task'
  | 'class_file'
  | 'syllabus'
  | 'curriculum'
  | 'space'
  | 'team'
  | 'project'
  | 'work_task'
  | 'work_file'

export type ArchiveArea = 'classes' | 'work'

export type ArchiveSection = {
  kind: ArchiveKind
  area: ArchiveArea
  label: string
  /** One row, for counts and confirmations. */
  noun: string
  /** Where this kind is archived from, shown while the section is empty. */
  hint: string
}

/** In page order: widest to narrowest within each area. */
export const ARCHIVE_SECTIONS: ArchiveSection[] = [
  {
    kind: 'class',
    area: 'classes',
    label: 'Classes',
    noun: 'class',
    hint: 'Archive a class from its Settings tab when the term ends.',
  },
  {
    kind: 'group',
    area: 'classes',
    label: 'Groups',
    noun: 'group',
    hint: 'Archive a group from its page. Its members, board and chat stay whole.',
  },
  {
    kind: 'class_project',
    area: 'classes',
    label: 'Class projects',
    noun: 'class project',
    hint: 'Archive a class project from its manage row.',
  },
  {
    kind: 'class_task',
    area: 'classes',
    label: 'Class tasks',
    noun: 'class task',
    hint: 'Archive a task you added, or one you are on, from its card on the board.',
  },
  {
    kind: 'class_file',
    area: 'classes',
    label: 'Class project files',
    noun: 'file',
    hint: 'Archive a file from My draft on a class project’s Files tab.',
  },
  {
    kind: 'syllabus',
    area: 'classes',
    label: 'Syllabi',
    noun: 'syllabus',
    hint: 'Archive a syllabus from its menu on the Syllabi page.',
  },
  {
    kind: 'curriculum',
    area: 'classes',
    label: 'Curriculum',
    noun: 'curriculum',
    hint: 'Archive a curriculum from its menu on the Curriculum page.',
  },
  {
    kind: 'space',
    area: 'work',
    label: 'Spaces',
    noun: 'space',
    hint: 'An Owner archives a space from its Settings tab.',
  },
  {
    kind: 'team',
    area: 'work',
    label: 'Space teams',
    noun: 'team',
    hint: 'Archive a team from a space’s Teams tab.',
  },
  {
    kind: 'project',
    area: 'work',
    label: 'Work projects',
    noun: 'project',
    hint: 'An Owner archives a project from its banner.',
  },
  {
    kind: 'work_task',
    area: 'work',
    label: 'Work tasks',
    noun: 'task',
    hint: 'Archive a task from the top of its task dialog.',
  },
  {
    kind: 'work_file',
    area: 'work',
    label: 'Work files',
    noun: 'file',
    hint: 'Archive a task file from its menu, or a file in My draft on a project’s Files tab.',
  },
]

export const sectionOf = (kind: ArchiveKind) => ARCHIVE_SECTIONS.find((s) => s.kind === kind)!

/**
 * The sections a person can have anything in, in page order.
 *
 * - A student archives on class boards (tasks, their class project files);
 *   once somebody invites them to work, the work sections they can act on
 *   join: teams they run, projects, tasks and files. A student never owns a
 *   space, so Spaces is not theirs.
 * - Teaching faculty run classes, so every class section is theirs, plus all
 *   of work. Class project files are a student's draft, so not theirs.
 * - Faculty who do not teach — and an admin who reaches the page — have work
 *   only.
 *
 * `membership` still loading counts as no work, so work sections never flash
 * in for a student and then vanish.
 */
export function archiveKindsFor(profile: AccessProfile, membership: Membership | undefined): ArchiveKind[] {
  if (!profile || profile.status !== 'active' || !profile.role) return []
  const work: ArchiveKind[] = ['space', 'team', 'project', 'work_task', 'work_file']
  if (profile.role === 'student') {
    return ['class_task', 'class_file', ...(membership?.hasWork ? work.filter((k) => k !== 'space') : [])]
  }
  if (canTeach(profile)) {
    return ['class', 'group', 'class_project', 'class_task', 'syllabus', 'curriculum', ...work]
  }
  return work
}

/** The areas among those kinds, so the All · Classes · Work switch shows only with both. */
export function areasOf(kinds: ArchiveKind[]): ArchiveArea[] {
  return (['classes', 'work'] as const).filter((area) => kinds.some((k) => sectionOf(k).area === area))
}

export type ArchiveItem = {
  kind: ArchiveKind
  area: ArchiveArea
  id: string
  name: string
  detail: string | null
  /** For files: a file in somebody's own draft, or a file on a work task. */
  file_source: 'draft' | 'task' | null
  class_id: string | null
  class_name: string | null
  space_id: string | null
  space_name: string | null
  project_id: string | null
  project_name: string | null
  class_project_id: string | null
  repo_id: string | null
  path: string | null
  archived_at: string
  archived_by: string | null
  archived_by_name: string | null
  /** Why it cannot be restored, or null when it can. */
  restore_block: string | null
  /** Why it cannot go to Trash, or null when it can. */
  trash_block: string | null
}

export type ArchivedBy = 'anyone' | 'me' | 'others'
export type ArchiveSort = 'newest' | 'oldest' | 'name'

export type ArchiveFilter = {
  area: 'all' | ArchiveArea
  /** Empty means every kind. */
  kinds: ArchiveKind[]
  by: ArchivedBy
  query: string
  sort: ArchiveSort
}

/** The place an item lived, in words: "BSIT 3A · Web Dev", "Capstone", "Syllabi". */
export function whereOf(item: ArchiveItem): string {
  switch (item.kind) {
    case 'class':
      return 'Classes'
    case 'group':
    case 'class_project':
      return item.class_name ?? 'Class'
    case 'class_task':
      return [item.class_name, item.project_name].filter(Boolean).join(' · ')
    case 'class_file':
      return [item.class_name, item.project_name].filter(Boolean).join(' · ')
    case 'syllabus':
      return 'Syllabi'
    case 'curriculum':
      return 'Curriculum'
    case 'space':
      return 'Spaces'
    case 'team':
      return item.space_name ?? 'Space'
    case 'project':
      return item.space_name ?? 'Projects'
    case 'work_task':
    case 'work_file':
      return [item.space_name, item.project_name].filter(Boolean).join(' · ')
  }
}

/** Where opening an item takes you: the item itself, or the archive it sits in. */
export function hrefOf(item: ArchiveItem): string {
  switch (item.kind) {
    case 'class':
      return paths.class(item.id)
    case 'group':
      return paths.group(item.id)
    case 'class_project':
      return paths.classProject(item.id)
    case 'class_task':
      return item.class_project_id ? paths.classProject(item.class_project_id) : paths.classProjects
    case 'class_file':
      return item.class_project_id
        ? `${paths.classProject(item.class_project_id)}?tab=files&view=draft`
        : paths.classProjects
    case 'syllabus':
      return paths.syllabi
    case 'curriculum':
      return paths.curriculum
    case 'space':
      return paths.space(item.id)
    case 'team':
      return item.space_id ? paths.spaceTeamsArchive(item.space_id) : paths.spaces
    case 'project':
      return paths.project(item.id)
    case 'work_task':
      return item.project_id ? paths.projectArchive(item.project_id) : paths.projects
    case 'work_file':
      if (!item.project_id) return paths.projects
      return item.file_source === 'draft'
        ? `${paths.project(item.project_id)}?tab=files&view=draft`
        : paths.projectArchive(item.project_id)
  }
}

/** What the open link says. */
export function openLabelOf(item: ArchiveItem): string {
  switch (item.kind) {
    case 'class':
      return 'Open class'
    case 'group':
      return 'Open group'
    case 'class_project':
    case 'class_task':
      return 'Open class project'
    case 'class_file':
    case 'work_file':
      return item.file_source === 'draft' ? 'Open My draft' : 'Open project archive'
    case 'syllabus':
      return 'Open Syllabi'
    case 'curriculum':
      return 'Open Curriculum'
    case 'space':
      return 'Open space'
    case 'team':
      return 'Open team archive'
    case 'project':
      return 'Open project'
    case 'work_task':
      return 'Open project archive'
  }
}

/** The rows to show, in order, for the kinds this person has. */
export function filterArchive(
  items: ArchiveItem[],
  allowed: ArchiveKind[],
  filter: ArchiveFilter,
  viewerId: string | undefined,
): ArchiveItem[] {
  const q = filter.query.trim().toLowerCase()
  const rows = items.filter((item) => {
    if (!allowed.includes(item.kind)) return false
    if (filter.area !== 'all' && item.area !== filter.area) return false
    if (filter.kinds.length > 0 && !filter.kinds.includes(item.kind)) return false
    if (filter.by === 'me' && item.archived_by !== viewerId) return false
    if (filter.by === 'others' && (!item.archived_by || item.archived_by === viewerId)) return false
    if (q) {
      const text = `${item.name} ${item.detail ?? ''} ${item.path ?? ''} ${whereOf(item)} ${item.archived_by_name ?? ''}`
      if (!text.toLowerCase().includes(q)) return false
    }
    return true
  })
  const time = (i: ArchiveItem) => new Date(i.archived_at).getTime()
  return rows.sort((a, b) =>
    filter.sort === 'name'
      ? a.name.localeCompare(b.name)
      : filter.sort === 'oldest'
        ? time(a) - time(b)
        : time(b) - time(a),
  )
}

const KIND_SET = new Set<string>(ARCHIVE_SECTIONS.map((s) => s.kind))

/** `?type=` as a list of kinds, ignoring anything unknown. */
export function readKinds(raw: string | null): ArchiveKind[] {
  return (raw ?? '').split(',').filter((k): k is ArchiveKind => KIND_SET.has(k))
}
