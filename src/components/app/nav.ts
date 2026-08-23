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
    // Same shape as the professor's rail: the spine first, then what arrives on
    // its own schedule, then the pages that read the work back. Eight rows
    // under one heading said nothing about what belonged where.
    {
      title: 'Workspace',
      // Classes hold groups, groups hold projects, projects hold the tasks —
      // widest to narrowest.
      items: [
        { label: 'Dashboard', icon: 'board', to: '/student' },
        { label: 'Classes', icon: 'folder', to: '/student/classes' },
        { label: 'Groups', icon: 'users', to: '/student/groups' },
        { label: 'Projects', icon: 'kanban', to: '/student/projects' },
      ],
    },
    {
      title: 'Day to day',
      // What is on you now, when it is due, and who is asking. My tasks leads:
      // it is the only one of the three that is work rather than about work.
      items: [
        { label: 'My tasks', icon: 'check', to: '/student/tasks' },
        { label: 'Calendar', icon: 'calendar', to: '/student/calendar' },
        { label: 'Messages', icon: 'message', to: '/student/messages', badge: 'messages' },
      ],
    },
    {
      // Yours to keep, rather than yours to do.
      title: 'Your record',
      items: [{ label: 'Reports', icon: 'file', to: '/student/reports' }],
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
    // The same three bands as the other two rails: what the office sets up,
    // who is in the program, and the program read back as figures.
    {
      title: 'Program',
      items: [
        { label: 'Dashboard', icon: 'board', to: '/admin' },
        { label: 'Notices', icon: 'bell', to: '/admin/notices' },
        { label: 'Sections', icon: 'kanban', to: '/admin/sections' },
        { label: 'Library', icon: 'file', to: '/admin/library' },
      ],
    },
    {
      // Who is in the program, and the record of what was done to their
      // accounts. The audit log belongs with the people it is about.
      title: 'People',
      items: [
        { label: 'Professor approvals', icon: 'shield', to: '/admin/approvals' },
        { label: 'Accounts', icon: 'users', to: '/admin/accounts' },
        { label: 'Audit log', icon: 'clock', to: '/admin/audit' },
      ],
    },
    {
      // Counts, never content: the chair reads figures and asks the professor
      // for anything inside a class.
      title: 'Oversight',
      items: [
        { label: 'Classes', icon: 'folder', to: '/admin/classes' },
        { label: 'Faculty', icon: 'user', to: '/admin/faculty' },
        { label: 'Cohort', icon: 'chart', to: '/admin/cohort' },
      ],
    },
    SETTINGS,
  ],
}

export function navFor(role: Role) {
  return BY_ROLE[role]
}
