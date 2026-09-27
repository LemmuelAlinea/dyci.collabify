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
 * A pattern's captured trailing group, if any, read back from `original`
 * instead of the (lowercased) string that was actually matched.
 *
 * Every group in `CLASS_SIDE` and the General allowlist below captures the
 * tail of the string it matched against, so its original-case text is always
 * the same number of characters off the end of `original` — this is what
 * keeps a class or project id's own casing intact while the route word in
 * front of it (`/Classes`, `/STUDENT`, …) is still recognised regardless of
 * how it was cased.
 */
function withOriginalCase(m: RegExpMatchArray, original: string): RegExpMatchArray {
  if (m[1] === undefined) return m
  const clone = [...m] as RegExpMatchArray
  clone[1] = original.slice(original.length - m[1].length)
  return clone
}

/**
 * Where an old URL lives now, or null if it isn't an old URL. Pathname only;
 * the caller keeps the query string and hash.
 *
 * Prefixes (`/general`, `/student`, `/professor`, `/admin`, `/education`) are
 * matched case-insensitively, against a lowercased copy kept only for
 * matching — `path` itself, and everything sliced from it, keeps whatever
 * casing the link actually had.
 */
export function legacyPath(pathname: string, _role: LegacyRole): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const lower = path.toLowerCase()

  if (lower === '/admin' || /^\/education(\/|$)/.test(lower)) return '/home'
  if (lower === '/admin/settings') return '/settings'

  if (/^\/general(\/.*)?$/.test(lower)) {
    const rest = path.length > '/general'.length ? path.slice('/general'.length) : ''
    const restLower = rest.toLowerCase()
    if (rest === '') return '/home'
    if (restLower === '/settings') return '/settings'
    // Everything else General ever linked to lives at the same words, flat —
    // spaces, projects and messages never got their own class-side rename.
    // Anything not on that short list (old space-less /teams links included)
    // has no home to guess at, so it goes to /home rather than a 404.
    if (/^\/(spaces|projects|messages)(\/|$)/.test(restLower)) return rest
    return '/home'
  }

  const section = lower.match(/^\/(student|professor)(\/.*)?$/)
  if (!section) return null
  const prefixLength = 1 + section[1].length
  const rest = path.length > prefixLength ? path.slice(prefixLength) : ''
  const restLower = rest.toLowerCase()
  if (rest === '') return '/home'
  if (restLower === '/settings') return '/settings'
  // The prefix says whose page it was, whoever follows the link now.
  const who: LegacyRole = section[1] === 'professor' ? 'professor' : 'student'
  for (const [pattern, to] of CLASS_SIDE) {
    const m = restLower.match(pattern)
    if (m) return to(withOriginalCase(m, rest), who)
  }
  return '/home'
}
