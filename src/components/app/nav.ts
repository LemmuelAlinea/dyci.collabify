import type { IconName } from '../ui/Icon'
import type { Role } from '../../lib/types'
import { settingsPathFor, type Workplace } from '../../lib/workplace'

export type NavItem = {
  label: string
  icon: IconName
  to?: string
  /** Phase 2. Rendered as a disabled row with a "Soon" tag. */
  soon?: boolean
  /** Named counter the shell fills in live, e.g. unread messages. */
  badge?: 'messages'
  /** Match this path exactly, so a parent page is not lit on its children. */
  end?: boolean
  /**
   * A General row that belongs to whichever space is in view: the path under
   * `/general/spaces/<id>/`, or `''` for the space itself. The shell fills the
   * id in. Without a space in view the row falls back to `to`, and a row with
   * no `to` is left out entirely — there is nothing for it to point at.
   */
  space?: string
}

export type NavGroup = { title: string; items: NavItem[] }

/**
 * The two rows every role carries.
 *
 * "Your data" is where somebody exercises a right under the Data Privacy Act.
 * It sits in Account rather than anywhere role-specific because a professor
 * asking what is held about them is exactly the same right as a student's, and
 * because a page the privacy policy points at has to be findable without
 * reading the privacy policy.
 *
 * The queue for whoever *answers* those requests is deliberately not here. The
 * handler is one named professor, this list is static per role, and giving
 * every professor a permanently empty screen would be worse than the link
 * living on the handler's own request page — which is where it does.
 */
const SETTINGS: NavGroup = {
  title: 'Account',
  items: [
    { label: 'Settings', icon: 'settings', to: '/settings' },
  ],
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
        // The two queues that wait on the professor sit together.
        { label: 'Submissions', icon: 'upload', to: '/professor/submissions' },
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
        // Admins are the fallback handler while nobody is named, so this row
        // is never dead for them the way it would be for most professors.
        { label: 'Privacy requests', icon: 'shield', to: '/admin/privacy' },
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

/**
 * General splits by reach, because that is the only line a reader can draw
 * without opening the pages. Five rows answer questions about the space named
 * in the picker directly above them; two answer questions about everything the
 * account touches. Mixing the two under one heading, which is what this rail
 * used to do, made "Projects" look like it belonged to the space in view when
 * it lists projects from every space.
 *
 * A project holds its own tasks, files, members and positions, so none of those
 * are rows here.
 */
export const GENERAL_NAV: NavGroup[] = [
  {
    title: 'This space',
    items: [
      // Widest to narrowest: the space itself, then how its people are split,
      // then who they are. Reports and Archive read the space back rather than
      // run it, so they come last.
      // Dashboard is the only one that keeps a space-less path, because it is
      // the way back: bare /general lands on the last space that was open.
      { label: 'Dashboard', icon: 'board', space: '', to: '/general', end: true },
      { label: 'Teams', icon: 'users', space: 'teams' },
      { label: 'Members', icon: 'user', space: 'members' },
      { label: 'Reports', icon: 'chart', space: 'reports' },
      { label: 'Archive', icon: 'archive', space: 'archive' },
    ],
  },
  {
    // Both of these cross space boundaries: the projects page lists every
    // project the account joined, and a conversation is not owned by a space.
    title: 'All spaces',
    items: [
      { label: 'Projects', icon: 'kanban', to: '/general/projects' },
      { label: 'Messages', icon: 'message', to: '/general/messages', badge: 'messages' },
    ],
  },
  SETTINGS,
]

/** An account with no Education role only ever sees General's rail. */
export function navForWorkplace(workplace: Workplace, role: Role | null): NavGroup[] {
  const groups = workplace === 'general' || !role ? GENERAL_NAV : BY_ROLE[role]
  const settingsPath = settingsPathFor(workplace, role)
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.to === '/settings' ? { ...item, to: settingsPath } : item,
    ),
  }))
}
