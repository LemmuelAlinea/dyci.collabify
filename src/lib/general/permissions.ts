/**
 * Who may do what inside a General workplace project.
 *
 * Two layers. A member's **role** gives a fixed set of permissions, and the
 * project manager or a Coordinator can **grant** one member a single
 * permission on top of it (`canGive`).
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
 * A person's role in a work project. Stakeholder is usable from phase 3 (it
 * reads and holds no permission); QA becomes usable in phase 4. Neither holds
 * a permission by role.
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
  // The database's general_has() ignores QA and Stakeholder grants, so the
  // UI must too, or it offers buttons the server refuses.
  if (!role || role === 'qa' || role === 'stakeholder') return false
  return rolePermissions(role).includes(p) || grants.includes(p)
}

/**
 * The roles an actor may move a target to. The project manager switches anyone
 * but the project manager between Coordinator, Member and Stakeholder; a
 * Coordinator moves a Member or Stakeholder between those two. QA is still
 * refused by the database until phase 4. Making somebody project manager is a
 * hand over, never a role change.
 */
export function assignableRoles(actor: ProjectRole, target: ProjectRole): ProjectRole[] {
  if (actor === 'pm' && target !== 'pm') return ['coordinator', 'member', 'stakeholder']
  if (actor === 'coordinator' && (target === 'member' || target === 'stakeholder')) {
    return ['member', 'stakeholder']
  }
  return []
}

/**
 * The roles an actor may invite someone as: the project manager any but
 * project manager, a Coordinator a Member or Stakeholder. Mirrors
 * invite_to_general_project.
 */
export function inviteRoles(actor: ProjectRole): ProjectRole[] {
  if (actor === 'pm') return ['member', 'coordinator', 'stakeholder']
  if (actor === 'coordinator') return ['member', 'stakeholder']
  return []
}

/**
 * Who a file can be shared with: every member but the sharer, anyone rejected,
 * and Stakeholders, whom the database refuses ("Stakeholders can't receive
 * shared files").
 */
export function shareRecipients<M extends { user_id: string; profile?: { status?: string } | null }>(
  members: readonly M[],
  viewerId: string | undefined,
  roleOf: (userId: string) => ProjectRole | null,
): M[] {
  return members.filter(
    (m) =>
      m.user_id !== viewerId && m.profile?.status !== 'rejected' && roleOf(m.user_id) !== 'stakeholder',
  )
}

/**
 * Whether an actor may offer to remove a target. Nobody removes the project
 * manager, and only the project manager removes a Coordinator, whatever else
 * the actor holds or was granted. Mirrors remove_general_member.
 */
export function canRemoveRole(actor: ProjectRole | null, target: ProjectRole): boolean {
  if (!actor || target === 'pm') return false
  return target !== 'coordinator' || actor === 'pm'
}

/**
 * Whether a role may give this permission as a grant, take it back, or answer
 * a request for it. The project manager gives all six; a Coordinator gives the
 * ones it holds itself, so not Edit project details. A grant never makes its
 * holder a giver. Mirrors general_can_grant() in supabase/project-roles.sql.
 */
export function canGive(role: ProjectRole | null, permission: GeneralPermission): boolean {
  if (role === 'pm') return true
  return role === 'coordinator' && permission !== 'edit_project'
}

/* ------------------------------------------------------------ task powers */

/**
 * The viewer, as the task rules read them. `leadsUser` says whether the viewer
 * leads a team this person is on (useGeneralProject's `leadsUser`).
 */
export type TaskViewer = {
  viewerId: string | undefined
  manageTasks: boolean
  archived: boolean
  leadsUser: (userId: string) => boolean
}

/** A task's holders and creator, which is all the task rules read. */
export type TaskHolders = { assignee_ids: readonly string[]; created_by: string | null }

/**
 * Whether the viewer may change a task's details and stage: someone who
 * manages tasks, a holder, its creator while nobody holds it, or the leader of
 * a team one of its holders is on. Mirrors guard_general_task and
 * sync_general_task_stage (supabase/project-team-leads.sql). Points are not
 * covered: they still need manage_tasks.
 */
