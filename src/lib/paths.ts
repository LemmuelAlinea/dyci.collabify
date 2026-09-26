/**
 * Every URL in the app, in one place.
 *
 * There used to be a /student, a /professor and a /general copy of most
 * pages, and a link had to know which one it was in. Now there is one of each,
 * and pages that differ by role decide that behind the route (see RoleSwitch),
 * not in the URL.
 */
export const paths = {
  home: '/home',
  tasks: '/tasks',
  calendar: '/calendar',
  messages: '/messages',
  conversation: (id: string) => `/messages/${id}`,
  settings: '/settings',

  spaces: '/spaces',
  spacesArchive: '/spaces/archive',
  space: (id: string) => `/spaces/${id}`,
  spaceMembers: (id: string) => `/spaces/${id}/members`,
  spaceTeams: (id: string) => `/spaces/${id}/teams`,
  spaceTeamsArchive: (id: string) => `/spaces/${id}/teams/archive`,
  spaceArchive: (id: string) => `/spaces/${id}/archive`,
  spaceReports: (id: string) => `/spaces/${id}/reports`,

  projects: '/projects',
  project: (id: string) => `/projects/${id}`,
  projectArchive: (id: string) => `/projects/${id}/archive`,

  classes: '/classes',
  class: (id: string) => `/classes/${id}`,
  groups: '/groups',
  group: (id: string) => `/groups/${id}`,
  classProjects: '/class-projects',
  classProject: (id: string) => `/class-projects/${id}`,
  record: '/record',

  submissions: '/teaching/submissions',
  reassignments: '/teaching/reassignments',
  analytics: '/teaching/analytics',
  teachingReports: '/teaching/reports',
  syllabi: '/teaching/syllabi',
  syllabus: (id: string) => `/teaching/syllabi/${id}`,
  curriculum: '/teaching/curriculum',

  privacyRequest: '/privacy/request',
  privacyQueue: '/privacy/queue',

  admin: {
    approvals: '/admin/approvals',
    notices: '/admin/notices',
    sections: '/admin/sections',
    library: '/admin/library',
    classes: '/admin/classes',
    faculty: '/admin/faculty',
    cohort: '/admin/cohort',
    audit: '/admin/audit',
    privacy: '/admin/privacy',
    accounts: '/admin/accounts',
  },
} as const

type LegacyRole = 'student' | 'professor' | 'admin' | null

/** Old role-section paths, after the prefix, onto new ones. */
const CLASS_SIDE: [RegExp, (m: RegExpMatchArray, role: LegacyRole) => string][] = [
  [/^\/classes(\/[^/]+)?$/, (m) => `/classes${m[1] ?? ''}`],
  [/^\/groups(\/[^/]+)?$/, (m) => `/groups${m[1] ?? ''}`],
  [/^\/projects(\/[^/]+)?$/, (m) => `/class-projects${m[1] ?? ''}`],
  [/^\/tasks$/, () => '/tasks'],
  [/^\/calendar$/, () => '/calendar'],
  [/^\/messages(\/[^/]+)?$/, (m) => `/messages${m[1] ?? ''}`],
  [/^\/reports$/, (_m, role) => (role === 'professor' ? '/teaching/reports' : '/record')],
  [/^\/(submissions|reassignments|analytics|curriculum)$/, (m) => `/teaching/${m[1]}`],
  [/^\/syllabi(\/[^/]+)?$/, (m) => `/teaching/syllabi${m[1] ?? ''}`],
  [/^\/privacy$/, () => '/privacy/queue'],
]

/**
 * Where an old URL lives now, or null if it isn't an old URL. Pathname only;
 * the caller keeps the query string and hash.
 */
export function legacyPath(pathname: string, _role: LegacyRole): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  if (path === '/admin' || /^\/education(\/|$)/.test(path)) return '/home'
  if (path === '/admin/settings') return '/settings'

  const general = path.match(/^\/general(\/.*)?$/)
  if (general) {
    const rest = general[1] ?? ''
    if (rest === '') return '/home'
    if (rest === '/settings') return '/settings'
    return rest
  }

  const section = path.match(/^\/(student|professor)(\/.*)?$/)
  if (!section) return null
  const rest = section[2] ?? ''
  if (rest === '') return '/home'
  if (rest === '/settings') return '/settings'
  // The prefix says whose page it was, whoever follows the link now.
  const who: LegacyRole = section[1] === 'professor' ? 'professor' : 'student'
  for (const [pattern, to] of CLASS_SIDE) {
    const m = rest.match(pattern)
    if (m) return to(m, who)
  }
  return '/home'
}
