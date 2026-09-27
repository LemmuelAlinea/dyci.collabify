# One workplace, phase 4: cleanup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last two-workplace leftovers, rename the account-role enum value from `professor` to `faculty`, and make current user-facing copy say faculty.

**Architecture:** Keep this as cleanup, not a redesign. Move the one still-useful routing helper (`homeFor`) into `src/lib/access.ts`, delete `src/lib/workplace.ts`, and drop `profiles.home_workplace` with an idempotent SQL cleanup file registered in the rebuild order. Rename only the account role enum value (`public.user_role`) and the code that compares to it; leave teaching-domain names such as `classes.professor_id`, `is_class_professor`, `task_author = 'professor'`, report prop names, and legacy `/professor/*` URLs in place unless they are user-facing copy.

**Tech stack:** React 19 + TypeScript + Vite + React Router + Tailwind v4 tokens, Supabase/Postgres (SQL via `node scripts/db.mjs`), Vitest (node env, `src/**/*.test.ts`, pure functions only).

**Spec:** `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, section 4, plus `docs/superpowers/HANDOFF-codex.md` section 6 Step C.

**Owner decisions carried into this plan:**
- Admins do not teach. The Step B question is answered: do not add "New message" back for admins, and make `canTeach()`/`is_teaching_faculty()` faculty-only.
- Keep legacy `/professor/*` URLs working. Those strings are old URL prefixes, not current role copy.
- Do not rename database columns/functions like `professor_id`, `is_class_professor`, or education component props like `role="professor"` in this phase. They describe the education engine and would create churn beyond cleanup.
- Keep the landing page visual design. Only words change.

## Global Constraints

- Replies and owner handoffs stay minimal.
- Never sign in, sign out, register, or delete browser data for the owner.
- Never read, print, paste, stage, or commit `.env.local`, `SUPABASE_DB_URL`, or `SUPABASE_SERVICE_ROLE_KEY`.
- Never stage `desktop.ini`, `docs/redesign/`, `.superpowers/`, `graphify-out/`, `*.patch`, `verify-before-main.md`, or `supabase/.temp/`.
- Every URL comes from `src/lib/paths.ts`. No new literal app URL starts with `/student`, `/professor`, or `/general` outside `paths.ts` and its tests.
- SQL files stay idempotent. Any new SQL file is registered in `scripts/schema-drift.mjs` `ORDER` and in the restore command in `docs/07-backup.md`.
- After adding or redefining any SQL function, re-run `supabase/anon-lockdown.sql` last, then `supabase/tests/anon-lockdown.test.sql`.
- Copy rules: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- No raw colours. Use tokens from `src/styles/index.css`.
- After each task: run the task checks, review the diff against this plan, commit with a trailer naming Codex, and push `main`.

## Review Focus

- Existing live database with `public.user_role = 'professor'`: Task 2 must rename it before any updated function body depending on `'faculty'` is applied.
- Fresh database restore: `schema.sql` must create `user_role` with `'faculty'`, and the documented restore line plus `schema-drift` order must include `cleanup.sql`.
- Old client during deploy: signup metadata role `'professor'` must still register as faculty after the rename.
- Legacy bookmarks: `/professor/*` redirects must keep passing through `legacyPath()`.
- Accidental over-rename: `task_author = 'professor'`, report prop names, class `professor_id`, and `is_class_professor` must not be renamed merely because they contain the word professor.

## File map

| File | Change | Task |
|---|---|---|
| `src/lib/access.ts`, `src/lib/access.test.ts` | add `homeFor`; update faculty role helpers/tests | 1, 3 |
| `src/lib/workplace.ts`, `src/lib/workplace.test.ts` | delete | 1 |
| `src/lib/types.ts` | remove `Workplace`/`home_workplace`; `Role` becomes `student | faculty | admin` | 1, 3 |
| `src/components/app/AppShell.tsx`, `src/pages/auth/{AuthCallback,JoinClassLink,Onboarding,Pending}.tsx` | import `homeFor` from `access.ts` | 1 |
| `src/context/AuthContext.tsx` | stop writing `home_workplace`; send `faculty` for new faculty signups/onboarding | 1, 3 |
| `supabase/cleanup.sql` | new idempotent cleanup: drop `home_workplace`, drop unused `workplace`, rename `professor` to `faculty` | 1, 2 |
| `supabase/workplaces.sql`, `supabase/access.sql`, `supabase/schema.sql`, `supabase/consent.sql`, `supabase/accounts.sql`, `supabase/approvals.sql`, `supabase/admin-rename.sql`, `supabase/messages.sql`, `supabase/one-workplace.sql` | remove workplace remnants; update account-role literals/function bodies | 1, 2 |
| `supabase/tests/cleanup.test.sql`, `supabase/tests/access.test.sql`, `supabase/tests/accounts.test.sql`, `supabase/tests/approvals.test.sql`, other SQL suites with profile role fixtures | prove cleanup and update role fixtures | 1, 2 |
| `scripts/schema-drift.mjs`, `docs/07-backup.md` | register `cleanup.sql` after `one-workplace.sql`, before `anon-lockdown.sql` | 1 |
| `src/routes/gate.test.ts`, `src/routes/RoleSwitch.tsx`, `src/App.tsx`, `src/components/app/nav.ts`, `src/components/app/nav.test.ts`, `src/components/app/WorkspaceSearch.tsx` | account role value `faculty`; legacy `/professor` stays | 3 |
| `src/pages/auth/{Register,Onboarding,JoinClassLink}.tsx`, `src/components/ui/RoleChoice.tsx` | user-facing "professor" -> "faculty" where not a data field | 4 |
| `handoff.md` | append phase 4 completion section | 5 |

---

### Task 1: Remove `home_workplace`, move `homeFor`, and fold the duplicate view

**Files:**
- Modify: `src/lib/access.ts`, `src/lib/access.test.ts`
- Delete: `src/lib/workplace.ts`, `src/lib/workplace.test.ts`
- Modify: `src/lib/types.ts`, `src/components/app/AppShell.tsx`, `src/pages/auth/AuthCallback.tsx`, `src/pages/auth/JoinClassLink.tsx`, `src/pages/auth/Onboarding.tsx`, `src/pages/auth/Pending.tsx`, `src/context/AuthContext.tsx`
- Create: `supabase/cleanup.sql`, `supabase/tests/cleanup.test.sql`
- Modify: `supabase/workplaces.sql`, `supabase/access.sql`, `supabase/one-workplace.sql`, `supabase/general-spaces.sql`, `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Produces: `homeFor(profile: Pick<Profile, 'role' | 'status'> | null | undefined): string` in `src/lib/access.ts`.
- Produces: no `Profile.home_workplace`, no `Workplace` type, no `src/lib/workplace.ts`.
- Produces: `supabase/cleanup.sql`, registered after `one-workplace.sql` and before `anon-lockdown.sql`.
- Produces: one `general_space_overview` definition in `supabase/one-workplace.sql`, with `kind` and `class_id`.

- [ ] **Step 1: Move the `homeFor` tests into `src/lib/access.test.ts`**

Add a `describe('homeFor')` block that imports `homeFor` from `./access` and uses profile objects with only `role` and `status`.

Assertions:
- `homeFor(null)` is `'/onboarding'`.
- rejected, pending, and role-less accounts go to `'/pending'`.
- active `student`, `professor` for now, and `admin` accounts go to `'/home'`.

Run: `npx vitest run src/lib/access.test.ts`
Expected: FAIL because `homeFor` is not exported from `src/lib/access.ts`.

- [ ] **Step 2: Implement `homeFor` in `src/lib/access.ts`**

Add:

```ts
export type HomeProfile = Pick<Profile, 'role' | 'status'> | null | undefined

export function homeFor(profile: HomeProfile): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return '/home'
}
```

Run: `npx vitest run src/lib/access.test.ts`
Expected: PASS.

- [ ] **Step 3: Replace imports and delete `workplace.ts`**

Replace imports of `homeFor` from `../../lib/workplace` or `./workplace` with `../../lib/access` or `./access` in:
- `src/components/app/AppShell.tsx`
- `src/pages/auth/AuthCallback.tsx`
- `src/pages/auth/JoinClassLink.tsx`
- `src/pages/auth/Onboarding.tsx`
- `src/pages/auth/Pending.tsx`

In `src/lib/types.ts`, remove `import type { Workplace } from './workplace'` and remove `home_workplace` from `Profile`.

In `src/context/AuthContext.tsx`, remove `home_workplace: 'education'` from the onboarding profile row.

Delete `src/lib/workplace.ts` and `src/lib/workplace.test.ts`.

Run:

```bash
rg -n "home_workplace|Workplace|from './workplace'|from '../../lib/workplace'|src/lib/workplace" src
```

Expected: no output.

- [ ] **Step 4: Write `supabase/tests/cleanup.test.sql`**

The suite runs in a transaction and asserts:
- `information_schema.columns` has no `public.profiles.home_workplace`.
- `pg_type` has no `public.workplace`.
- `public.general_space_overview` exposes exactly one final shape with `kind` and `class_id`.
- `public.handle_new_user` can insert a student profile without `home_workplace`.

Run: `node scripts/db.mjs supabase/tests/cleanup.test.sql`
Expected before SQL cleanup is applied: FAIL on the `home_workplace` assertion.

- [ ] **Step 5: Create `supabase/cleanup.sql` for workplace cleanup only**

Create an idempotent file:
- drops `public.profiles.home_workplace` if it exists;
- drops `public.workplace` if it exists after the column is gone;
- leaves the `user_role` rename for Task 2, unless Task 2 is being applied in the same live maintenance window.

Register it:
- in `scripts/schema-drift.mjs` `ORDER`, immediately after `one-workplace`;
- in the restore command in `docs/07-backup.md`, immediately after `supabase/one-workplace.sql`;
- in the explanatory paragraphs near `access.sql` / `one-workplace.sql` / `anon-lockdown.sql`.

- [ ] **Step 6: Stop older SQL from recreating `home_workplace`**

In `supabase/workplaces.sql`:
- rewrite the header away from two-workplace language;
- remove `create type public.workplace`;
- remove the `alter table public.profiles add column home_workplace`;
- remove the `meta_workplace = 'general'` branch from `handle_new_user`;
- remove `home_workplace` from every `insert into public.profiles` column list and value list.

In `supabase/access.sql`:
- remove `home_workplace` from the `handle_new_user` insert column list and value list.
- update the comment that says an old client sending workplace gets no profile: old workplace metadata is ignored, and role metadata decides whether a profile is created.

In `supabase/general-spaces.sql`, update the header comment that mentions `public.workplace` and `profiles.home_workplace`.

- [ ] **Step 7: Fold duplicate `general_space_overview`**

In `supabase/one-workplace.sql`, keep the first full `general_space_overview` definition (the one with both `kind` and `class_id`) and delete the later duplicate block headed `-- the space list knows its class`.

Run:

```bash
rg -n "create or replace view public.general_space_overview" supabase/one-workplace.sql
```

Expected: one match.

- [ ] **Step 8: Apply and verify Task 1 SQL**

Run:

```bash
node scripts/db.mjs supabase/cleanup.sql
node scripts/db.mjs supabase/access.sql
node scripts/db.mjs supabase/one-workplace.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/cleanup.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```

Expected: both suites pass.

- [ ] **Step 9: Build, test, self-review, commit, push**

Run:

```bash
npm run build
npx vitest run
node scripts/schema-drift.mjs
git diff --check
git status --short
```

Review the diff against Task 1. Then commit only Task 1 files by name:

```bash
git add src/lib/access.ts src/lib/access.test.ts src/lib/types.ts src/components/app/AppShell.tsx src/pages/auth/AuthCallback.tsx src/pages/auth/JoinClassLink.tsx src/pages/auth/Onboarding.tsx src/pages/auth/Pending.tsx src/context/AuthContext.tsx supabase/cleanup.sql supabase/tests/cleanup.test.sql supabase/workplaces.sql supabase/access.sql supabase/one-workplace.sql supabase/general-spaces.sql scripts/schema-drift.mjs docs/07-backup.md
git add -u src/lib/workplace.ts src/lib/workplace.test.ts
git commit -F - <<'EOF'
Remove the last home-workplace state

Move the one remaining routing helper into access, drop the old profile column
and workplace enum, and keep the education-space overview defined once.

Co-Authored-By: Codex <noreply@openai.com>
EOF
git push origin main
```

---

### Task 2: Rename account role `professor` to `faculty` in SQL

**Files:**
- Modify: `supabase/cleanup.sql`, `supabase/schema.sql`, `supabase/workplaces.sql`, `supabase/consent.sql`, `supabase/access.sql`, `supabase/accounts.sql`, `supabase/approvals.sql`, `supabase/admin-rename.sql`, `supabase/messages.sql`, `supabase/one-workplace.sql`
- Modify: SQL suites under `supabase/tests/` that insert or compare `profiles.role = 'professor'`
- Create or modify: `supabase/tests/faculty-role.test.sql`

**Interfaces:**
- Produces: `public.user_role` enum values `student | faculty | admin`.
- Produces: signup metadata accepts both `'faculty'` and old `'professor'`; both create a `faculty` profile.
- Produces: `public.is_teaching_faculty(p_user uuid)` is true only for active `faculty` rows with `can_teach = true`; admins never teach.
- Leaves alone: `public.task_author` enum value `'professor'`, class/report names like `professor_id`, JSON key `class_join_preview().professor`, and old `/professor/*` URLs.

- [ ] **Step 1: Write `supabase/tests/faculty-role.test.sql`**

Assertions:
- `pg_enum` has `faculty` for `public.user_role`.
- `pg_enum` does not have `professor` for `public.user_role`.
- `public.task_author` still has `professor`.
- inserting `auth.users` metadata `role = 'faculty'` creates a `profiles.role = 'faculty'` row with `status = 'pending'`.
- inserting old metadata `role = 'professor'` also creates `profiles.role = 'faculty'` with `status = 'pending'`.
- `public.is_faculty(faculty_id)` is true and `public.is_teaching_faculty(faculty_id)` follows `can_teach`.
- an active admin with `can_teach = true` still returns false from `public.is_teaching_faculty(admin_id)`.
- `public.decide_faculty(...)` still approves a faculty account.

Run: `node scripts/db.mjs supabase/tests/faculty-role.test.sql`
Expected before implementation: FAIL because `faculty` is not a `public.user_role` value yet.

- [ ] **Step 2: Rename the enum in `supabase/cleanup.sql`**

Add a guarded block before any function redefinitions that depend on `faculty`:

```sql
do $$ begin
  if exists (
    select 1 from pg_enum
     where enumtypid = 'public.user_role'::regtype and enumlabel = 'professor'
  ) and not exists (
    select 1 from pg_enum
     where enumtypid = 'public.user_role'::regtype and enumlabel = 'faculty'
  ) then
    alter type public.user_role rename value 'professor' to 'faculty';
  end if;
end $$;
```

Update `supabase/schema.sql` so a fresh database creates:

```sql
create type public.user_role as enum ('student', 'faculty', 'admin');
```

- [ ] **Step 3: Update SQL function bodies that mean account role**

Replace account-role enum comparisons and casts in:
- `supabase/workplaces.sql`
- `supabase/consent.sql`
- `supabase/access.sql`
- `supabase/accounts.sql`
- `supabase/approvals.sql`
- `supabase/admin-rename.sql`
- `supabase/messages.sql`
- `supabase/one-workplace.sql`

Rules:
- Replace `role = 'professor'` and `role in ('professor', 'admin')` with `faculty` equivalents where the column is `profiles.role`.
- Replace casts such as `p_role = 'professor'` when `p_role` is `public.user_role`.
- In signup handlers, accept both metadata values:

```sql
if meta_role = 'professor' then
  meta_role := 'faculty';
end if;
if meta_role is null or meta_role not in ('student', 'faculty') then
  return new;
end if;
```

- Do not change `public.task_author`, `project_tasks.author_role`, or SQL tests that are asserting task authorship rather than account role.

- [ ] **Step 4: Update SQL tests and fixtures**

Update tests that create or compare `profiles.role`:
- `supabase/tests/access.test.sql`
- `supabase/tests/accounts.test.sql`
- `supabase/tests/approvals.test.sql`
- `supabase/tests/audit.test.sql`
- General-suite fixtures that create faculty profiles through auth metadata
- `supabase/tests/one-workplace.test.sql`
- other suites returned by `rg -n "'professor'" supabase/tests`

Do not update task-author inserts like:

```sql
insert into public.project_tasks (..., author_role) values (..., 'professor')
```

Those still use `public.task_author`.

- [ ] **Step 5: Apply and verify Task 2 SQL**

Live upgrade order for this task:

```bash
node scripts/db.mjs supabase/cleanup.sql
node scripts/db.mjs supabase/access.sql
node scripts/db.mjs supabase/accounts.sql
node scripts/db.mjs supabase/approvals.sql
node scripts/db.mjs supabase/messages.sql
node scripts/db.mjs supabase/one-workplace.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/faculty-role.test.sql
```

Expected: the faculty-role suite passes.

Then run the SQL suite loop:

```bash
for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done
```

Expected: no output.

- [ ] **Step 6: Live data sanity**

Run:

```bash
node scripts/db.mjs -c "select role, count(*) from public.profiles group by role order by role"
```

Expected: role values include `faculty`, not `professor`.

- [ ] **Step 7: Build, test, self-review, commit, push**

Run:

```bash
npm run build
npx vitest run
node scripts/schema-drift.mjs
git diff --check
```

Review the diff against Task 2. Then commit only Task 2 files by name:

```bash
git add supabase/cleanup.sql supabase/schema.sql supabase/workplaces.sql supabase/consent.sql supabase/access.sql supabase/accounts.sql supabase/approvals.sql supabase/admin-rename.sql supabase/messages.sql supabase/one-workplace.sql supabase/tests
git commit -F - <<'EOF'
Rename the account role from professor to faculty in SQL

The user_role enum now stores faculty. Signup still accepts old professor
metadata during deployment, while task authorship and class professor fields
stay as teaching-domain names.

Co-Authored-By: Codex <noreply@openai.com>
EOF
git push origin main
```

---

### Task 3: Rename account role `professor` to `faculty` in the app

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/access.ts`, `src/lib/access.test.ts`
- Modify: `src/routes/gate.test.ts`, `src/routes/RoleSwitch.tsx`, `src/App.tsx`
- Modify: `src/components/app/nav.ts`, `src/components/app/nav.test.ts`, `src/components/app/WorkspaceSearch.tsx`
- Modify: `src/context/AuthContext.tsx`, `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`, `src/components/ui/RoleChoice.tsx`
- Modify: account-role comparisons in pages/components returned by the role grep

**Interfaces:**
- Produces: `export type Role = 'student' | 'faculty' | 'admin'`.
- Produces: `RoleSwitch({ student, faculty, admin? })`.
- Produces: new signup/onboarding sends metadata role `'faculty'`.
- Keeps: old `/professor/*` routes in `paths.ts`, `paths.test.ts`, and `App.tsx` legacy mounts.
- Keeps: education component props `role="professor"` where the prop means "teacher view" instead of account enum.

- [ ] **Step 1: Update role-focused tests first**

Update expected account role values from `professor` to `faculty` in:
- `src/lib/access.test.ts`
- `src/routes/gate.test.ts`
- `src/components/app/nav.test.ts`
- `src/lib/classSpace.test.ts` where the viewer role means account role

Do not update `src/lib/paths.test.ts` legacy `/professor/*` URL expectations.

Run:

```bash
npx vitest run src/lib/access.test.ts src/routes/gate.test.ts src/components/app/nav.test.ts src/lib/classSpace.test.ts
```

Expected: FAIL until app code uses `faculty`.

- [ ] **Step 2: Update core types and access helpers**

In `src/lib/types.ts`:
- `Role = 'student' | 'faculty' | 'admin'`
- `ROLE_LABEL.faculty = 'Faculty'`
- `ProfessorAccount` may keep its type name for API compatibility in this task, but comments should say faculty account.

In `src/lib/access.ts`:
- `isFaculty()` checks `p.role === 'faculty' || p.role === 'admin'` to preserve existing admin-as-program-office behavior.
- `canTeach()` checks `p.role === 'faculty' && p.status === 'active' && p.can_teach`; admins never teach, even if a row somehow carries `can_teach = true`.

- [ ] **Step 3: Update route and navigation gates**

In `src/routes/RoleSwitch.tsx`, rename the prop from `professor` to `faculty`, and render it when `profile.role === 'faculty'`.

In `src/App.tsx`:
- update `<RoleSwitch professor={...}>` to `faculty={...}`;
- update `allow={['professor', 'admin']}` to `allow={['faculty', 'admin']}`;
- keep `<Route path="/professor/*" element={<LegacyRedirect />}>` and `<Route path="/professor" element={<LegacyRedirect />}>`.

In `src/components/app/nav.ts`, `WorkspaceSearch.tsx`, and related tests:
- account-role comparisons become `faculty`;
- labels remain "Faculty", not "Professor".

- [ ] **Step 4: Update auth and admin account-role writes**

In `src/context/AuthContext.tsx`, onboarding `status` logic checks `role === 'faculty'`.

In `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`, and `src/components/ui/RoleChoice.tsx`:
- faculty option value is `'faculty'`;
- any type `Exclude<Role, 'admin'>` continues to work.

In admin account management (`src/pages/app/admin/Accounts.tsx`) and API callers:
- role writes use `'faculty'`;
- UI copy says "faculty".

- [ ] **Step 5: Update remaining account-role comparisons**

Run:

```bash
rg -n "role === 'professor'|role: 'professor'|role = 'professor'|\\['professor'|\\('professor'" src --glob "*.ts" --glob "*.tsx"
```

For each result, decide:
- if it compares a `Profile.role` or route guard role, change to `faculty`;
- if it is an education engine prop like `role="professor"` for task/group/project views, leave it;
- if it is `legacyPath` or `/professor` route compatibility, leave it.

Record the intentional leftovers in the commit body or final task note.

- [ ] **Step 6: Build, test, self-review, commit, push**

Run:

```bash
npm run build
npx vitest run
git diff --check
```

Review the diff against Task 3. Then commit by file name:

```bash
git add src/lib/types.ts src/lib/access.ts src/lib/access.test.ts src/routes/gate.test.ts src/routes/RoleSwitch.tsx src/App.tsx src/components/app/nav.ts src/components/app/nav.test.ts src/components/app/WorkspaceSearch.tsx src/context/AuthContext.tsx src/pages/auth/Register.tsx src/pages/auth/Onboarding.tsx src/components/ui/RoleChoice.tsx src/pages/app/admin/Accounts.tsx
git commit -F - <<'EOF'
Use faculty as the account role in the app

The app now sends and reads the faculty account role. Legacy professor URLs and
teacher-view props stay in place because they are not the account enum.

Co-Authored-By: Codex <noreply@openai.com>
EOF
git push origin main
```

If Task 3 changes additional files from Step 5, add those file names explicitly before committing.

---

### Task 4: Current auth and landing copy says faculty

**Files:**
- Modify: `src/components/ui/RoleChoice.tsx`
- Modify: `src/pages/auth/Onboarding.tsx`, `src/pages/auth/Register.tsx`, `src/pages/auth/JoinClassLink.tsx`
- Modify as needed: `src/pages/Landing.tsx`, `src/components/landing/*`

**Interfaces:**
- Produces: current user-facing auth/landing copy says "faculty" instead of "professor" where it refers to a person.
- Leaves: historical legal/privacy text and education-domain prose outside current auth/landing surfaces unless it is visibly wrong in the current UI.

- [ ] **Step 1: Update the known auth copy**

Replace:
- `RoleChoice`: "Join your classes with a code from your professor" -> "Join your classes with a code from a faculty member"
- `RoleChoice`: "Professors and school staff" -> "Faculty and school staff"
- `Onboarding` and `Register`: "the code your professor gives you" -> "the code a faculty member gives you"
- `JoinClassLink`: "Your professor and classmates..." -> "Your faculty member and classmates..."

Keep copy sentence case and active voice.

- [ ] **Step 2: Re-grep current auth and landing surfaces**

Run:

```bash
rg -n "professor" src/pages/auth src/components/ui src/pages/Landing.tsx src/components/landing --glob "*.ts" --glob "*.tsx"
```

Expected: only non-user-facing values, if any. If a visible string remains, change it to faculty.

- [ ] **Step 3: Build, test, self-review, commit, push**

Run:

```bash
npm run build
npx vitest run
git diff --check
```

Review the diff against Task 4. Then commit:

```bash
git add src/components/ui/RoleChoice.tsx src/pages/auth/Onboarding.tsx src/pages/auth/Register.tsx src/pages/auth/JoinClassLink.tsx
git commit -F - <<'EOF'
Say faculty in the auth flow

Co-Authored-By: Codex <noreply@openai.com>
EOF
git push origin main
```

If landing files changed, add them explicitly too.

---

### Task 5: Final verification, handoff, and owner browser walk

**Files:**
- Modify: `handoff.md`

- [ ] **Step 1: Full local checks**

Run:

```bash
npm run build
npx vitest run
for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done
node scripts/schema-drift.mjs
node scripts/db.mjs -c "select role, count(*) from public.profiles group by role order by role"
```

Expected:
- build passes;
- Vitest passes;
- SQL loop prints no failures;
- drift output has no unreviewed regression;
- live roles include `faculty`, not `professor`.

- [ ] **Step 2: Required greps**

Run:

```bash
rg -n "home_workplace|public\\.workplace|src/lib/workplace|from './workplace'|from '../../lib/workplace'" src supabase docs scripts --glob "!docs/redesign/**"
rg -n "role === 'professor'|role = 'professor'|role in \\('professor', 'admin'\\)|::public.user_role.*professor" src supabase --glob "*.ts" --glob "*.tsx" --glob "*.sql"
rg -n "['\"`]/(student|professor|general)(/|['\"`])" src --glob "*.ts" --glob "*.tsx" | rg -v "src/lib/paths|src/App.tsx"
rg -n "professor" src/pages/auth src/components/ui src/pages/Landing.tsx src/components/landing --glob "*.ts" --glob "*.tsx"
```

Expected:
- first grep: no output except historical docs already listed in `handoff.md`, if deliberately left;
- second grep: only intentional education-domain leftovers (`task_author`, teacher-view props, legacy paths) and no `public.user_role` professor casts;
- third grep: no output;
- fourth grep: no visible current auth/landing copy saying professor.

- [ ] **Step 3: Append phase 4 to `handoff.md`**

Append a new section with:
- commit range for phase 4;
- `home_workplace`/`src/lib/workplace.ts` removed;
- enum value renamed to `faculty`;
- old `/professor/*` URLs still redirect;
- auth/landing copy updated;
- Step B decision: admins do not teach and do not get the teaching/New message behavior;
- deferred items still not fixed.

- [ ] **Step 4: Commit and push handoff**

Run:

```bash
git add handoff.md
git commit -F - <<'EOF'
Hand off phase 4 cleanup

Co-Authored-By: Codex <noreply@openai.com>
EOF
git push origin main
```

- [ ] **Step 5: Owner browser walk**

Ask the owner to do this, one account at a time:

**Faculty signup**
- Register as Faculty.
- Confirm the auth flow says faculty, not professor.
- Confirm the account lands at pending.

**Admin**
- Approve that faculty account.
- Confirm Faculty approvals still works and Can teach still toggles.

**Faculty**
- Confirm the approved faculty account can create a class only when Can teach is on.
- Confirm the class opens and old `/professor/submissions` still redirects to `/teaching/submissions`.

**Student**
- Join a class with a code or invite link.
- Confirm any join text says faculty, not professor.

If the owner reports failures, diagnose, fix, run the checks above, self-review, commit, push, and ask for the failed step to be rechecked.
