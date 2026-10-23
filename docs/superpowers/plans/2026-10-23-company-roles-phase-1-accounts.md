# Company roles, phase 1: accounts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Faculty account type with Member plus two admin-set
switches, **Can teach** and **Project manager**, without any teacher losing a
class, a grade, a report or a syllabus.

**Architecture:**
- One new SQL file, `supabase/company-accounts.sql`, last in the rebuild
  order. It adds the `member` role and the `can_manage_projects` column,
  migrates the 6 faculty accounts, and redefines every live function that
  checks `faculty`.
- The frontend moves every faculty check onto three helpers in
  `src/lib/access.ts`.
- The frontend ships first and accepts the old `faculty` value as if it were
  `member`. Every push stays safe against either database state. The last
  task removes that tolerance once the live database is migrated.

**Tech stack:** React 19 + TypeScript + Vite, Supabase (Postgres RLS,
plpgsql), Vitest, SQL tests run with `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-23-company-roles-design.md`. This
plan covers the "Accounts" section and rollout phase 1 only. Project roles,
stakeholders and QA are phases 2–4.

## Global constraints

- `supabase/*.sql` must stay idempotent. It gets re-run.
- `role`, `status`, `can_teach` and `can_manage_projects` can only be changed
  by an admin. This is enforced by the `profiles_guard_privileged` trigger: a
  non-admin's change is quietly reverted, not raised as an error.
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL` never in frontend code or
  committed files.
- Copy: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.
- No hardcoded colors. Use the design tokens in `src/styles/index.css`.
- Desktop layout first, then tablet, then phone.
- Run `npm run build` before claiming anything works.
- Apply SQL files in the `schema-drift.mjs` ORDER, and re-run
  `anon-lockdown.sql` after applying anything.
- Students can have neither switch. Admins do not teach. Admins may have
  Project manager.
- Nobody can be made admin from the UI.
- Exact names fixed by this plan:
  - Column `profiles.can_manage_projects boolean not null default false`.
  - SQL function `public.is_project_manager(p_user uuid) returns boolean`.
  - RPC `public.set_project_manager(p_user uuid, p_on boolean)`.
  - Frontend helpers `isMember`, `canTeach`, `canManageProjects`.

## Review focus

The failure modes most likely to bite a person, each pinned by a test in the
named task:

1. **A former faculty teacher after the migration:** still opens classes,
   grades, sees Teaching, and finds co-teachers in the picker. *(Task 4: SQL
   test acting as a migrated teacher. Task 7: browser walk.)*
2. **A Member with no switches calls the API directly** to create a work
   space or project: refused, with a message naming who can invite them.
   *(Task 4.)*
3. **A non-admin updates their own `can_manage_projects` or `role`** through a
   profile update: the value is quietly restored. *(Task 4.)*
4. **The admin turns off Can teach or Project manager** while the person still
   teaches (own or co-taught class) or owns an active work project: refused,
   with what to do first. *(Task 4.)*
5. **A sign-up carrying the old metadata `role: 'faculty'` or `'professor'`**
   (a stale tab, or Google then onboarding) lands as an active Member, never
   pending. *(Task 4 for the SQL trigger, Task 6 for onboarding.)*

---

### Task 1: Access helpers with legacy tolerance

**Files:**
- Modify: `src/lib/types.ts:4-30`. `Role` becomes
  `'student' | 'member' | 'admin' | 'faculty'`, with a `/** Legacy, removed
  in phase 1 task 7. */` note on `'faculty'`. `Profile` gains
  `can_manage_projects?: boolean` (optional until the column exists).
  `ROLE_LABEL` gets `member: 'Member'`.
- Modify: `src/lib/access.ts`.
- Test: `src/lib/access.test.ts`.

**Interfaces:**
- Produces:
  - `AccessProfile = Pick<Profile, 'role' | 'status' | 'can_teach' | 'can_manage_projects'> | null | undefined`
  - `isMember(p: AccessProfile): boolean`: active, and role `member` (or
    legacy `faculty`).
  - `canTeach(p: AccessProfile): boolean`: `isMember(p) && p.can_teach`.
    Mirrors `is_teaching_faculty`.
  - `canManageProjects(p: AccessProfile): boolean`: active, role `member` or
    `admin`, and `can_manage_projects === true`. **Legacy:** when
    `can_manage_projects` is `undefined` and the role is `faculty`, return
    true. Mirrors `is_project_manager`.
  - `isFaculty` is deleted. Every caller moves in Task 2.

- [ ] **Step 1: Write failing tests** in `access.test.ts`. Replace the
  `isFaculty` describe with:
  - `isMember`:
    - `p('member','active')` → true
    - `p('faculty','active')` → true
    - `p('student','active')` → false
    - `p('admin','active')` → false
    - `p('member','rejected')` → false
  - `canTeach`:
    - `p('member','active',true)` → true
    - `p('member','active',false)` → false
    - `p('admin','active',true)` → false
    - `p('student','active',true)` → false
  - `canManageProjects`:
    - a member with `can_manage_projects: true` → true
    - a member with `false` → false
    - an admin with `true` → true
    - a student with `true` → false
    - legacy faculty with the field `undefined` → true
    - legacy faculty with `false` → false
  - `showsClassScope(p('member','active',true), cls)` → true.
- [ ] **Step 2:** `npx vitest run src/lib/access.test.ts`. Expected: FAIL
  (`isMember` not exported).
- [ ] **Step 3:** Implement the helpers. In `showsClassScope`, replace the
  `faculty || admin` branch with `isMember(p) || p?.role === 'admin'`.
- [ ] **Step 4:** Re-run. Expected: PASS. `npm run typecheck` is expected to
  fail only at the `isFaculty` imports that Task 2 removes, so don't commit
  yet.
- [ ] **Step 5:** Go on to Task 2. Tasks 1 and 2 land in one commit.

### Task 2: Move every frontend faculty check onto the helpers

**Files (each site, and what it becomes):**

| Site | Becomes |
|---|---|
| `App.tsx:236` `allow={['faculty','admin']}` | `['member','admin']`. `gate` treats legacy `faculty` as `member` (see `routes/gate.ts` below). |
| `routes/RoleSwitch.tsx:27` and its `faculty` prop | Prop renamed `member`. Branch on `isMember(profile)`. Update the callers at `App.tsx:151,189,198,203,208,224` and `pages/Home.tsx:70`. |
| `routes/gate.ts` (`allow` check) | Normalise legacy `faculty` to `member` before matching `allow`. |
| `lib/classSpace.ts:40` | `!viewer \|\| !(viewer.role === 'member' \|\| viewer.role === 'faculty')`. Use an exported `isMemberRole(role)` from `access.ts` (same legacy rule, takes just the role). |
| `pages/general/SpacePicker.tsx:37` | `canManageProjects(profile) \|\| canTeach(profile)`. Admins now count when they have the switch. |
| `pages/general/SpacePicker.tsx:61` | `profile?.role === 'admin' \|\| (isMember(profile) && !canTeach(profile))` |
| `SpaceLayout.tsx:72`, `SpaceHome.tsx:67`, `SpaceProjects.tsx:57`, `GeneralTeams.tsx:146,170`, `WorkProjectsView.tsx:29` | `canManageProjects(profile)`. For a site that also serves education spaces, use `space.kind === 'education' ? canTeach(profile) : canManageProjects(profile)`. Read each site's context. |
| `components/general/WorkOverview.tsx:54` | `canManageProjects(profile)` (drop the `role !== 'admin'` exclusion). |
| `components/general/SpaceDialogs.tsx:56` | Unchanged (already `canTeach`). |
| `components/app/WorkspaceSearch.tsx:71,74` | `profile.role === 'faculty'` → `isMemberRole(profile.role)` |
| `lib/api/calendar.ts:18` and `Calendar.tsx:60,88` | The parameter type becomes `Role`. `'faculty'` → `'member'`, and the check uses `isMemberRole`. |
| `pages/app/messages/Messages.tsx:33` | `isMember(profile) \|\| profile?.role === 'admin'` |
| `lib/paths.ts:72,82` | Add `'member'` to `LegacyRole`. `member` redirects like `faculty`. |
| `components/app/nav.ts:288-299` | Unchanged in this task. The waiting rail is Task 6. |

Leave alone: `lib/general/presets.ts` (the `'faculty'` there is a template
audience, not a role), and the auth pages and admin pages (Tasks 5 and 6).

Tests:
- `src/routes/gate.test.ts`: change `'faculty'` fixtures to `'member'`, and
  keep one legacy case: `gate(true, p('faculty','active'), { allow: ['member','admin'] })` → `'ok'`.
- `src/components/app/nav.test.ts`: `teacher = account('member','active',true)`,
  `nonTeacher = account('member')`, plus one legacy case asserting the
  faculty rail equals the member rail.
- `src/lib/classSpace.test.ts`, `src/lib/archive.test.ts`: change fixtures to
  `'member'`.

- [ ] **Step 1:** Update the four test files as above. Run `npx vitest run`.
  Expected: FAIL where `member` is not yet handled.
- [ ] **Step 2:** Change every site in the table.
- [ ] **Step 3:** Confirm nothing outside the leave-alone list still checks
  faculty. `npx vitest run` → PASS. `npm run build` → clean.
  `rg "'faculty'|isFaculty" src` should show only: types.ts legacy,
  access.ts legacy, the gate/nav legacy tests, presets.ts, the auth pages,
  and the admin pages.
- [ ] **Step 4:** Commit and push. This is safe against the current database.

```bash
git add src && git commit -m "Read teaching and project managing from switches, not the faculty role"
git push origin main
```

### Task 3: Confirm the tolerant frontend is live

- [ ] **Step 1:** After Vercel deploys, open dyci-collabify.vercel.app as a
  teaching account. Classes, Teaching, and Spaces with "New space" all appear,
  exactly as before.

### Task 4: `company-accounts.sql`, the account model in the database

**Files:**
- Create: `supabase/company-accounts.sql`.
- Create: `supabase/tests/company-accounts.test.sql`, in the style of
  `supabase/tests/accounts.test.sql`, using `pg_temp.act_as`, `must_refuse`
  and `begin … rollback`.
- Modify: `scripts/schema-drift.mjs` ORDER (append `company-accounts` after
  `task-stages`), and both rebuild lines in `docs/07-backup.md:26,53`
  (append `supabase/company-accounts.sql`).

**Interfaces:**
- Produces, for Tasks 5 and 6:
  - Column `profiles.can_manage_projects`.
  - `is_project_manager(p_user uuid)`: active, role `member` or `admin`, and
    `can_manage_projects`.
  - `is_teaching_faculty(p_user uuid)` (name kept): active, role `member`,
    and `can_teach`.
  - RPCs:
    - `set_account_role(p_user uuid, p_role user_role)`: only `student` or
      `member`.
    - `set_faculty_teaching(p_user uuid, p_can_teach boolean)` (name kept,
      targets Members).
    - `set_project_manager(p_user uuid, p_on boolean)`.
  - View `account_overview` gains `can_teach`, `can_manage_projects` and
    `managed_project_count` (active work projects, `class_board_id is null`,
    where the person's level is `owner`).
  - View `professor_accounts` filters `role = 'member' and can_teach`.
  - `decide_faculty` is dropped.

**File layout.** In order:
1. Before `begin;`, outside any transaction, so the value is committed before
   anything uses it:
   `alter type public.user_role add value if not exists 'member';`
2. Then one `begin; … commit;` holding sections 3–7.
3. **Column.** Add `can_manage_projects` if missing, with a comment.
4. **Guards.**
   - `guard_privileged_columns` also reverts `can_manage_projects` for
     non-admins. Start from the copy in `access.sql:125-143`.
   - `guard_profile_insert` accepts only `student | member`, forces `active`,
     and forces both switches false.
   - `handle_new_user` maps metadata `professor` and `faculty` to `member`,
     and inserts `active`.
   - `log_profile_change` (copy from `access.sql:244`) also logs
     `can_manage_projects`, as `'project manager'` / `'not project manager'`,
     the same way it logs `can_teach`.
5. **Migration.** Runs as postgres, so `auth.uid()` is null. Check the guard
   lets that through, as `access.sql:128` does.
   - `update profiles set can_manage_projects = true` for every `faculty` row
     that is `owner` or `manager` of a work space (`kind = 'work'`) or of a
     work project (`class_board_id is null`). Do this before the next step.
   - `update profiles set role = 'member' where role = 'faculty'`. Status is
     untouched, so the rejected account stays rejected.
   - Add `constraint profiles_no_faculty check (role is distinct from 'faculty')`
     if missing.
   - `raise notice` each person who holds a class seat (`teaches_in_space`
     level) without `can_teach`, so the admin can decide.
6. **Helpers and checks.** Redefine each function from its latest copy (see
   the ORDER), changing only what is listed:
   - `is_teaching_faculty`: as above.
   - `is_project_manager`: new.
   - `teaches_in_space` (`one-workplace.sql:526`): `p.role = 'faculty'` →
     `p.role = 'member' and p.can_teach`.
   - `class_teacher_ids`, `meeting_audience`: the same replacement.
   - `set_section_faculty`, `start_direct_conversation`,
     `start_direct_message`: `role = 'faculty'` → `role = 'member' and can_teach`.
   - `am_i_admitted`: `role in ('faculty','admin')` → `role in ('member','admin')`.
   - `guard_general_creator` (`class-files.sql:85`): keep the class-board
     bypass. Spaces of kind `education`, and projects whose space is
     `education`, need `is_teaching_faculty(auth.uid())`. Everything else
     needs `is_project_manager(auth.uid())`. Message: *"Only project managers
     can create work spaces and projects. Ask a project manager to invite
     you."* For education: *"Only teachers can create class spaces."*
   - `guard_student_invite`: `is_faculty(auth.uid())` →
     `is_project_manager(auth.uid()) or is_teaching_faculty(auth.uid())`.
     Message: *"Only project managers and teachers can invite a student."*
   - `search_faculty`: callable by `is_project_manager` or
     `is_teaching_faculty` (or admin). Returns active `member` accounts with
     `can_teach`.
   - `guard_student_level`: message only. *"A student can only be a member.
     Owner and Manager are for members and teachers."*
   - `join_general_project`, `join_general_space`: message only. "A faculty
     member can invite you" → "A project manager can invite you".
   - `guard_class_space_member`, `guard_class_space_side`: messages only.
     "faculty" → "teachers".
   - Then `drop function if exists public.is_faculty(uuid);`. It must
     succeed. If it fails, a caller was missed: find it and redefine it.
7. **Admin RPCs and views.**
   - `set_account_role`: accepts `student | member` (raise on anything
     else). No status change.
     - Member → student is blocked while the person holds any class seat
       with `can_teach`, or `managed_project_count > 0`. Message: *"Hand over
       their classes and projects first."*
     - On → student, clear both switches.
   - `set_faculty_teaching`:
     - The target must be `member`, or raise *"Only members can teach."*
     - Off is blocked while the person owns an active class or holds an
       Owner/Manager seat in an education space. Message: *"They still teach
       a class. Hand it over or remove them from it first."*
   - `set_project_manager`:
     - Admin only. The target must be `member` or `admin`; for anyone else,
       raise *"Students cannot be project managers."*
     - Off is blocked while `managed_project_count > 0`. Message: *"They
       still run a project. Hand it over first."*
   - Drop `decide_faculty`. Recreate `account_overview` and
     `professor_accounts` (drop and create, as `accounts.sql:155` does).
     Keep the grants.

**Tests** (`company-accounts.test.sql`). Each refusal is paired with an
allowed case:
- A new auth user with metadata `role = 'faculty'` gets a `member` profile
  with status `active` and both switches false. Metadata `'professor'` gets
  the same.
- A non-admin updating their own `can_manage_projects = true`: the value
  reads back false. The same for `role = 'admin'`.
- A Member with no switches inserting into `general_spaces` (kind `work`) is
  refused. After the admin turns on PM, the same insert succeeds.
- A Member with Project manager but without Can teach creating an
  `education` space is refused.
- A Member with Can teach: `teaches_in_space` is true for their class space,
  and `search_faculty('')` lists them.
- `set_project_manager(student, true)` is refused.
  `set_project_manager(member who owns an active work project, false)` is
  refused; the same member with no projects → allowed.
- `set_faculty_teaching(member who co-teaches a class, false)` is refused.
- `set_account_role(x, 'faculty')` raises. Inserting a profile with
  `role = 'faculty'` violates `profiles_no_faculty`.
- `is_faculty` no longer exists:
  `select to_regprocedure('public.is_faculty(uuid)') is null`.

- [ ] **Step 1:** Write `company-accounts.test.sql`. Run
  `node scripts/db.mjs supabase/tests/company-accounts.test.sql`. Expected:
  FAIL (no `member` value, no `is_project_manager`).
- [ ] **Step 2:** Write `company-accounts.sql` per the layout above.
- [ ] **Step 3:** Apply it, then re-run anon-lockdown:
  `node scripts/db.mjs supabase/company-accounts.sql supabase/anon-lockdown.sql`.
  Expected: notices listing any seat holders without `can_teach`. Copy them
  into the handoff for the user.
- [ ] **Step 4:** Run the test file. Expected: every line PASS. Then run the
  suites most likely to regress, and confirm they pass:
  `access.test.sql`, `accounts.test.sql`, `approvals.test.sql` (rewrite any
  `decide_faculty` cases to expect the function to be gone),
  `general-spaces.test.sql`, and `section-faculty` / `meetings` tests if they
  exist.
- [ ] **Step 5:** `node scripts/schema-drift.mjs`. Expected: no new suspects
  for the redefined functions.
- [ ] **Step 6:** Check the data:
  `select role, can_teach, can_manage_projects, status, count(*) from profiles group by 1,2,3,4`.
  Expected: no `faculty` rows. 4 rows that are member + teach. The
  project-manager count matches the former faculty who owned or managed work.
- [ ] **Step 7:** Commit and push.

### Task 5: Admin pages

**Files:**
- Modify: `src/lib/api/accounts.ts`. `setAccountRole(userId, role: 'student' | 'member')`.
  Add `setProjectManager(userId: string, on: boolean)`, calling RPC
  `set_project_manager`.
- Modify: `src/lib/api/admin.ts`. Delete `decideFaculty`. Keep
  `setFacultyTeaching`, and rename it `setCanTeach` (update its callers).
- Modify: `src/lib/types.ts`. `Account` gains `can_teach`,
  `can_manage_projects` and `managed_project_count`.
- Modify: `src/pages/app/admin/Accounts.tsx`:
  - The type filter options become Student / Member / Admin (line 47).
  - Rows show two toggles (`role="switch"`, label visible): **Project
    manager** (for members and admins) and **Can teach** (members only).
    Students show neither.
  - "Make faculty / Make student" becomes "Make member / Make student".
    The confirm copy says what changes: *"They lose both switches."* for →
    student, and *"They get a plain member account. Turn on a switch to give
    them access."* for → member.
  - The admin's own row and other admins' rows keep today's limits, except
    an admin's own Project manager toggle, which an admin may set on
    themself.
  - Errors from the RPCs go through `authErrorMessage`, shown in a toast.
- Delete: `src/pages/app/admin/ProfessorApprovals.tsx`, its route
  (`App.tsx:58,252`), `paths.admin.approvals` (`paths.ts:55`) and its nav
  entry (`nav.ts:203`). Add a redirect `/admin/approvals` →
  `/admin/accounts`.
- Modify: `src/pages/app/admin/Faculty.tsx:43`. Filter on `a.can_teach`. The
  page title and nav label stay "Faculty"; that is the teaching load, and the
  word is fine there.
- Modify: `src/pages/app/admin/Sections.tsx:75`. Advisers =
  `a.role === 'member' && a.can_teach && a.status === 'active'`.
- Test: `src/components/app/nav.test.ts`. The admin rail no longer contains
  "Faculty approvals".

- [ ] **Step 1:** Update the nav test and run it. Expected: FAIL.
- [ ] **Step 2:** Make the changes above.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Browser, as the admin, on localhost (live database):
  - Turn on Project manager for the only member with neither switch, then
    turn it off: both succeed.
  - Try turning off Can teach for a teacher with classes: the toast shows the
    "still teach a class" message.
  - `/admin/approvals` lands on Accounts.
  - Leave every account as it was found.
- [ ] **Step 5:** Commit and push.

### Task 6: Sign-up, onboarding and the waiting home

**Files:**
- Modify: `src/components/ui/RoleChoice.tsx:6-19`. Options:
  - **Student**: *"Join your classes and the projects you're invited to."*
  - **Member**: *"A plain account. You'll see work once a project manager
    invites you or an admin gives you a role."*
  - Value `'member'`. No approval note.
- Modify: `src/pages/auth/Register.tsx:128`. The faculty-only branch is
  removed; Member shows only the shared fields.
- Modify: `src/pages/auth/Onboarding.tsx:65,84`. After onboarding, Members go
  to `paths.home`, never `/pending`.
- Modify: `src/context/AuthProvider.tsx:110-135,249`. The sign-up metadata
  role is `'student' | 'member'`. The upsert status is always `'active'`.
- Modify: `src/components/app/nav.ts` `navFor`:
  - A member with no switches, not in a class, with no work, gets
    `[ADMIN_INVITED-style Home + Inbox group, ACCOUNT]`. Reuse
    `ADMIN_INVITED` if its items fit, otherwise add `MEMBER_WAITING` with
    Home and Inbox.
  - A member with Project manager keeps the `SPACES_ONLY…` rail, with Spaces
    always shown (making spaces is their job), like teaching faculty today.
  - A member with Can teach is unchanged.
- Create: `src/components/app/WaitingHome.tsx`.
  - A banner (`.banner-fill`) titled *"You're in"*, with the body *"Nothing to
    open yet. A project manager can invite you to a project, or an admin can
    give you a role. Invitations show up in your Inbox."*
  - A link to Inbox.
  - Desktop-first layout using the `.shell` gutters.
- Modify: `src/pages/Home.tsx`. Render `WaitingHome` for a member with no
  switches whose membership is loaded and empty (not in a class, no work).
  Otherwise the member gets `ProfessorHome` through `RoleSwitch` as today.
- Tests (`nav.test.ts`):
  - `navFor(account('member'), true, { inClass: false, hasWork: false })` →
    labels `['Home','Inbox','Settings','Trash']`. Use whatever labels
    `ACCOUNT` renders today; assert against the same constant.
  - A member with `can_manage_projects: true` and no membership → the rail
    includes Spaces.
  - A member with no switches but `hasWork: true` → the normal
    `SPACES_ONLY` rail.

- [ ] **Step 1:** Write the nav tests and run them. Expected: FAIL.
- [ ] **Step 2:** Make the changes above.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Browser on localhost: `/register` shows Student and Member,
  and no Faculty. Do not submit a real sign-up. Ask the user to register a
  throwaway Member account and confirm it lands on the waiting home with
  Home, Inbox and Account in the sidebar.
- [ ] **Step 5:** Commit and push.

### Task 7: Remove legacy tolerance, verify, hand off

**Files:**
- Modify: `src/lib/types.ts`. Drop `'faculty'` from `Role`. Make
  `can_manage_projects` required.
- Modify: `src/lib/access.ts`. Drop the legacy branches in `isMember`,
  `isMemberRole` and `canManageProjects`.
- Modify: `src/routes/gate.ts`. Drop the normalisation.
- Modify: tests. Delete the legacy cases added in Tasks 1 and 2.
- Modify: `CLAUDE.md` line 1 paragraph ("Roles: `student`, `faculty`,
  `admin`…") to say: roles `student`, `member` and `admin`; teaching is
  `can_teach`; creating work spaces is `can_manage_projects`.
- Modify: `handoff.md`. Append a section in the house style: what, files,
  checked, deferred, next. Include the Task 4 notice list.

- [ ] **Step 1:** Remove the tolerance. `rg "'faculty'" src` should show
  only `presets.ts` and the `Faculty` admin page label.
- [ ] **Step 2:** `npx vitest run` → PASS. `npm run build` → clean.
  `npx eslint src` → clean.
- [ ] **Step 3:** Browser walk on localhost as the signed-in teaching account
  (Cloud):
  - Home shows the professor dashboard.
  - Classes open, and a grade page loads.
  - Teaching → Reports loads.
  - The co-teacher picker in a class's Faculty panel finds the other
    teachers.
  - Spaces shows "New project", or "New space" if Cloud has Project manager.
  - Dark mode and 375 px still look right.
  - No console errors.
- [ ] **Step 4:** Commit and push. Update the memory
  `collabify-current-state.md` to say phase 1 of company roles is live.
