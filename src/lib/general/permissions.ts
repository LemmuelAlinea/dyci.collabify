/**
 * Who may do what inside a General workplace project.
 *
 * Two layers. A member's **role** gives a fixed set of permissions, and the
 * project manager can **grant** one member a single permission on top of it.
 * Roles are the easy part to understand; grants are how a Treasurer gets file
 * editing without becoming a Coordinator.
 *
 * Work projects use roles (`rolePermissions`, `canAs`), which mirror
 * `general_has()` in supabase/project-roles.sql. Spaces and class spaces still
 * use the older three **levels** (`levelPermissions`, `can`), which mirror
 * `general_can()` in supabase/general.sql. The database is the enforcement.
 * Keep the two in step.
 */

/**
 * A person's role in a work project. QA and Stakeholder are stored from phase
 * 2 and become usable in phases 3 and 4; until then they hold no permission.
 */
export type ProjectRole = 'pm' | 'coordinator' | 'member' | 'qa' | 'stakeholder'

export type GeneralLevel = 'owner' | 'manager' | 'member'

export type GeneralPermission =
  | 'edit_project'
  | 'manage_members'
  | 'manage_structure'
  | 'manage_tasks'
  | 'edit_files'
  | 'commit_main'

export const PERMISSIONS: { value: GeneralPermission; label: string; note: string }[] = [
  {
    value: 'edit_project',
    label: 'Edit project details',
    note: 'Change the name, dates, status and every added field.',
  },
  {
    value: 'manage_members',
    label: 'Invite and remove members',
    note: 'Send and withdraw invitations, and remove Members from the project.',
  },
  {
    value: 'manage_structure',
    label: 'Manage teams and positions',
    note: 'Create, rename and remove teams and positions, and choose who is in them.',
  },
  {
    value: 'manage_tasks',
    label: 'Manage all tasks',
    note: "Edit, assign, reassign and remove anyone's tasks.",
  },
  {
    value: 'edit_files',
    label: 'Edit files on any task',
    note: 'Add and remove files on every task, not only the tasks you hold.',
  },
  {
    value: 'commit_main',
    label: 'Commit to Main',
    note: 'Save work straight to Main, and merge changes others submit. Without it, your work goes in as a change for someone who has it to review.',
  },
]

export const LEVELS: { value: GeneralLevel; label: string; note: string }[] = [
  {
    value: 'owner',
    label: 'Owner',
    note: 'Everything, plus access levels, access requests, archiving and ownership.',
  },
  { value: 'manager', label: 'Manager', note: 'Every permission, but not access or ownership.' },
  {
    value: 'member',
    label: 'Member',
    note: 'Sees the project, comments, and works on tasks. Can request more.',
  },
]

const ALL: GeneralPermission[] = PERMISSIONS.map((p) => p.value)

export function levelPermissions(level: GeneralLevel): GeneralPermission[] {
  return level === 'member' ? [] : [...ALL]
}

/** An archived project is read-only for everybody until an Owner restores it. */
export function can(
  level: GeneralLevel | null,
  grants: readonly GeneralPermission[],
  permission: GeneralPermission,
  archived = false,
): boolean {
  if (!level || archived) return false
  return levelPermissions(level).includes(permission) || grants.includes(permission)
}

/** What a Member could still ask the project manager for. */
export function requestable(
  role: ProjectRole | null,
  grants: readonly GeneralPermission[],
  open: readonly GeneralPermission[],
): GeneralPermission[] {
  if (role !== 'member') return []
  return ALL.filter((p) => !grants.includes(p) && !open.includes(p))
}

/** A project always keeps at least one Owner. */
export function canStepDown(level: GeneralLevel, ownerCount: number): boolean {
  return level !== 'owner' || ownerCount > 1
}

export function permissionLabel(p: GeneralPermission): string {
  return PERMISSIONS.find((x) => x.value === p)?.label ?? p
}

/**
 * Null is not a missing value here: it is somebody who reaches the project
 * through its space rather than through its members, so they read everything
 * and hold nothing.
 */
export function levelLabel(l: GeneralLevel | null): string {
  if (!l) return 'watching from the space'
  return LEVELS.find((x) => x.value === l)?.label ?? l
}

/* ------------------------------------------------------------------ roles */

