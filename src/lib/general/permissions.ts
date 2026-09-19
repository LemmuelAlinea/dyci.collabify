/**
 * Who may do what inside a General workplace project.
 *
 * Two layers. A member's **level** (Owner, Manager, Member) gives a fixed set of
 * permissions, and an Owner can **grant** one member a single permission on top
 * of their level. Levels are the easy part to understand; grants are how a
 * Treasurer gets file editing without becoming a Manager.
 *
 * This file mirrors `general_can()` in supabase/general.sql, which is the
 * enforcement. Keep the two in step.
 */

export type GeneralLevel = 'owner' | 'manager' | 'member'

export type GeneralPermission =
  | 'edit_project'
  | 'manage_members'
  | 'manage_structure'
  | 'manage_tasks'
  | 'edit_files'

export const PERMISSIONS: { value: GeneralPermission; label: string; note: string }[] = [
  {
    value: 'edit_project',
    label: 'Edit project details',
    note: 'Change the name, dates, status, the points setting and every added field.',
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

/** What a member could still ask an Owner for. */
export function requestable(
  level: GeneralLevel | null,
  grants: readonly GeneralPermission[],
  open: readonly GeneralPermission[],
): GeneralPermission[] {
  if (level !== 'member') return []
  return ALL.filter((p) => !grants.includes(p) && !open.includes(p))
}

/** A project always keeps at least one Owner. */
export function canStepDown(level: GeneralLevel, ownerCount: number): boolean {
  return level !== 'owner' || ownerCount > 1
}

export function permissionLabel(p: GeneralPermission): string {
  return PERMISSIONS.find((x) => x.value === p)?.label ?? p
}

export function levelLabel(l: GeneralLevel): string {
  return LEVELS.find((x) => x.value === l)?.label ?? l
}
