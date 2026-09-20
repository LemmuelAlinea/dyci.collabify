// src/lib/general/types.ts
/**
 * Row shapes for the General workplace, one per table or view in
 * supabase/general.sql, general-tasks.sql and general-notify.sql.
 */
import type { AccountStatus, Profile } from '../types'
import type { FieldType, FieldValue } from './fields'
import type { GeneralLevel, GeneralPermission } from './permissions'
import type { GeneralTaskStatus } from './progress'

export type GeneralStatus = 'planning' | 'in_progress' | 'on_hold' | 'done' | 'cancelled'

export const PROJECT_STATUSES: { value: GeneralStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function projectStatusLabel(status: GeneralStatus) {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status
}

export type Person = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'avatar_url'>

export type GeneralProject = {
  id: string
  name: string
  description: string
  starts_on: string | null
  ends_on: string | null
  status: GeneralStatus
  points_enabled: boolean
  created_by: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  /** Which preset it started from. Reporting only — it constrains nothing. */
  preset: string | null
}

/** general_project_overview: one row per project the viewer is on. */
export type GeneralProjectSummary = GeneralProject & {
  /** Null unless the viewer can invite. */
  join_code: string | null
  join_open: boolean
  /** Null for somebody who reaches this project through its space, not its members. */
  my_level: GeneralLevel | null
  member_count: number
  task_count: number
  done_count: number
  progress_pct: number
  /** Every open request for an Owner; only the viewer's own for anyone else. */
  open_request_count: number
  /** Whether this project builds software, which shows the code notice in Files. */
  has_code: boolean
}

export type GeneralMember = {
  project_id: string
  user_id: string
  level: GeneralLevel
  joined_at: string
  /**
   * `status` rides along because the database's last-Owner rules count only
   * Owners whose account is not deactivated. Null when the profile row is not
   * readable, which is counted as live so nothing is refused that would work.
   */
  profile: (Person & { status: AccountStatus }) | null
}

export type GeneralTeam = { id: string; project_id: string; name: string; created_at: string }

export type GeneralTeamMember = { team_id: string; project_id: string; user_id: string }

export type GeneralPosition = {
  id: string
  project_id: string
  /** Null covers the whole project. */
  team_id: string | null
  name: string
  sort: number
  created_at: string
}

export type GeneralPositionHolder = { position_id: string; project_id: string; user_id: string }

export type GeneralGrant = {
  project_id: string
  user_id: string
  permission: GeneralPermission
  granted_by: string | null
  granted_at: string
}

export type AccessRequestStatus = 'open' | 'approved' | 'declined' | 'withdrawn'

export type GeneralAccessRequest = {
  id: string
  project_id: string
  user_id: string
  permission: GeneralPermission
  reason: string
  status: AccessRequestStatus
  answered_by: string | null
  answered_at: string | null
  note: string
  created_at: string
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn'

export type GeneralInvitation = {
  id: string
  project_id: string
  invitee: string
  invited_by: string | null
  status: InviteStatus
  created_at: string
  answered_at: string | null
}

/** A pending invitation on the project page, with who was invited. */
export type ProjectInvitation = GeneralInvitation & { invitee_profile: Person | null }

/** A pending invitation on the invited person's home page. */
export type MyInvitation = GeneralInvitation & {
  project: Pick<GeneralProject, 'id' | 'name' | 'description'> | null
  inviter: Person | null
}

export type GeneralField = {
  id: string
  project_id: string
  name: string
  type: FieldType
  options: string[]
  sort: number
  created_at: string
}

export type GeneralFieldValue = {
  field_id: string
  value: FieldValue
  updated_by: string | null
  updated_at: string
}

/** general_task_overview. */
export type GeneralTask = {
  id: string
  project_id: string
  team_id: string | null
  title: string
  description: string
  status: GeneralTaskStatus
  due_at: string | null
  /** When the work is meant to begin. Null until somebody says. */
  starts_at: string | null
  weight: number
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  assignee_ids: string[]
  comment_count: number
  file_count: number
  logged_minutes: number
}

export type GeneralComment = {
  id: string
  task_id: string
  project_id: string
  author_id: string | null
  body: string
  created_at: string
  edited_at: string | null
}

export type GeneralFile = {
  id: string
  task_id: string
  project_id: string
  uploaded_by: string | null
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  created_at: string
}

export type GeneralLog = {
  id: string
  task_id: string
  project_id: string
  user_id: string
  minutes: number
  note: string
  logged_on: string
  created_at: string
}

export type GeneralTaskEvent = {
  id: string
  task_id: string
  project_id: string
  actor_id: string | null
  kind: 'created' | 'updated' | 'assigned' | 'unassigned'
  /**
   * What the change was. The short fields carry what they changed from, so the
   * history answers "what did it used to say" rather than only "this moved".
   * Description is left out on purpose — it belongs in a diff, not a log line.
   */
  detail: {
    title?: string
    fields?: string[]
    status?: GeneralTaskStatus
    user_id?: string
    title_from?: string
    title_to?: string
    status_from?: GeneralTaskStatus
    due_from?: string | null
    due_to?: string | null
    starts_from?: string | null
    starts_to?: string | null
    weight_from?: number
    weight_to?: number
  }
  created_at: string
}

export type PersonHit = {
  person_id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  /** Only set when the search was that exact address. */
  email: string | null
}

export type GeneralCounts = {
  projects: number
  active_projects: number
  archived_projects: number
  people: number
}

/* ------------------------------------------------------------------ review */

/** Where a proposed change stands. Shared by file changes of every kind. */
export type ChangeStatus = 'open' | 'applied' | 'declined' | 'withdrawn'

export const CHANGE_LABEL: Record<ChangeStatus, string> = {
  open: 'Waiting for review',
  applied: 'Applied',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

/* -------------------------------------------------------------- repository */

export type FileAction = 'added' | 'changed' | 'removed'

/**
 * What a file is, which decides where it lives and how it is compared.
 *
 *   text    plain text and code, in `content`, compared line by line
 *   rich    a Word document, stored as HTML in `content`
 *   sheet   a spreadsheet, stored as JSON in `content`
 *   binary  a PDF or an image, in Storage, with `storage_path` pointing at it
 */
export type FileKind = 'text' | 'rich' | 'sheet' | 'binary'

/** One file write. The shape a commit, a change and a draft all carry. */
export type RepoFile = {
  path: string
  action: FileAction
  kind: FileKind
  content: string
  storage_path: string | null
}

export type GeneralRepo = {
  id: string
  project_id: string
  name: string
  description: string
  commit_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type GeneralRepoSummary = GeneralRepo & {
  file_count: number
  open_change_count: number
  last_author: string | null
  last_message: string | null
  last_commit_at: string | null
}

export type GeneralCommit = {
  id: string
  repo_id: string
  project_id: string
  seq: number
  message: string
  author_id: string | null
  change_id: string | null
  created_at: string
}

export type GeneralBlob = {
  id: string
  commit_id: string
  repo_id: string
  project_id: string
  seq: number
  path: string
  action: FileAction
  kind: FileKind
  content: string
  storage_path: string | null
  created_at: string
}

/** general_repo_tree: the newest row per path, minus the removed ones. */
export type GeneralTreeFile = {
  id: string
  repo_id: string
  project_id: string
  commit_id: string
  seq: number
  path: string
  kind: FileKind
  content: string
  storage_path: string | null
  size: number
  created_at: string
}

export type GeneralRepoChange = {
  id: string
  repo_id: string
  project_id: string
  author_id: string | null
  title: string
  body: string
  base_seq: number
  files: RepoFile[]
  status: ChangeStatus
  decided_by: string | null
  decided_at: string | null
  decided_note: string
  created_at: string
  updated_at: string
}

export type GeneralRepoComment = {
  id: string
  change_id: string
  project_id: string
  author_id: string | null
  path: string | null
  body: string
  created_at: string
}

export const FILE_ACTION_LABEL: Record<FileAction, string> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
}

/* ---------------------------------------------------------------- drafts */

/** Somebody's working copy of a project's files. Private to them. */
export type GeneralDraft = {
  id: string
  repo_id: string
  project_id: string
  user_id: string
  /** The commit this working copy started from. */
  base_seq: number
  created_at: string
  updated_at: string
}

export type GeneralDraftFile = RepoFile & {
  id: string
  draft_id: string
  project_id: string
  updated_at: string
}

/** A file in the draft that Main has changed underneath it. */
export type DraftConflict = { path: string; their_seq: number }

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  text: 'Text',
  rich: 'Document',
  sheet: 'Spreadsheet',
  binary: 'File',
}