export const ROLE_LABEL: Record<ProjectRole, string> = {
  pm: 'Project manager',
  coordinator: 'Coordinator',
  member: 'Member',
  qa: 'QA',
  stakeholder: 'Stakeholder',
}

/** What a person's name wears on a member row. A plain Member wears nothing. */
export const ROLE_BADGE: Record<ProjectRole, string | null> = {
  pm: 'PM',
  coordinator: 'Coordinator',
  member: null,
  qa: 'QA',
  stakeholder: 'Stakeholder',
}

/**
 * The project manager holds all six, a Coordinator all but edit_project, and
 * everybody else only what they are granted.
 */
export function rolePermissions(role: ProjectRole): GeneralPermission[] {
  if (role === 'pm') return [...ALL]
  if (role === 'coordinator') return ALL.filter((p) => p !== 'edit_project')
  return []
}

/** Whether a role plus its grants holds the permission. No role holds nothing. */
export function canAs(
  role: ProjectRole | null,
  grants: readonly GeneralPermission[],
  p: GeneralPermission,
): boolean {
  if (!role) return false
  return rolePermissions(role).includes(p) || grants.includes(p)
}

/**
 * The roles an actor may move a target to. In phase 2 the project manager
 * switches anyone but the project manager between Coordinator and Member, and a
 * Coordinator turns a Member into a Member (the one move they may make). Making
 * somebody project manager is a hand over, never a role change.
 */
export function assignableRoles(actor: ProjectRole, target: ProjectRole): ProjectRole[] {
  if (actor === 'pm' && target !== 'pm') return ['coordinator', 'member']
  if (actor === 'coordinator' && target === 'member') return ['member']
  return []
}

/**
 * yes    the role does it
 * team   only for tasks of people on the team the person leads
 * grant  not by default; the project manager can grant it
 * own    only what the person made or holds
 * read   sees it, cannot change it
 */
export type RoleMark = 'yes' | 'team' | 'grant' | 'own' | 'read'

/**
 * What each role can do, in plain words, for the "What each role can do" table.
 * `lead` is the Team lead tag, which sits on top of whatever role the person
 * has. A missing key means no. This is the spec's table row for row, QA and
 * Stakeholder included, so it reads right once those roles are usable.
 */
export const ROLE_MATRIX: {
  action: string
  roles: Partial<Record<ProjectRole | 'lead', RoleMark>>
}[] = [
  {
    action: 'See the project, tasks, sprints, milestones, files and meetings',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes', stakeholder: 'read' },
  },
  { action: 'Edit project details and stages, archive and delete', roles: { pm: 'yes' } },
  { action: 'Mark the QA stage', roles: { pm: 'yes' } },
  {
    action: 'Invite and remove people, and set roles (not project manager)',
    roles: { pm: 'yes', coordinator: 'yes' },
  },
  { action: 'Hand over project manager', roles: { pm: 'yes' } },
  { action: 'Create and manage teams, and pick team leads', roles: { pm: 'yes', coordinator: 'yes' } },
  {
    action: 'Create, assign and edit any task',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'team', member: 'grant' },
  },
  {
    action: 'Create tasks and edit your own (QA: bug tasks only)',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'own' },
  },
  { action: 'Plan sprints and milestones', roles: { pm: 'yes', coordinator: 'yes', member: 'grant' } },
  {
    action: 'Move a task out of the QA stage (QA, when the project has QA)',
    roles: { pm: 'yes', qa: 'yes' },
  },
  {
    action: 'Files tab: folders, move, rename and delete any file',
    roles: { pm: 'yes', coordinator: 'yes', member: 'grant' },
  },
  {
    action: 'Commit to Main',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'grant', member: 'grant' },
  },
  {
    action: 'Keep your own drafts and submit changes for review',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes' },
  },
  {
    action: 'Schedule and edit project meetings',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'own', member: 'own', qa: 'own' },
  },
  {
    action: 'Comment on tasks, and join discussions and the project chat',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes' },
  },
  { action: 'Post in Feedback', roles: { pm: 'yes', coordinator: 'yes', stakeholder: 'yes' } },
  { action: 'Change the status of Feedback', roles: { pm: 'yes', coordinator: 'yes' } },
  {
    action: 'Read Feedback',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes', stakeholder: 'yes' },
  },
  {
    action: 'Give grants and answer access requests, or ask for them',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'grant', member: 'grant' },
  },
]
