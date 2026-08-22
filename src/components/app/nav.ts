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
        { label: 'Messages', icon: 'message', to: '/student/messages', badge: 'messages' },
      ],
    },
    SETTINGS,
  ],
  professor: [
    // Classes hold groups, groups hold projects: the spine reads widest to
    // narrowest. Then the things that arrive on their own schedule — a date, a
    // request, a message — and only then the pages that read the work back.
    {
      title: 'Teaching',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/professor' },
        { label: 'Classes', icon: 'folder', to: '/professor/classes' },
        { label: 'Groups', icon: 'users', to: '/professor/groups' },
        { label: 'Projects', icon: 'kanban', to: '/professor/projects' },
      ],
    },
    {
      title: 'Day to day',
      items: [
        { label: 'Calendar', icon: 'calendar', to: '/professor/calendar' },
        { label: 'Reassignments', icon: 'refresh', to: '/professor/reassignments' },
        { label: 'Messages', icon: 'message', to: '/professor/messages', badge: 'messages' },
      ],
    },
    {
      // Reading the work back, rather than running it. Analytics answers what is
      // happening now; reports are the record of it to hand somebody else.
      title: 'Insights',
      items: [
        { label: 'Analytics', icon: 'chart', to: '/professor/analytics' },
        { label: 'Reports', icon: 'file', to: '/professor/reports' },
      ],
    },
    {
      title: 'Course documents',
      items: [
        { label: 'Curriculum', icon: 'target', to: '/professor/curriculum' },
        { label: 'Syllabi', icon: 'file', to: '/professor/syllabi' },
      ],
    },
    SETTINGS,
  ],
  admin: [
    {
      title: 'Program',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/admin' },
        { label: 'Professor approvals', icon: 'shield', to: '/admin/approvals' },
        { label: 'Accounts', icon: 'users', to: '/admin/accounts' },
        { label: 'Sections', icon: 'folder', soon: true },
      ],
    },
    {
      title: 'Oversight',
      items: [
        { label: 'Cohort progress', icon: 'chart', soon: true },
        { label: 'Audit log', icon: 'clock', to: '/admin/audit' },
      ],
    },
    SETTINGS,
  ],
}

export function navFor(role: Role) {
  return BY_ROLE[role]
}
