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
  /** Syllabi only: how far the week map has got. */
  parse_status?: ParseStatus
  parsed_at?: string | null
  parse_error?: string | null
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
  /** Week 1 of the syllabus starts here; every other week counts from it. */
  term_start: string | null
  term_end: string | null
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
  type: 'announcement' | 'project_released'
  class_id: string | null
  announcement_id: string | null
  project_id: string | null
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

/* ------------------------------------------------------------------- groups */

export type GroupingMode = 'manual' | 'random' | 'student_formed'

export type GroupSet = {
  id: string
  class_id: string
  name: string
  mode: GroupingMode
  default_limit: number
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type GroupRow = {
  id: string
  set_id: string
  name: string
  member_limit: number
  position: number
  created_at: string
  updated_at: string
}

/** group_overview: the row plus the set/class context every card needs. */
export type GroupSummary = GroupRow & {
  class_id: string
  set_name: string
  set_mode: GroupingMode
  set_closed_at: string | null
  member_count: number
}

export type GroupMember = {
  group_id: string
  set_id: string
  student_id: string
  added_by: string | null
  joined_at: string
  profile: Pick<Profile, 'id' | 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'>
}

export type JoinGroupResult =
  | 'joined'
  | 'already_here'
  | 'full'
  | 'closed'
  | 'not_student_formed'
  | 'not_in_class'
  | 'not_found'
  | 'not_signed_in'

export const GROUPING_MODES: {
  value: GroupingMode
  label: string
  blurb: string
  icon: 'user' | 'refresh' | 'users'
}[] = [
  {
    value: 'manual',
    label: 'Manual',
    blurb: 'You place each student yourself.',
    icon: 'user',
  },
  {
    value: 'random',
    label: 'Random',
    blurb: 'Shuffle the class, reshuffle until it looks right.',
    icon: 'refresh',
  },
  {
    value: 'student_formed',
    label: 'Student formed',
    blurb: 'Publish empty groups and let students pick.',
    icon: 'users',
  },
]

export function modeLabel(mode: GroupingMode) {
  return GROUPING_MODES.find((m) => m.value === mode)?.label ?? mode
}

/* ----------------------------------------------------------------- syllabus */

export type ParseStatus = 'unparsed' | 'parsing' | 'draft' | 'verified' | 'failed'

export type SyllabusWeek = {
  id: string
  resource_id: string
  week_no: number
  title: string
  topics: string
  outcomes: string
  /** What the week expects handed in — what a project binds to. */
  assessments: string
  notes: string | null
}

export type WeekPhase = 'past' | 'current' | 'upcoming' | 'undated'

/** class_week_map: a syllabus week with the calendar dates of one class laid over it. */
export type ClassWeek = {
  class_id: string
  syllabus_id: string
  week_id: string
  week_no: number
  title: string
  topics: string
  outcomes: string
  assessments: string
  notes: string | null
  term_start: string | null
  term_end: string | null
  week_start: string | null
  week_end: string | null
  phase: WeekPhase
}

export const PARSE_STATUS_LABEL: Record<ParseStatus, string> = {
  unparsed: 'Not read yet',
  parsing: 'Reading…',
  draft: 'Draft — needs your check',
  verified: 'Verified',
  failed: "Couldn't be read",
}

export function weekRange(week: Pick<ClassWeek, 'week_start' | 'week_end'>) {
  if (!week.week_start || !week.week_end) return 'No term dates'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const from = new Date(week.week_start).toLocaleDateString(undefined, opts)
  const to = new Date(week.week_end).toLocaleDateString(undefined, opts)
  return `${from} – ${to}`
}

/* ----------------------------------------------------------------- projects */

export type ProjectType =
  | 'web_dev'
  | 'mobile_dev'
  | 'research'
  | 'capstone'
  | 'group_programming'
  | 'individual_programming'
  | 'activity'
  | 'laboratory'
  | 'quiz'
  | 'exam'
  | 'other'

export type ProjectAudience = 'group' | 'individual'

export type ProjectRow = {
  id: string
  class_id: string
  created_by: string
  title: string
  type: ProjectType
  /** Free text, required when type is 'other'. */
  type_label: string | null
  guidelines: string
  /** The syllabus weeks this project is built on. Never empty. */
  start_week: number
  end_week: number
  audience: ProjectAudience
  group_set_id: string | null
  total_points: number
  due_at: string | null
  /** Null means live now; a future time keeps it hidden from students. */
  release_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** project_overview: the row plus the class, rubric, and syllabus context. */
export type ProjectSummary = ProjectRow & {
  class_name: string
  class_initial: string
  group_set_name: string | null
  criteria_count: number
  criteria_points: number
  attachment_count: number
  scheduled: boolean
  start_week_title: string | null
  /** What the bound weeks say is due — the project's stated basis. */
  week_assessments: string | null
}

export type ProjectCriterion = {
  id: string
  project_id: string
  position: number
  label: string
  description: string
  max_points: number
}

export type ProjectAttachment = {
  id: string
  project_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  created_at: string
}

/** Kept as a literal union so lib/ stays free of component imports. */
export type ProjectTypeIcon =
  | 'check'
  | 'target'
  | 'file'
  | 'shield'
  | 'edit'
  | 'users'
  | 'board'
  | 'monitor'
  | 'chart'
  | 'spark'
  | 'folder'

export const PROJECT_TYPES: {
  value: ProjectType
  label: string
  icon: ProjectTypeIcon
  blurb: string
  /** Working days this kind of deliverable usually needs. Drives the deadline check. */
  typicalDays: number
  defaultAudience: ProjectAudience
}[] = [
  {
    value: 'activity',
    label: 'Activity',
    icon: 'check',
    blurb: 'A short exercise tied to one topic.',
    typicalDays: 3,
    defaultAudience: 'individual',
  },
  {
    value: 'laboratory',
    label: 'Laboratory',
    icon: 'target',
    blurb: 'A guided hands-on lab with a deliverable.',
    typicalDays: 5,
    defaultAudience: 'individual',
  },
  {
    value: 'quiz',
    label: 'Quiz',
    icon: 'file',
    blurb: 'A short assessment on the week covered.',
    typicalDays: 1,
    defaultAudience: 'individual',
  },
  {
    value: 'exam',
    label: 'Exam',
    icon: 'shield',
    blurb: 'A major assessment across several weeks.',
    typicalDays: 1,
    defaultAudience: 'individual',
  },
  {
    value: 'individual_programming',
    label: 'Individual programming',
    icon: 'edit',
    blurb: 'One student writes and submits the code.',
    typicalDays: 7,
    defaultAudience: 'individual',
  },
  {
    value: 'group_programming',
    label: 'Group programming',
    icon: 'users',
    blurb: 'A team builds one program together.',
    typicalDays: 14,
    defaultAudience: 'group',
  },
  {
    value: 'web_dev',
    label: 'Web development',
    icon: 'board',
    blurb: 'A working web application, front to back.',
    typicalDays: 21,
    defaultAudience: 'group',
  },
  {
    value: 'mobile_dev',
    label: 'Mobile development',
    icon: 'monitor',
    blurb: 'A working mobile application.',
    typicalDays: 21,
    defaultAudience: 'group',
  },
  {
    value: 'research',
    label: 'Research',
    icon: 'chart',
    blurb: 'A written study with data and findings.',
    typicalDays: 28,
    defaultAudience: 'group',
  },
  {
    value: 'capstone',
    label: 'Capstone',
    icon: 'spark',
    blurb: 'The full-term system, documentation, and defense.',
    typicalDays: 56,
    defaultAudience: 'group',
  },
  {
    value: 'other',
    label: 'Other',
    icon: 'folder',
    blurb: 'Anything the list above does not cover.',
    typicalDays: 7,
    defaultAudience: 'individual',
  },
]

export function projectTypeLabel(p: Pick<ProjectRow, 'type' | 'type_label'>) {
  if (p.type === 'other') return p.type_label || 'Other'
  return PROJECT_TYPES.find((t) => t.value === p.type)?.label ?? p.type
}

export function weekSpanLabel(p: Pick<ProjectRow, 'start_week' | 'end_week'>) {
  return p.start_week === p.end_week
    ? `Week ${p.start_week}`
    : `Weeks ${p.start_week}–${p.end_week}`
}

const DAY = 86_400_000

/** Live for students right now — the same rule the RLS policy applies. */
export function isReleased(p: Pick<ProjectRow, 'release_at' | 'archived_at'>) {
  return (
    !p.archived_at && (!p.release_at || new Date(p.release_at).getTime() <= Date.now())
  )
}

export type Feasibility = { tone: 'success' | 'info' | 'error'; message: string }

/**
 * A warning, never a block. Compares the time students actually get against
 * what this kind of deliverable usually takes, and against the weeks it is
 * built on. The professor always has the final say.
 */
export function assessDeadline(input: {
  type: ProjectType
  dueAt: string | null
  releaseAt: string | null
  /** Calendar end of the last bound week, when the class has term dates. */
  spanEnd: string | null
}): Feasibility | null {
  if (!input.dueAt) return null
  const due = new Date(input.dueAt).getTime()
  if (Number.isNaN(due)) return null

  const startsAt = input.releaseAt ? new Date(input.releaseAt).getTime() : Date.now()
  const days = Math.round((due - startsAt) / DAY)
  const need = PROJECT_TYPES.find((t) => t.value === input.type)?.typicalDays ?? 7
  const label = PROJECT_TYPES.find((t) => t.value === input.type)?.label.toLowerCase() ?? 'project'

  if (days < 0) {
    return { tone: 'error', message: 'The deadline is before students can even see this.' }
  }
  if (days === 0) {
    return { tone: 'error', message: 'Due the same day it opens. Students get no working time.' }
  }
  if (days < Math.ceil(need * 0.6)) {
    return {
      tone: 'error',
      message: `${days} day${days === 1 ? '' : 's'} for a ${label}. Similar work usually needs about ${need}. Consider moving the deadline.`,
    }
  }
  if (days < need) {
    return {
      tone: 'info',
      message: `${days} days is workable but tight — a ${label} usually takes around ${need}.`,
    }
  }
  if (input.spanEnd) {
    const overrun = Math.round((due - new Date(input.spanEnd).getTime()) / DAY)
    if (overrun > 14) {
      return {
        tone: 'info',
        message: `${days} days is comfortable, but the deadline lands ${overrun} days after the last week it is based on.`,
      }
    }
  }
  return {
    tone: 'success',
    message: `${days} days. That is a realistic window for a ${label}.`,
  }
}

/* -------------------------------------------------------------------- tasks */

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskAuthor = 'professor' | 'student'

export type TaskEventKind =
  | 'created'
  | 'edited'
  | 'claimed'
  | 'unclaimed'
  | 'assigned'
  | 'started'
  | 'finished'
  | 'reopened'

/** Where work happens: one group's board, or one student's for a solo project. */
export type ProjectBoard = {
  id: string
  project_id: string
  group_id: string | null
  student_id: string | null
  created_at: string
}

/** task_board_overview: the board, its counts, and its split of 100. */
export type BoardSummary = ProjectBoard & {
  class_id: string
  project_title: string
  project_due_at: string | null
  total_points: number
  group_name: string | null
  group_set_id: string | null
  task_count: number
  done_count: number
  doing_count: number
  unclaimed_count: number
  member_count: number
  total_weight: number
  /** The board always totals 100, however many tasks it holds. */
  done_pct: number
  doing_pct: number
  unclaimed_pct: number
  /** When a task on it last changed. Null while the board is empty. */
  last_activity: string | null
}

/**
 * task_member_progress. Two numbers that answer different questions:
 * `personal_pct` is this student's own 100 — their individual grade — while
 * `group_pct` is how much of the group's 100 they have delivered.
 */
export type MemberProgress = {
  board_id: string
  project_id: string
  student_id: string
  task_count: number
  done_count: number
  held_weight: number
  done_weight: number
  /** Null when they hold nothing yet — not a zero. */
  personal_pct: number | null
  group_pct: number
  held_pct: number
  /** An equal cut of the board — 25 in a four, 20 in a five. 100 when solo. */
  cap_pct: number
  /** False once they already carry a full share. */
  can_claim: boolean
  profile?: Pick<Profile, 'id' | 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'>
}

export type TaskAssignee = {
  task_id: string
  student_id: string
  claimed_by: string | null
  claimed_at: string
  profile?: Pick<Profile, 'id' | 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'>
}

export type ProjectTask = {
  id: string
  board_id: string
  /** Set on the copies of one professor task handed to several groups. */
  origin_id: string | null
  title: string
  details: string
  weight: number
  status: TaskStatus
  due_at: string | null
  position: number
  created_by: string | null
  author_role: TaskAuthor
  ai_generated: boolean
  started_at: string | null
  done_at: string | null
  created_at: string
  updated_at: string
  assignees: TaskAssignee[]
}

export type TaskEvent = {
  id: string
  task_id: string
  actor_id: string | null
  kind: TaskEventKind
  detail: string
  at: string
  actor?: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>
}

export const TASK_STATUSES: { value: TaskStatus; label: string; blurb: string }[] = [
  { value: 'todo', label: 'To do', blurb: 'Not started. Still open to edits.' },
  { value: 'in_progress', label: 'In progress', blurb: 'Someone is on it. The wording is now fixed.' },
  { value: 'done', label: 'Done', blurb: 'Finished, by whoever it belongs to.' },
]

export function taskStatusLabel(status: TaskStatus) {
  return TASK_STATUSES.find((s) => s.value === status)?.label ?? status
}

/** Editable by the group only until somebody starts it. */
export function isTaskEditable(task: Pick<ProjectTask, 'status'>, role: Role) {
  return role === 'professor' || task.status === 'todo'
}

export function isUnclaimed(task: Pick<ProjectTask, 'assignees'>) {
  return task.assignees.length === 0
}

export function isMine(task: Pick<ProjectTask, 'assignees'>, studentId: string) {
  return task.assignees.some((a) => a.student_id === studentId)
}

/** A task's slice of the board's 100. Recomputed as tasks come and go. */
export function taskShare(task: Pick<ProjectTask, 'weight'>, totalWeight: number) {
  if (!totalWeight) return 0
  return Math.round((task.weight / totalWeight) * 1000) / 10
}

export function boardWeight(tasks: Pick<ProjectTask, 'weight'>[]) {
  return tasks.reduce((n, t) => n + t.weight, 0)
}

/** A short "3 of 8 done" for headers and cards. */
export function taskTally(tasks: Pick<ProjectTask, 'status'>[]) {
  const done = tasks.filter((t) => t.status === 'done').length
  return { done, total: tasks.length, label: `${done} of ${tasks.length} done` }
}

export function dueSoonLabel(iso: string | null) {
  if (!iso) return null
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 7) return `Due in ${days} days`
  return `Due ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/* ----------------------------------------------------------------- messages */

export type ConversationKind = 'class' | 'group' | 'direct'

export type ConversationRow = {
  id: string
  kind: ConversationKind
  class_id: string | null
  group_id: string | null
  direct_key: string | null
  updated_at: string
}

/** conversation_overview: the row plus this viewer's unread state and preview. */
export type ConversationSummary = ConversationRow & {
  last_read_at: string
  unread_count: number
  last_body: string | null
  last_at: string | null
}

/** What the list renders — resolved once, from classes, groups, and profiles. */
export type ConversationCard = ConversationSummary & {
  title: string
  subtitle: string
  /** Set for direct threads, so the list can show a face. */
  counterpart?: Pick<Profile, 'id' | 'first_name' | 'last_name' | 'avatar_url'>
  writable: boolean
}

export type MessageAttachment = {
  id: string
  message_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
}

export type PollOption = {
  id: string
  poll_id: string
  label: string
  position: number
}

export type PollVote = {
  option_id: string
  user_id: string
  voter?: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>
}

export type Poll = {
  id: string
  message_id: string
  conversation_id: string
  created_by: string
  question: string
  allow_multiple: boolean
  allow_new_options: boolean
  closed_at: string | null
  options: PollOption[]
  votes: PollVote[]
}

export type ChatMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  edited_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  pinned: boolean
  created_at: string
  attachments: MessageAttachment[]
  poll?: Poll | null
  sender?: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>
}

/** Vote counts per option, plus who this viewer picked. */
export function tallyPoll(poll: Poll, viewerId: string) {
  const total = new Set(poll.votes.map((v) => v.user_id)).size
  const byOption = new Map<string, PollVote[]>()
  for (const v of poll.votes) {
    const list = byOption.get(v.option_id) ?? []
    list.push(v)
    byOption.set(v.option_id, list)
  }
  return {
    total,
    mine: new Set(poll.votes.filter((v) => v.user_id === viewerId).map((v) => v.option_id)),
    forOption: (optionId: string) => byOption.get(optionId) ?? [],
  }
}

export const EDIT_WINDOW_MINUTES = 15

export function withinEditWindow(message: Pick<ChatMessage, 'created_at'>) {
  return Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MINUTES * 60_000
}

export function isImage(attachment: Pick<MessageAttachment, 'mime_type'>) {
  return Boolean(attachment.mime_type?.startsWith('image/'))
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
