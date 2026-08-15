export type Role = 'student' | 'professor' | 'superadmin'
export type AccountStatus = 'active' | 'pending' | 'rejected'
export type ThemeMode = 'light' | 'dark' | 'system'

export type Profile = {
  id: string
  email: string
  first_name: string
  middle_name: string | null
  last_name: string
  role: Role
  status: AccountStatus
  avatar_url: string | null
  theme: ThemeMode
  created_at: string
  updated_at: string
}

export type NotificationPrefs = {
  user_id: string
  project_invites: boolean
  task_assignments: boolean
  deadline_reminders: boolean
  comments_mentions: boolean
  progress_digest: boolean
  announcements: boolean
}

export type NotificationKey = Exclude<keyof NotificationPrefs, 'user_id'>

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  professor: 'Professor',
  superadmin: 'Superadmin',
}

export function fullName(p: Pick<Profile, 'first_name' | 'middle_name' | 'last_name'>) {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim()
}

export function initials(p: Pick<Profile, 'first_name' | 'last_name'>) {
  return `${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase() || '?'
}

/* ------------------------------------------------------------------ classes */

export type YearLevel = '1st' | '2nd' | '3rd' | '4th'
export type Semester = '1st' | '2nd' | '3rd' | 'summer'
export type MemberStatus = 'active' | 'removed'
export type ResourceKind = 'syllabus' | 'curriculum'

export type TeachingResource = {
  id: string
  professor_id: string
  kind: ResourceKind
  title: string
  file_path: string
  file_name: string
  size_bytes: number
  uploaded_at: string
}

export type ClassRow = {
  id: string
  professor_id: string
  name: string
  initial: string
  code: string
  section: string
  year_level: YearLevel
  semester: Semester
  school_year: string
  description: string | null
  syllabus_id: string | null
  curriculum_id: string | null
  join_open: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** A class row plus the counts and names the cards and headers need. */
export type ClassSummary = ClassRow & {
  student_count: number
  professor?: Pick<Profile, 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'>
}

export type ClassMember = {
  class_id: string
  student_id: string
  status: MemberStatus
  joined_at: string
  removed_at: string | null
  removed_by: string | null
  profile: Pick<
    Profile,
    'id' | 'first_name' | 'middle_name' | 'last_name' | 'email' | 'avatar_url'
  >
}

export type AnnouncementAttachment = {
  id: string
  announcement_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
}

export type Announcement = {
  id: string
  class_id: string
  author_id: string
  title: string
  body: string
  pinned: boolean
  edited_at: string | null
  created_at: string
  updated_at: string
  attachments: AnnouncementAttachment[]
  author?: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>
}

export type AppNotification = {
  id: string
  user_id: string
  type: 'announcement'
  class_id: string | null
  announcement_id: string | null
  title: string
  preview: string | null
  read_at: string | null
  created_at: string
}

export type JoinResult =
  | 'joined'
  | 'already_member'
  | 'not_found'
  | 'closed'
  | 'archived'
  | 'blocked'
  | 'not_student'
  | 'not_signed_in'

export const YEAR_LEVELS: { value: YearLevel; label: string }[] = [
  { value: '1st', label: '1st year' },
  { value: '2nd', label: '2nd year' },
  { value: '3rd', label: '3rd year' },
  { value: '4th', label: '4th year' },
]

export const SEMESTERS: { value: Semester; label: string }[] = [
  { value: '1st', label: '1st semester' },
  { value: '2nd', label: '2nd semester' },
  { value: '3rd', label: '3rd semester' },
  { value: 'summer', label: 'Summer class' },
]

export const SCHOOL_YEARS = ['2024-2025', '2025-2026', '2026-2027'].map((y) => ({
  value: y,
  label: y.replace('-', '–'),
}))

export function classMeta(c: Pick<ClassRow, 'section' | 'semester' | 'school_year'>) {
  const sem = SEMESTERS.find((s) => s.value === c.semester)?.label ?? c.semester
  return `${c.section} · ${sem.replace(' semester', ' sem')} · ${c.school_year.replace('-', '–')}`
}

/** Roster order is by family name, the way a class list is read out. */
export function byLastName(
  a: Pick<Profile, 'first_name' | 'last_name'>,
  b: Pick<Profile, 'first_name' | 'last_name'>,
) {
  return (
    a.last_name.localeCompare(b.last_name, 'en', { sensitivity: 'base' }) ||
    a.first_name.localeCompare(b.first_name, 'en', { sensitivity: 'base' })
  )
}
