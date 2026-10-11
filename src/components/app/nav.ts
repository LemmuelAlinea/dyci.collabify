import type { IconName } from '../ui/Icon'
import { canTeach } from '../../lib/access'
import type { AccessProfile, Membership } from '../../lib/access'
import type { Role } from '../../lib/types'
import { paths } from '../../lib/paths'

export type NavItem = {
  label: string
  icon: IconName
  to?: string
  /** Phase 2. Rendered as a disabled row with a "Soon" tag. */
  soon?: boolean
  /** Named counter the shell fills in live: unread messages plus invitations waiting. */
  badge?: 'inbox'
  /** Match this path exactly, so a parent page is not lit on its children. */
  end?: boolean
}

export type NavGroup = {
  title: string
  items: NavItem[]
  /** Live rows `SideNav` fills in above `items`: the reader's own classes, spaces or recent projects. */
  live?: 'classes' | 'spaces' | 'recent'
  /** The page listing all of them, linked in small type under the live rows. */
  more?: { to: string; label: string }
  /** Leave the whole section out until there is at least one live row. */
  hideWhenEmpty?: boolean
  /** Spaces lists the reader's classes too â€” for anyone with no Classes section. */
  withClasses?: boolean
  /** The header folds the section away, live rows included. Remembered per device. */
  collapsible?: boolean
}


/**
 * One rail, for everyone.
 *
 * It opens on the spine every account shares (Overview, then Work), then the
 * reader's own classes, spaces and recent projects â€” live data `SideNav`
 * fills in, but placed here so the order lives in one file â€” then whatever
 * their role adds on top. Faculty and admins open on Spaces instead, since
 * their own work comes before the program's; students keep their classes on
 * top and find Spaces after them. A section someone cannot use is not shown
 * to them: faculty the admin has not let teach get no Classes, Teaching or
 * Resources, and an account that cannot make a space of its own sees Spaces
 * only once somebody has invited it into one.
 */
const OVERVIEW: NavGroup = {
  title: 'Overview',
  collapsible: true,
  items: [
    { label: 'Home', icon: 'board', to: paths.home, end: true },
    { label: 'Inbox', icon: 'mail', to: paths.inbox, badge: 'inbox' },
    { label: 'Calendar', icon: 'calendar', to: paths.calendar },
  ],
}

/**
 * The pages that hold the work itself. Projects is one page for class and
 * work projects alike; Groups only exists for someone in classes.
 */
function workGroup(groups: boolean): NavGroup {
  return {
    title: 'Work',
    collapsible: true,
    items: [
      { label: 'My tasks', icon: 'check', to: paths.tasks },
      { label: 'Projects', icon: 'kanban', to: paths.projects },
      ...(groups ? [{ label: 'Groups', icon: 'users' as IconName, to: paths.groups }] : []),
      { label: 'Meetings', icon: 'video', to: paths.meetings },
    ],
  }
}

/**
 * Trash sits in Account because it is the one list every account has: what
 * you threw away is yours, whatever your role, so the row never goes away.
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
 * living on the handler's own request page â€” which is where it does.
 */
const SETTINGS: NavItem = { label: 'Settings', icon: 'settings', to: paths.settings }
const TRASH: NavItem = { label: 'Trash', icon: 'trash', to: paths.trash }

const ACCOUNT: NavGroup = {
  title: 'Account',
  collapsible: true,
  items: [SETTINGS, TRASH],
}

/**
 * Archive sits beside Trash for students and faculty: one page for everything
 * they put away, sectioned by what their role lets them archive. An admin runs
 * the program rather than its classes and work, so their Archive is the
 * program's: sections, published syllabi and curricula.
 */
const ACCOUNT_WITH_ARCHIVE: NavGroup = {
  title: 'Account',
  collapsible: true,
  items: [SETTINGS, { label: 'Archive', icon: 'archive', to: paths.archive }, TRASH],
}

const ADMIN_ACCOUNT: NavGroup = {
  title: 'Account',
  collapsible: true,
  items: [SETTINGS, { label: 'Archive', icon: 'archive', to: paths.admin.archive }, TRASH],
}

/** The reader's classes. Groups and projects sit under Work. */
const CLASSES: NavGroup = {
  title: 'Classes',
  live: 'classes',
  collapsible: true,
  more: { to: paths.classes, label: 'View all classes' },
  items: [],
}

/**
 * Work spaces. Someone with a Classes section finds their classes there;
 * anyone without one â€” faculty who do not teach, admins â€” finds them here,
 * `withClasses`, the same way their Spaces page lists them.
 */
function spacesGroup(hideWhenEmpty: boolean, withClasses = false): NavGroup {
  return {
    title: 'Spaces',
    live: 'spaces',
    collapsible: true,
    more: { to: paths.spaces, label: 'All spaces' },
    hideWhenEmpty,
    withClasses,
    items: [],
  }
}

