import type { IconName } from '../ui/Icon'
import type { AccountStatus, Role } from '../../lib/types'
import { paths } from '../../lib/paths'

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
}

export type NavGroup = { title: string; items: NavItem[] }

/**
 * One rail, for everyone.
 *
 * There used to be a rail per workplace — Education's and General's — chosen
 * by which URL you were under. Now there is one workplace and one rail: it
 * opens on the spine every account shares (Main), then the reader's own
 * spaces and projects (added by `SideNav`, not here — they are live data, not
 * a static list), then whatever their role adds on top. A professor is not
 * "in General with extra rows"; they are one account whose rail happens to be
 * longer than a student's.
 */
const MAIN: NavGroup = {
  title: 'Main',
  items: [
    { label: 'Home', icon: 'board', to: paths.home, end: true },
    { label: 'My tasks', icon: 'check', to: paths.tasks },
    { label: 'Calendar', icon: 'calendar', to: paths.calendar },
    { label: 'Messages', icon: 'message', to: paths.messages, badge: 'messages' },
  ],
}

/**
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
const ACCOUNT: NavGroup = {
  title: 'Account',
  items: [{ label: 'Settings', icon: 'settings', to: paths.settings }],
}

/**
 * Classes hold groups, groups hold class projects: the spine reads widest to
 * narrowest. A student also keeps their own record here, since it is theirs to
 * keep rather than theirs to do.
 */
function classesGroup(role: Role): NavGroup {
  return {
    title: 'Classes',
    items: [
      // `end`: a class page lights its own row under Your spaces, not this one too.
      { label: 'Classes', icon: 'folder', to: paths.classes, end: true },
      { label: 'Groups', icon: 'users', to: paths.groups },
      { label: 'Class projects', icon: 'kanban', to: paths.classProjects },
      ...(role === 'student'
        ? [{ label: 'Your record', icon: 'file' as IconName, to: paths.record }]
        : []),
    ],
  }
}

/**
 * The two queues that wait on a professor, then the pages that read the work
 * back rather than run it, then the documents a class hangs off.
 */
const TEACHING: NavGroup = {
  title: 'Teaching',
  items: [
    { label: 'Submissions', icon: 'upload', to: paths.submissions },
    { label: 'Reassignments', icon: 'refresh', to: paths.reassignments },
    { label: 'Analytics', icon: 'chart', to: paths.analytics },
    { label: 'Reports', icon: 'file', to: paths.teachingReports },
    { label: 'Syllabi', icon: 'file', to: paths.syllabi },
    { label: 'Curriculum', icon: 'target', to: paths.curriculum },
  ],
}

/**
 * What the office sets up, who is in the program, and the program read back
 * as figures — the same three bands the admin rail always had.
 */
const ADMIN: NavGroup = {
  title: 'Admin',
  items: [
    { label: 'Faculty approvals', icon: 'shield', to: paths.admin.approvals },
    { label: 'Accounts', icon: 'users', to: paths.admin.accounts },
    { label: 'Audit log', icon: 'clock', to: paths.admin.audit },
    // Admins are the fallback handler while nobody is named, so this row is
    // never dead for them the way it would be for most faculty.
    { label: 'Privacy requests', icon: 'shield', to: paths.admin.privacy },
    { label: 'Notices', icon: 'bell', to: paths.admin.notices },
    { label: 'Sections', icon: 'kanban', to: paths.admin.sections },
    { label: 'Library', icon: 'file', to: paths.admin.library },
    { label: 'Classes', icon: 'folder', to: paths.admin.classes },
    { label: 'Faculty', icon: 'user', to: paths.admin.faculty },
    { label: 'Cohort', icon: 'chart', to: paths.admin.cohort },
  ],
}

/**
 * A student nobody has let in yet. Every other row would open onto an empty
 * page, so the rail offers only Home, whose one job for them is joining a
 * class.
 */
const MAIN_WAITING: NavGroup = {
  title: 'Main',
  items: [{ label: 'Home', icon: 'board', to: paths.home, end: true }],
}

/**
 * The static half of the rail — everything that isn't the reader's own
 * spaces and projects, which `SideNav` adds between Main and whatever role
 * group comes next because those lists are live data, not a fixed menu.
 *
 * `admitted` narrows only a student's Main group, to just Home; faculty and
 * admins are admitted by approval, which the route guard has already
 * checked before this ever renders. An account with no role yet, or one that
 * isn't active, has nothing to open but Settings — every other page here
 * needs an admitted account.
 */
export function navFor(
  profile: { role: Role | null; status: AccountStatus } | null,
  admitted: boolean,
): NavGroup[] {
  if (!profile || profile.status !== 'active' || !profile.role) return [ACCOUNT]

  const { role } = profile
  if (role === 'student' && !admitted) return [MAIN_WAITING, ACCOUNT]

  const roleGroups: NavGroup[] =
    role === 'admin' ? [ADMIN] : role === 'faculty' ? [classesGroup(role), TEACHING] : [classesGroup(role)]

  return [MAIN, ...roleGroups, ACCOUNT]
}
