import type { IconName } from '../ui/Icon'
import type { Role } from '../../lib/types'

export type NavItem = {
  label: string
  icon: IconName
  to?: string
  /** Phase 2. Rendered as a disabled row with a "Soon" tag. */
  soon?: boolean
}

export type NavGroup = { title: string; items: NavItem[] }

const SETTINGS: NavGroup = {
  title: 'Account',
  items: [{ label: 'Settings', icon: 'settings', to: '/settings' }],
}

const BY_ROLE: Record<Role, NavGroup[]> = {
  student: [
    {
      title: 'Workspace',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/student' },
        { label: 'My tasks', icon: 'check', soon: true },
        { label: 'Project board', icon: 'kanban', soon: true },
        { label: 'Milestones', icon: 'target', soon: true },
      ],
    },
    {
      title: 'Group',
      items: [
        { label: 'Files', icon: 'folder', soon: true },
        { label: 'Discussion', icon: 'message', soon: true },
        { label: 'Calendar', icon: 'calendar', soon: true },
      ],
    },
    SETTINGS,
  ],
  professor: [
    {
      title: 'Advising',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/professor' },
        { label: 'Advisee groups', icon: 'users', soon: true },
        { label: 'Sign-offs', icon: 'checkCircle', soon: true },
        { label: 'Milestones', icon: 'target', soon: true },
      ],
    },
    {
      title: 'Records',
      items: [
        { label: 'Submissions', icon: 'file', soon: true },
        { label: 'Reports', icon: 'chart', soon: true },
        { label: 'Calendar', icon: 'calendar', soon: true },
      ],
    },
    SETTINGS,
  ],
  superadmin: [
    {
      title: 'Program',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/admin' },
        { label: 'Professor approvals', icon: 'shield', soon: true },
        { label: 'Accounts', icon: 'users', soon: true },
        { label: 'Sections', icon: 'folder', soon: true },
      ],
    },
    {
      title: 'Oversight',
      items: [
        { label: 'Cohort progress', icon: 'chart', soon: true },
        { label: 'Audit log', icon: 'clock', soon: true },
      ],
    },
    SETTINGS,
  ],
}

export function navFor(role: Role) {
  return BY_ROLE[role]
}