/**
 * The projects the reader touched last, class and work alike. No "All" link:
 * Projects under Work is that page.
 */
const QUICK_ACCESS: NavGroup = {
  title: 'Quick access',
  live: 'recent',
  collapsible: true,
  hideWhenEmpty: true,
  items: [],
}

/**
 * The two queues that wait on a professor, then the pages that read the work
 * back rather than run it.
 */
const TEACHING: NavGroup = {
  title: 'Teaching',
  collapsible: true,
  items: [
    { label: 'Submissions', icon: 'upload', to: paths.submissions },
    { label: 'Reassignments', icon: 'refresh', to: paths.reassignments },
    { label: 'Analytics', icon: 'chart', to: paths.analytics },
    { label: 'Reports', icon: 'file', to: paths.teachingReports },
  ],
}

/**
 * The documents a class hangs off, for whoever teaches. A student's own
 * record sits here too: it is theirs to keep rather than theirs to do.
 */
function resourcesGroup(role: Role): NavGroup {
  return {
    title: 'Resources',
    collapsible: true,
    items:
      role === 'student'
        ? [{ label: 'Your record', icon: 'file', to: paths.record }]
        : [
            { label: 'Syllabi', icon: 'file', to: paths.syllabi },
            { label: 'Curriculum', icon: 'target', to: paths.curriculum },
          ],
  }
}

/**
 * What the office sets up, who is in the program, and the program read back
 * as figures â€” the same three bands the admin rail always had.
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
    { label: 'Syllabi', icon: 'file', to: paths.admin.syllabi },
    { label: 'Curriculum', icon: 'target', to: paths.admin.curriculum },
    { label: 'Classes', icon: 'folder', to: paths.admin.classes },
    { label: 'Faculty', icon: 'user', to: paths.admin.faculty },
    { label: 'Cohort', icon: 'chart', to: paths.admin.cohort },
  ],
}

/** An admin in nothing yet, with an invitation to answer. */
const ADMIN_INVITED: NavGroup = {
  title: 'Main',
  items: [
    { label: 'Home', icon: 'board', to: paths.home, end: true },
    { label: 'Inbox', icon: 'mail', to: paths.inbox, badge: 'inbox' },
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
 * The rail for one account, top to bottom.
 *
 * `admitted` narrows only a student's Main group, to just Home; faculty and
 * admins are admitted by approval, which the route guard has already
 * checked before this ever renders. An account with no role yet, or one that
 * isn't active, has nothing to open but Settings â€” every other page here
 * needs an admitted account.
 *
 * Spaces hides while empty for anyone who cannot open a class â€” students,
 * faculty who do not teach, admins. Teaching faculty keep it, empty or not,
 * because making spaces is part of their job.
 *
 * An admin runs the program rather than sitting in it, so until someone
 * invites them into a class, space or project their rail is Admin and
 * Account. Once they belong to something they get the same rail as faculty
 * who do not teach, with Admin above Account. `membership` still loading
 * counts as belonging to nothing, so Overview never flashes in and out.
 */
export function navFor(
  profile: AccessProfile,
  admitted: boolean,
  membership?: Membership,
): NavGroup[] {
  if (!profile || profile.status !== 'active' || !profile.role) return [ACCOUNT]

  const { role } = profile
  if (role === 'admin') {
    if (!membership?.inClass && !membership?.hasWork) {
      // Invited but not yet in: the Inbox is where they answer.
      return membership?.invited ? [ADMIN_INVITED, ADMIN, ADMIN_ACCOUNT] : [ADMIN, ADMIN_ACCOUNT]
    }
    return [spacesGroup(true, true), OVERVIEW, workGroup(false), QUICK_ACCESS, ADMIN, ADMIN_ACCOUNT]
  }
  if (role === 'student') {
    if (!admitted) return [MAIN_WAITING, ACCOUNT]
    // A student cannot make a space; work arrives by invitation, and only
    // then does Spaces earn a place, after their classes.
    return [
      OVERVIEW,
      workGroup(true),
      CLASSES,
      ...(membership?.hasWork ? [spacesGroup(true)] : []),
      QUICK_ACCESS,
      resourcesGroup(role),
      ACCOUNT_WITH_ARCHIVE,
    ]
  }
  if (canTeach(profile)) {
    return [
      spacesGroup(false),
      OVERVIEW,
      workGroup(true),
      CLASSES,
      QUICK_ACCESS,
      TEACHING,
      resourcesGroup(role),
      ACCOUNT_WITH_ARCHIVE,
    ]
  }
  return [spacesGroup(true, true), OVERVIEW, workGroup(false), QUICK_ACCESS, ACCOUNT_WITH_ARCHIVE]
}
