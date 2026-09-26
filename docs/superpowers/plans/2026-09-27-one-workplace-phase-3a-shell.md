# One workplace, phase 3a: one shell — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sidebar, one home, short routes, and one Messages / My tasks / Calendar for everybody. The Education/General split disappears from what people see. Old URLs keep working by redirecting.

**Architecture:** One module, `src/lib/paths.ts`, owns every URL. A pure `legacyPath()` maps the old `/student`, `/professor` and `/general` URLs onto the new ones, and a catch-all route redirects through it. Pages that differ by role sit behind one route each and a `RoleSwitch`. The rail comes from one `navFor()`. The General navigation context is on for every admitted account, and its space list now includes class spaces, so a class shows in **Your spaces**. The class page itself doesn't change until 3b. Merged lists share a small `ScopeFilter` (All · Classes · Work) kept in the URL.

**Tech stack:** React 19 + TypeScript + Vite + React Router + Tailwind v4 tokens, Supabase/Postgres (SQL via `node scripts/db.mjs`), Vitest (node env, `src/**/*.test.ts`, pure functions only).

**Spec:** `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, section 2.

**Owner decisions (2026-09-27):**
- Phase 3 ships as two plans. This is 3a. 3b turns the class page into the education space page (tabs), gives co-teachers a screen and the class chat, and makes New space ask Education or Work.
- Home is **stacked**: today's role dashboard on top, unchanged, then a **Your work** section with the General panels. Each part shows only when the person has something there.
- Messages, My tasks and Calendar each become **one list with an All · Classes · Work filter**.

## Global constraints

- Don't change the visual design. Reuse the existing components (`DirectoryHero`, `DashboardSummary`, `Bento`, `DashSection`, the General panels, `LiveGroup`/`StaticRow`) and tokens. No new colours and no raw hex. Education badges use the amber ramp, work badges the navy ramp.
- Every URL comes from `src/lib/paths.ts`. After Task 5, no source file outside `paths.ts` and its test contains a string literal starting with `/student`, `/professor` or `/general`.
- Old URLs (`/student/...`, `/professor/...`, `/general/...`, `/admin`, `/admin/settings`) redirect to their new home with the query string and hash kept. Nobody hits a 404 from a bookmark.
- The role value stays `'professor'`. The UI says Faculty.
- Copy rules (CLAUDE.md): sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Reduced motion stays honoured. Desktop layout comes first, then tablet, then phone.
- `supabase/*.sql` stays idempotent. After changing SQL, re-run `supabase/anon-lockdown.sql` last, then its test.
- Never read or print `.env.local`, `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`. Don't stage `desktop.ini`, `docs/redesign/`, `.superpowers/`, `*.patch`, `graphify-out`, `verify-before-main.md` or `supabase/.temp/`.
- `npm run build` and `npx vitest run` pass before a task is called done. Commits use a heredoc message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push; the controller pushes.

## Route map (the single source for every task)

| New | Page | Old |
|---|---|---|
| `/home` | Home (stacked; by role) | `/student`, `/professor`, `/admin`, `/general` |
| `/tasks` | My tasks (merged) | `/student/tasks` |
| `/calendar` | Calendar (merged) | `/student/calendar`, `/professor/calendar` |
| `/messages`, `/messages/:conversationId` | Messages (merged) | `/{student,professor,general}/messages[/:id]` |
| `/settings` | Settings | `/{student,professor,admin,general}/settings` |
| `/spaces`, `/spaces/archive` | SpacePicker (work spaces, plus a Classes section) | `/general/spaces[...]` |
| `/spaces/:spaceId[/members\|/teams\|/teams/archive\|/archive\|/reports]` | work-space pages (class spaces redirect to their class) | `/general/spaces/...` |
| `/projects`, `/projects/:projectId`, `/projects/:projectId/archive` | General projects | `/general/projects[...]` |
| `/classes`, `/classes/:classId` | Student/Professor classes (by role) | `/{student,professor}/classes[/:id]` |
| `/groups`, `/groups/:groupId` | Student/Professor groups; GroupDetail (by role) | `/{student,professor}/groups[/:id]` |
| `/class-projects`, `/class-projects/:projectId` | Student/Professor projects; ProjectDetail (by role) | `/{student,professor}/projects[/:id]` |
| `/record` | Student reports | `/student/reports` |
| `/teaching/submissions` · `/teaching/reassignments` · `/teaching/analytics` · `/teaching/reports` · `/teaching/syllabi[/:resourceId]` · `/teaching/curriculum` | faculty pages | `/professor/{submissions,reassignments,analytics,reports,syllabi[/:id],curriculum}` |
| `/privacy/request` | unchanged | — |
| `/privacy/queue` | PrivacyQueue (handler) | `/professor/privacy` |
| `/admin/*` (not `/admin` itself, not `/admin/settings`) | unchanged admin pages | — |

---

### Task 1: `paths.ts` and `legacyPath`

**Files:**
- Create: `src/lib/paths.ts`, `src/lib/paths.test.ts`

**Interfaces:**
- Produces: `paths` (object below) and `legacyPath(pathname: string, role: 'student' | 'professor' | 'admin' | null): string | null`. `legacyPath` returns the new pathname for an old one, or `null` when the path isn't legacy.

- [ ] **Step 1: Write the failing test** — `src/lib/paths.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { legacyPath, paths } from './paths'

describe('paths', () => {
  it('builds the short routes', () => {
    expect(paths.home).toBe('/home')
    expect(paths.conversation('c1')).toBe('/messages/c1')
    expect(paths.space('s1')).toBe('/spaces/s1')
    expect(paths.spaceReports('s1')).toBe('/spaces/s1/reports')
    expect(paths.project('p1')).toBe('/projects/p1')
    expect(paths.classProject('p1')).toBe('/class-projects/p1')
    expect(paths.class('k1')).toBe('/classes/k1')
    expect(paths.group('g1')).toBe('/groups/g1')
    expect(paths.syllabus('r1')).toBe('/teaching/syllabi/r1')
    expect(paths.admin.approvals).toBe('/admin/approvals')
  })
})

describe('legacyPath', () => {
  it('sends every old home to /home', () => {
    for (const old of ['/student', '/professor', '/general', '/admin', '/student/', '/education/enter']) {
      expect(legacyPath(old, 'student')).toBe('/home')
    }
  })

  it('sends every old settings page to /settings', () => {
    for (const old of ['/student/settings', '/professor/settings', '/admin/settings', '/general/settings']) {
      expect(legacyPath(old, null)).toBe('/settings')
    }
  })

  it('drops the General prefix', () => {
    expect(legacyPath('/general/spaces/s1/members', null)).toBe('/spaces/s1/members')
    expect(legacyPath('/general/projects/p1', null)).toBe('/projects/p1')
    expect(legacyPath('/general/messages/c1', null)).toBe('/messages/c1')
  })

  it('maps the class side', () => {
    expect(legacyPath('/student/classes/k1', 'student')).toBe('/classes/k1')
    expect(legacyPath('/professor/groups/g1', 'professor')).toBe('/groups/g1')
    expect(legacyPath('/student/projects', 'student')).toBe('/class-projects')
    expect(legacyPath('/professor/projects/p1', 'professor')).toBe('/class-projects/p1')
    expect(legacyPath('/student/tasks', 'student')).toBe('/tasks')
    expect(legacyPath('/professor/calendar', 'professor')).toBe('/calendar')
    expect(legacyPath('/student/messages/c1', 'student')).toBe('/messages/c1')
  })

  it('splits the two reports pages by whose they were', () => {
    expect(legacyPath('/student/reports', 'student')).toBe('/record')
    expect(legacyPath('/professor/reports', 'professor')).toBe('/teaching/reports')
  })

  it('moves the faculty pages under /teaching', () => {
    expect(legacyPath('/professor/submissions', 'professor')).toBe('/teaching/submissions')
    expect(legacyPath('/professor/syllabi/r1', 'professor')).toBe('/teaching/syllabi/r1')
    expect(legacyPath('/professor/curriculum', 'professor')).toBe('/teaching/curriculum')
    expect(legacyPath('/professor/privacy', 'professor')).toBe('/privacy/queue')
  })

  it('leaves new and admin pages alone', () => {
    expect(legacyPath('/home', 'student')).toBeNull()
    expect(legacyPath('/admin/approvals', 'admin')).toBeNull()
    expect(legacyPath('/studentish', 'student')).toBeNull()
  })

  it('sends an unknown old page home rather than to a 404', () => {
    expect(legacyPath('/student/nothing-here', 'student')).toBe('/home')
  })
})
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/paths.test.ts`. Expected: FAIL, cannot resolve `./paths`.

- [ ] **Step 3: Write `src/lib/paths.ts`**

```ts
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
export function legacyPath(pathname: string, role: LegacyRole): string | null {
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
```

Note: `/student/...` always means the student version of a page, and `/professor/...` the professor version, whatever the viewer's role. The prefix alone settles pages that exist under both, like `reports`. The `role` parameter is kept for callers, and future use, but it doesn't change the result.

- [ ] **Step 4: Run it** — `npx vitest run src/lib/paths.test.ts`. Expected: PASS, 9 tests.

- [ ] **Step 5: Commit** — `src/lib/paths.ts`, `src/lib/paths.test.ts`, message "One module for every URL, and a map from the old ones".

---

### Task 2: Class spaces in the space list

**Files:**
- Modify: `supabase/one-workplace.sql` (append a block), `supabase/tests/one-workplace.test.sql`
- Modify: `src/lib/general/types.ts`, `src/lib/api/spaces.ts`, `src/lib/general/navigation.ts` (+ its test), `src/pages/general/SpacePicker.tsx`, `src/pages/general/SpaceHome.tsx` and every page under `src/pages/general/` that reads `useParams().spaceId`

**Interfaces:**
- Produces (SQL): `general_space_overview` gains a trailing `class_id uuid` (null for work spaces).
- Produces (TS): `GeneralSpace.class_id: string | null`. `listMySpaces()` returns both kinds. `chooseLandingSpace` ignores education spaces.

- [ ] **Step 1: Failing SQL test** — above the final `rollback;` of `supabase/tests/one-workplace.test.sql`:

```sql
-- ------------------------------------------------------------------ the space list knows its class

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
begin
  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_be('a class space names its class in the space list',
    (select class_id = v_class from public.general_space_overview where id = v_space));
end $$;
```

Run it. Expected: FAIL, `column "class_id" does not exist`.

- [ ] **Step 2: Append to `supabase/one-workplace.sql`**

```sql
begin;

-- ---------------------------------------------------------------- the space list knows its class

/** One more column on the end: which class owns an education space, so a link can open it. */
create or replace view public.general_space_overview
with (security_invoker = true) as
select s.id,
       s.name,
       s.description,
       s.created_by,
       s.archived_at,
       s.created_at,
       s.updated_at,
       m.level as my_level,
       (select count(*) from public.general_space_members x where x.space_id = s.id)::int
         as member_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is null)::int as project_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is not null)::int as archived_count,
       s.kind,
       (select c.id from public.classes c where c.space_id = s.id) as class_id
  from public.general_spaces s
  left join public.general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

