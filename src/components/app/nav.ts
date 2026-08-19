import type { IconName } from '../ui/Icon'
import type { Role } from '../../lib/types'

export type NavItem = {
  label: string
  icon: IconName
  to?: string
  /** Phase 2. Rendered as a disabled row with a "Soon" tag. */
  soon?: boolean
  /** Named counter the shell fills in live, e.g. unread messages. */
  badge?: 'messages'
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
      // Classes hold groups, groups hold projects, projects hold the tasks —
      // so the spine reads widest to narrowest, and My tasks sits against
      // Projects rather than behind Messages. Talking comes after working.
      items: [
        { label: 'Dashboard', icon: 'board', to: '/student' },
        { label: 'Classes', icon: 'folder', to: '/student/classes' },
        { label: 'Groups', icon: 'users', to: '/student/groups' },
        { label: 'Projects', icon: 'kanban', to: '/student/projects' },
        { label: 'My tasks', icon: 'check', to: '/student/tasks' },
        { label: 'Calendar', icon: 'calendar', to: '/student/calendar' },
        { label: 'Files', icon: 'folder', to: '/student/files' },
        { label: 'Messages', icon: 'message', to: '/student/messages', badge: 'messages' },
      ],
    },
    {
      // Everything unbuilt, in one place. Scattered through the live rows they
      // read as things that are broken rather than things that are coming.
      title: 'Coming soon',
      items: [
        { label: 'Milestones', icon: 'target', soon: true },
        { label: 'Discussion', icon: 'message', soon: true },
      ],
    },
    SETTINGS,
  ],
  professor: [
    {
      title: 'Teaching',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/professor' },
        { label: 'Classes', icon: 'folder', to: '/professor/classes' },
        { label: 'Groups', icon: 'users', to: '/professor/groups' },
        { label: 'Projects', icon: 'kanban', to: '/professor/projects' },
        { label: 'Messages', icon: 'message', to: '/professor/messages', badge: 'messages' },
        { label: 'Calendar', icon: 'calendar', to: '/professor/calendar' },
        { label: 'Files', icon: 'folder', to: '/professor/files' },
        { label: 'Reassignments', icon: 'refresh', to: '/professor/reassignments' },
      ],
    },
    {
      title: 'Course documents',
      items: [
        { label: 'Curriculum', icon: 'chart', to: '/professor/curriculum' },
        { label: 'Syllabi', icon: 'file', to: '/professor/syllabi' },
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