export function canEditTask(v: TaskViewer, task: TaskHolders): boolean {
  if (v.archived) return false
  if (v.manageTasks) return true
  const me = v.viewerId
  if (me && task.assignee_ids.includes(me)) return true
  if (me && task.created_by === me && task.assignee_ids.length === 0) return true
  return task.assignee_ids.some(v.leadsUser)
}

/**
 * Whether the viewer may take this holder off the task: someone who manages
 * tasks, the holder themselves, or a leader of a team the holder is on.
 * Mirrors the general_task_assignees_delete policy.
 */
export function canUnassign(v: TaskViewer, userId: string): boolean {
  if (v.archived) return false
  return v.manageTasks || userId === v.viewerId || v.leadsUser(userId)
}

/**
 * Whom the viewer may assign to the task, from `candidates`. Someone who
 * manages tasks assigns anyone not already on it. A team leader assigns people
 * they lead, but only while nobody holds the task: the database refuses a
 * second holder from anyone who does not manage tasks. The viewer themselves
 * is left out for a leader, who takes the task with "Take this task" instead.
 * Mirrors the general_task_assignees_insert policy and guard_general_task_child.
 */
export function assignableTo(v: TaskViewer, task: TaskHolders, candidates: readonly string[]): string[] {
  if (v.archived) return []
  const free = candidates.filter((id) => !task.assignee_ids.includes(id))
  if (v.manageTasks) return free
  if (task.assignee_ids.length > 0) return []
  return free.filter((id) => id !== v.viewerId && v.leadsUser(id))
}

/**
 * Whether the viewer may move a task up or down its list (its rank). Planners
 * reorder anything; a team leader reorders tasks somebody they lead holds.
 * Moving a task between sprints still needs planning. Mirrors
 * guard_general_task_plan.
 */
export function canStepRank(
  canPlan: boolean,
  holderIds: readonly string[] | undefined,
  leadsUser: (userId: string) => boolean,
): boolean {
  return canPlan || (holderIds ?? []).some(leadsUser)
}

/**
 * yes    the role does it
 * team   only for tasks of people on the team the person leads
 * grant  not by default; the project manager or a Coordinator can grant it
 * own    only what the person made or holds
 * read   sees it, cannot change it
 */
export type RoleMark = 'yes' | 'team' | 'grant' | 'own' | 'read'

/**
 * What each role can do, in plain words, for the "What each role can do" table.
 * `lead` is the Team lead tag, which sits on top of whatever role the person
 * has. A missing key means no. This is the spec's table row for row, QA and
 * Stakeholder included, so it reads right once those roles are usable.
 * `later` is a caption for a row (or part of one) that is not built yet.
 */
export const ROLE_MATRIX: {
  action: string
  roles: Partial<Record<ProjectRole | 'lead', RoleMark>>
  later?: string
}[] = [
  {
    action: 'See the project, tasks, sprints, milestones, files and meetings',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes', stakeholder: 'read' },
  },
  { action: 'Edit project details and stages, archive and delete', roles: { pm: 'yes' } },
  { action: 'Mark the QA stage', roles: { pm: 'yes' }, later: 'Coming later' },
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
    later: 'Bug tasks: coming later',
  },
  { action: 'Plan sprints and milestones', roles: { pm: 'yes', coordinator: 'yes', member: 'grant' } },
  {
    action: 'Move a task out of the QA stage (QA, when the project has QA)',
    roles: { pm: 'yes', qa: 'yes' },
    later: 'Coming later',
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
  {
    action: 'Post in Feedback',
    roles: { pm: 'yes', coordinator: 'yes', stakeholder: 'yes' },
  },
  {
    action: 'Change the status of Feedback',
    roles: { pm: 'yes', coordinator: 'yes' },
  },
  {
    action: 'Read Feedback',
    roles: { pm: 'yes', coordinator: 'yes', lead: 'yes', member: 'yes', qa: 'yes', stakeholder: 'yes' },
  },
  { action: 'Give grants and answer access requests', roles: { pm: 'yes', coordinator: 'yes' } },
  { action: 'Ask for more access', roles: { lead: 'yes', member: 'yes' } },
]