grant select on public.general_space_overview to authenticated;

commit;
```

Check against the live view first (`select pg_get_viewdef('public.general_space_overview'::regclass)`). If it differs from block 1's version beyond the new column, keep the live columns in order and report it. Apply `supabase/one-workplace.sql`, then `supabase/anon-lockdown.sql`, and run both test files. Expected: all PASS.

- [ ] **Step 3: Types and the list**

- `src/lib/general/types.ts`, `GeneralSpace`, after `kind`:
  ```ts
  /** The class that owns an education space; null for a work space. */
  class_id: string | null
  ```
- `src/lib/api/spaces.ts` `listMySpaces`: remove `.eq('kind', 'work')` and its comment. Class spaces now appear, and the pages decide what to do with them.
- `src/lib/general/navigation.ts` `chooseLandingSpace`: `const live = spaces.filter((space) => space.kind === 'work' && !space.archived_at && space.my_level)`. Add a test to `navigation.test.ts` showing an education space is never picked. The test helper needs `class_id: null`.

- [ ] **Step 4: Pages**

- `SpacePicker.tsx`: split `mine` into `classSpaces` (`kind === 'education'`) and `workSpaces`. When `classSpaces` is non-empty and not viewing archived, render above the work grid a section headed "Your classes", with the same `SpaceCard` grid. `SpaceCard` links to `paths.class(s.class_id)` for an education space, otherwise to `paths.space(s.id)` (calling `rememberSpace` only for work spaces). Education cards show a small amber "Class" badge (`bg-amber-400/18 text-amber-700 dark:text-amber-300`, the same classes the admin audit tone uses) where the archived badge sits. The live/archived split, counts and empty state count only work spaces.
- `SpaceHome.tsx` and each space sub-page (`SpaceMembers`, `GeneralTeams`, `SpaceArchive`, `GeneralReports`): when the resolved space has `kind === 'education'` and a `class_id`, `return <Navigate to={paths.class(space.class_id)} replace />` next to the existing "space not found" guard.

- [ ] **Step 5: Build, test, commit** — `npm run build && npx vitest run`. Commit the SQL, the test and the TS files, message "List class spaces with the rest, and open them as their class".

---

### Task 3: One route table, old URLs redirect

**Files:**
- Modify: `src/App.tsx`, `src/routes/ProtectedRoute.tsx`, `src/lib/workplace.ts`, `src/lib/workplace.test.ts`
- Create: `src/routes/RoleSwitch.tsx`, `src/routes/LegacyRedirect.tsx`, `src/pages/Home.tsx`

**Interfaces:**
- Consumes: `paths`, `legacyPath` (Task 1).
- Produces:
  - `RoleSwitch({ student, professor, admin }: { student: ReactNode; professor: ReactNode; admin?: ReactNode })` renders by `profile.role`. Admin falls back to `admin`, otherwise `<Navigate to={paths.home} replace />`.
  - `LegacyRedirect` (a route element) navigates to `legacyPath(location.pathname, role)` with `location.search` + `location.hash`. When `legacyPath` returns null it renders `NotFound`.
  - `homeFor(profile)` returns `'/home'` for an admitted account. The `/onboarding` and `/pending` rules are unchanged.
  - `src/pages/Home.tsx` is the `/home` page. In this task it just renders `<RoleSwitch student={<StudentHome />} professor={<ProfessorHome />} admin={<AdminHome />} />`. Task 6 stacks the work section on it.

- [ ] **Step 1: Update `workplace.test.ts`** so every admitted `homeFor` expectation is `'/home'` (students, professors, admin, whatever `home_workplace`). Keep the pending, rejected, role-less and no-profile cases. Delete the `educationHome` and `settingsPathFor` tests. Run it; expected FAIL.

- [ ] **Step 2: `src/lib/workplace.ts`** — `homeFor` returns `'/home'` after the pending/role checks. Keep `educationHome` exported but make it return the same thing, since it goes in phase 4. Keep `workplaceOf` and `settingsPathFor` as they are for now. Run the test; expected PASS.

- [ ] **Step 3: `ProtectedRoute`** — drop the `workplace` prop. It becomes: not ready → Booting; no session → `/login`; no profile → `/onboarding`; `rejected` → `/pending`. With `open` set (Settings, privacy request, which every signed-in account is owed), render. Otherwise, not active or no role → `/pending`; `allow` given and role not in it → `homeFor(profile)`; else render.

```tsx
export function ProtectedRoute({ allow, open }: { allow?: Role[]; open?: boolean }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (open) return <Outlet />
  if (profile.status !== 'active' || !profile.role) return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />
  return <Outlet />
}
```

- [ ] **Step 4: `RoleSwitch`, `LegacyRedirect`, `Home`** — write them to the interfaces above, with a short doc comment each.

- [ ] **Step 5: The route table** — replace everything between the public routes and `path="*"` in `src/App.tsx` with the route map above:
  - `<ProtectedRoute open />` + `<AppShell />`: `/settings`, `/privacy/request`.
  - `<ProtectedRoute />` + `<AppShell />`: `/home`, `/tasks`, `/calendar`, `/messages`, `/messages/:conversationId`, `/spaces…`, `/projects…`, `/classes`, `/classes/:classId`, `/groups`, `/groups/:groupId`, `/class-projects`, `/class-projects/:projectId`, with the role pages behind `RoleSwitch` (e.g. `/classes` → `<RoleSwitch student={<StudentClasses />} professor={<ProfessorClasses />} admin={<Navigate to={paths.admin.classes} replace />} />`; `/groups/:groupId` → `GroupDetail role="student"|"professor"`; `/class-projects/:projectId` → the existing project detail element each role used).
  - `<ProtectedRoute allow={['student']} />`: `/record`.
  - `<ProtectedRoute allow={['professor', 'admin']} />`: `/teaching/*`, `/privacy/queue`.
  - `<ProtectedRoute allow={['admin']} />`: `/admin/approvals` … `/admin/accounts` (not `/admin`).
  - For now `/tasks`, `/calendar` and `/messages` render the existing pages. For admin, `/tasks` and `/calendar` show `RoleSwitch` fallbacks. Messages uses `role="professor"` for professor/admin and `"student"` for students until Task 7 merges it.
  - Legacy catch-alls, **before** `path="*"`: `/student/*`, `/professor/*`, `/general/*`, `/general`, `/student`, `/professor`, `/admin`, `/admin/settings`, `/education/*`, each rendering `<LegacyRedirect />`. `/admin` must not match the admin page routes, so list `/admin` and `/admin/settings` exactly.
  - Keep the lazy-loading style the file already uses.

- [ ] **Step 6: Build, test, commit** — `npm run build && npx vitest run`. Commit: "Put every page on one short route, and send old URLs to it".

---

### Task 4: One rail

**Files:**
- Modify: `src/components/app/nav.ts`, `src/components/app/nav.test.ts`, `src/components/app/SideNav.tsx`, `src/components/app/AppShell.tsx`, `src/components/app/TopNav.tsx`, `src/components/app/WorkspaceSearch.tsx`, `src/hooks/useConversations.ts`

**Interfaces:**
- Produces:
  - `navFor(profile: { role: Role | null; status: AccountStatus } | null, admitted: boolean): NavGroup[]`, replacing `navForWorkplace`. Delete `navForWorkplace`, `BY_ROLE` and `GENERAL_NAV`.
  - `ConversationScope` adds `'all'`, which filters nothing.
  - `useUnreadTotal(viewerId, 'all')` is what the rail badge uses.

The rail, in order (the group label styles from `aaf9320` are unchanged):

```
MAIN            Home · My tasks · Calendar · Messages(badge)
YOUR SPACES     live: class spaces and work spaces the reader is in, not archived, up to 6
                → All spaces (/spaces)
YOUR PROJECTS   live: the reader's General projects (recentProjects) → All projects (/projects)
CLASSES         (student & professor) Classes · Groups · Class projects · [student] Your record
TEACHING        (professor) Submissions · Reassignments · Analytics · Reports · Syllabi · Curriculum
ADMIN           (admin) Faculty approvals · Accounts · Audit log · Privacy requests ·
                Notices · Sections · Library · Classes · Faculty · Cohort
ACCOUNT         Settings
```

A student nobody has admitted gets `MAIN: Home` + `ACCOUNT` only, with no live groups.

- [ ] **Step 1: Rewrite `nav.test.ts`** to cover:
  - an unadmitted student gets `['Home', 'Settings']`;
  - an admitted student gets MAIN, CLASSES (with "Your record") and ACCOUNT, and no TEACHING or ADMIN;
  - a professor gets TEACHING and no "Your record";
  - an admin gets ADMIN with "Faculty approvals" and no CLASSES;
  - every item's `to` starts with one of `/home /tasks /calendar /messages /settings /classes /groups /class-projects /record /teaching/ /admin/`.

  Live groups aren't in `navFor` (SideNav adds them), so the tests read only the static groups. Run; expected FAIL.

- [ ] **Step 2: `nav.ts`** — implement `navFor` with `paths`. Use the labels above and the icons the old rails used for the same rows: Home `board`, My tasks `check`, Calendar `calendar`, Messages `message`, Classes `folder`, Groups `users`, Class projects `kanban`, Your record `file`, Submissions `upload`, Reassignments `refresh`, Analytics `chart`, Reports `file`, Syllabi `file`, Curriculum `target`, and the admin rows as they were. Home is `end: true`. Rewrite the file's comments to say why the rail is one rail. Run the test; expected PASS.

- [ ] **Step 3: `SideNav.tsx`**
  - Use `navFor(profile, admitted !== false)`, with `admitted` from `useAdmission` as today.
  - Remove `WorkplaceSwitcher`, the collapsed Education/General icon pair, and every `workplace` variable.
  - The logo links to `paths.home`.
  - Render the two `LiveGroup`s after MAIN (index 0) for every admitted account. YOUR SPACES rows come from `navigation.spaces` filtered to `my_level && !archived_at`, sorted by kind (education first) then name, up to 6. `to` is `paths.class(class_id)` for education and `paths.space(id)` for work. YOUR PROJECTS is as today, via `paths.project`.
  - `LiveGroup` rows get an optional `tone: 'education' | 'work'`. The initial-letter badge uses amber for education (`bg-amber-400/18 text-amber-700 dark:text-amber-300`) and the existing navy active/`surface-sunken` style for work. The active style is unchanged for both.
  - Unread uses scope `'all'`.
- [ ] **Step 4: `AppShell.tsx`**: `GeneralNavigationProvider enabled={Boolean(profile && profile.status === 'active' && profile.role)}`. Remove `workplace`. The brand link goes to `paths.home`, and the error boundary's home to `homeFor(profile)`.
- [ ] **Step 5: `TopNav.tsx`**: remove `workplace`; `AccountMenu settingsTo={paths.settings}`. `WorkspaceSearch` loses its prop. Its static results come from `navFor(profile, true)`, and its dynamic results merge classes and class projects (as it does for education today) with General spaces and projects (as it does for General today). Links go through `paths`.
- [ ] **Step 6: `useConversations.ts`**: add `'all'` to `ConversationScope`, and make `scoped()` return everything for `'all'`.
- [ ] **Step 7: Build, test, commit** — `npm run build && npx vitest run`. Commit: "One rail for everyone: main, your spaces, your projects, then what your role adds".

---

### Task 5: Every link through `paths`

**Files:** every file under `src/` that `grep -rlE "['\"\`]/(student|professor|general)(/|['\"\`])" src --include=*.ts --include=*.tsx` lists (about 60 files), excluding `src/lib/paths.ts` and `src/lib/paths.test.ts`. Also `src/lib/general/navigation.ts` (+ test), whose `spaceRouteId`/`projectRouteId` parse `/general/...`.

**Interfaces:**
- Consumes: `paths` (Task 1).

- [ ] **Step 1: Record the starting count** —
  `grep -rnoE "['\"\`]/(student|professor|general)(/|['\"\`])" src --include=*.ts --include=*.tsx | grep -v "src/lib/paths" | wc -l`.
  Also list the files.
- [ ] **Step 2: Replace, file by file**, using the route map:
  - `` `/student/classes/${id}` `` and `` `/professor/classes/${id}` `` → `paths.class(id)`
  - `'/general/projects'` → `paths.projects`, and so on.
  - A ternary that picks a base by role (`role === 'professor' ? '/professor' : '/student'`) collapses to the role-free path.
  - `?tab=` / `?task=` query strings stay, appended after the builder: `` `${paths.project(id)}?task=${t.id}` ``.
  - `navigation.ts`: `spaceRouteId` matches `^/spaces/([^/]+)` (excluding `archive`, as it did for `/general/spaces/archive`), and `projectRouteId` matches `^/projects/([^/]+)`. Update `navigation.test.ts` to the new paths.
  - `Messages`, `MyTasks` and `Calendar` are rewritten in Tasks 7–9, but their links still go through `paths` now.
- [ ] **Step 3: Prove it** — the Step 1 grep returns `0`. Then `grep -rnE "to=\"/|navigate\\('/|href=\"/" src --include=*.tsx | grep -vE "paths\\.|\"/(login|register|forgot-password|reset-password|check-email|onboarding|pending|privacy|terms|cookies|join)"` lists no link to an app page written as a raw string (auth and legal pages may stay literal). Report anything left and why.
- [ ] **Step 4: Build, test, commit** — `npm run build && npx vitest run`. Commit: "Take every link from paths".

---

### Task 6: Home, stacked

**Files:**
- Create: `src/components/general/WorkOverview.tsx`
- Modify: `src/pages/Home.tsx`, `src/pages/general/GeneralHome.tsx` (delete it once `/home` no longer uses it; `/general` already redirects)

**Interfaces:**
- Produces: `WorkOverview()`. It needs no props, since it reads `useAuth`, `useGeneralNavigation` and `useGeneralDashboard` itself, and it renders the General home's content **without** its greeting/summary:
  - a section heading "Your work" in the style `DashSection`/page sections already use for a heading (reuse the existing heading markup from the dashboards; no new styles);
  - the QuickActions row (New space and Join with code only for `isFaculty(profile)`, as today);
  - the invitations/errors alerts;
  - the four panels in the `Bento`;
  - the invitation-answer logic, moved over unchanged.
  - It renders **nothing** when `myProjects` and `spaces` (work only) are both empty, there are no invitations, and the person is not faculty. A faculty member with nothing yet sees the section with its New space action, and the "Nothing here yet" block, faculty copy only.

- [ ] **Step 1: Extract `WorkOverview`** from `GeneralHome.tsx`, keeping behaviour and markup. Its links go through `paths`.
- [ ] **Step 2: `Home.tsx`** — the role dashboard via `RoleSwitch`, then `<div className="mt-10"><WorkOverview /></div>`. The role dashboards keep their own greeting and summary, so the page reads as the owner's "Stacked" preview.
- [ ] **Step 3: Delete `GeneralHome.tsx`** and its imports. `/general` is handled by `LegacyRedirect`.
- [ ] **Step 4: Build, test, commit** — "Home: your classes, then your work".

---

### Task 7: The All · Classes · Work filter, and one Messages

**Files:**
- Create: `src/lib/scope.ts`, `src/lib/scope.test.ts`, `src/components/ui/ScopeFilter.tsx`
- Modify: `src/pages/app/messages/Messages.tsx`, `src/App.tsx` (the messages routes lose the `role` prop)

**Interfaces:**
- Produces:
  - `type Scope = 'all' | 'classes' | 'work'`
  - `readScope(params: URLSearchParams): Scope` (reads `?show=`; anything else is `'all'`)
  - `writeScope(params: URLSearchParams, scope: Scope): URLSearchParams` (`'all'` removes the key)
  - `ScopeFilter({ value, onChange, counts? }: { value: Scope; onChange: (s: Scope) => void; counts?: Partial<Record<Scope, number>> })` is a segmented control using the same markup as the Active/Archived toggle in `ProfessorClasses.tsx` (`rounded-lg surface-sunken p-1`, active `surface font-medium text-ink ring-1 ring-[var(--line)]`), labelled "All", "Classes", "Work".
  - `Messages()` takes no props.

- [ ] **Step 1: Test `scope.ts`** — `readScope` defaults, round-trips `classes`/`work`, and rejects junk to `'all'`; `writeScope('all')` deletes `show`. Run it; expected FAIL. Write `scope.ts`. Run it; expected PASS.
- [ ] **Step 2: `ScopeFilter.tsx`** as specified.
- [ ] **Step 3: Messages, merged**
  - Load with `useConversations(profile.id, 'all')`. Filter on the client by scope: classes = `kind !== 'project'`, work = `kind === 'project'`. Put `ScopeFilter` above the conversation list, with counts per scope.
  - Always load and show General invitations.
  - `canModerate` = professor or admin, on a class or group conversation.
  - "New message" (NewDirectDialog) shows for professor and admin.
  - Copy: hero description "Class, group and project chats, and your direct messages, in one place." The empty state reads "Every class, group and project you're in has its own chat, created for you automatically." The unavailable alert reads "That conversation is not available. You may have been removed from the class, group or project it belongs to."
  - Links via `paths.conversation`.
- [ ] **Step 4: Build, test, commit** — "One Messages, with a filter for classes and work".

---

### Task 8: One My tasks

**Files:**
- Modify: `src/pages/app/tasks/MyTasks.tsx`

**Interfaces:**
- Consumes: `readScope`/`writeScope`/`ScopeFilter` (Task 7); `useGeneralNavigation().myProjects`; `useGeneralDashboard(profile.id, ids)`; `myTasks` from `src/lib/general/dashboard.ts`.

- [ ] **Step 1: Read `MyTasks.tsx`**, and note how class tasks load (`myTasks(profile.id)` from the class-side API) and render (buckets, the task drawer via `?task=`).
- [ ] **Step 2: Add work tasks**
  - Load open General tasks assigned to the reader: live `myProjects` ids → `useGeneralDashboard` → `myTasks(data.tasks, profile.id)`.
  - Class tasks load only for students; faculty have none.
  - With `ScopeFilter` set to All, show both: class tasks in their existing buckets, then a "Work" section of work tasks, sorted by due date. Each row shows the title, project name and due date, in the same row style the General `MyTasksPanel` uses, linking to `` `${paths.project(t.project_id)}?task=${t.id}` ``.
  - The hero counts cover whatever the filter shows.
  - Empty states per scope: Classes: "No class tasks are assigned to you." Work: "No open work tasks are assigned to you." All: "Nothing is assigned to you right now."
- [ ] **Step 3: Build, test, commit** — "One My tasks: class work and project work, with a filter".

---

### Task 9: One Calendar

**Files:**
- Modify: `src/pages/app/calendar/Calendar.tsx`

- [ ] **Step 1: Read `Calendar.tsx`**: how `calendar_events` and the week bands render, the class/kind filters, `?task=`, and what admins see.
- [ ] **Step 2: Add work dates**
  - Load General tasks the way Task 8 does, keeping every task in the reader's live projects that has a `due_at` and isn't done (not only assigned ones, since a project's calendar shows the project).
  - Render them on their day beside class events: the title, the project name as the detail line, the neutral/navy styling the calendar already uses for a non-class item (reuse; no new colours), linking to `` `${paths.project(project_id)}?task=${id}` ``.
  - `ScopeFilter` sits beside the existing filters. The class and kind filters apply only to class events and hide when the scope is Work.
  - Admins, who used to get an empty-state message, now see their work dates.
- [ ] **Step 3: Build, test, commit** — "One Calendar: class dates and project due dates together".

---

### Task 10: Verification

- [ ] **Step 1**: `npm run build && npx vitest run && node scripts/schema-drift.mjs | tail -2`. Run the SQL suite loop (`FAIL  |SQL failed|ERROR:` grep, 40 files). Everything is green.
- [ ] **Step 2**: The Task 5 greps both return nothing.
- [ ] **Step 3: Browser walk** (dev server via `preview_start` `collabify`). Ask the owner to sign in for each account in turn, naming the account and what will be checked, then verify with `read_page`:
  1. **Student**: rail order MAIN / YOUR SPACES (classes, amber) / YOUR PROJECTS / CLASSES / ACCOUNT; `/home` stacked; `/tasks`, `/calendar`, `/messages` filters; an old bookmark `/student/classes` lands on `/classes`.
  2. **Professor**: TEACHING group; a class in YOUR SPACES opens the class page; `/professor/submissions` redirects; Messages can moderate a class chat.
  3. **Admin**: ADMIN group without Dashboard; `/admin` redirects to `/home`; `/admin/approvals` works.
  4. Collapsed rail and the mobile drawer: the same rows, tooltips work.
- [ ] **Step 4**: The controller pushes and appends the handoff section.
