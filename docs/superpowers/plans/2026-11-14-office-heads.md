# Office heads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin name one head per office, and give that head a read-only My office page with
their office's figures, attention list, spaces and people.

**Architecture:** `supabase/offices.sql` gains an internal attention helper both the admin and the
head reads share. A new `supabase/office-heads.sql` holds the `office_heads` table, the admin
setter, the seat-clearing triggers and the head-only reads. The app adds a Head select on Offices,
head names on Admin Home, a `headsOffice` flag for the rail and a `/office` page.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-office-heads-design.md`

## Global Constraints

- A head reads only their own office, only names, counts, the quiet date and the no-PM reason; no
  project content; zero rows to anyone else (other heads, members, the admin).
- Only an active admin writes a head. The head is an active `member` filed in that office.
- No inactive-head state: deactivation, a move, losing the office or the member role clears the
  seat, with one `office_head_changed` audit row whose actor is `auth.uid()`.
- `office_heads` rows are readable by the admin and the head themself only.
- Being a head never changes which rail a member gets; `headsOffice` is a separate `navFor`
  argument, false while loading or on error.
- Never redefine a function another file owns, except `offices.sql`'s own `admin_attention_projects`
  (this plan's owner edit), keeping its signature and gate.
- SQL is applied to the linked live project with
  `node scripts/db.mjs supabase/offices.sql supabase/offboarding.sql supabase/office-heads.sql supabase/anon-lockdown.sql <suites>`
  (approved; additive plus the helper extraction; suites roll back).
- Supabase errors reach the person as-is: `new Error(authErrorMessage(err, '<fallback>'), { cause: err })`.
- Tokens only; sentence case, active voice, no "please", "successfully" or exclamation marks;
  desktop first. Repo style: no semicolons, single quotes; never run a formatter over whole files.
  `npm run build` passes before a task is done.

## Review Focus

1. **The head is also an admin-visible project's member**: `i_am_on` is true only for projects the
   head is a member of (not stakeholder-excluded, any role). Test in Task 2.
2. **Two offices, two heads**: each head's reads return only their own office. Test in Task 2.
3. **The helper extraction changes nothing for the admin**: the phase 1 suite passes unchanged.
   Test in Task 1.
4. **A head offboarded through phase 2's `admin_offboard_member`**: the seat clears (status
   trigger). Test in Task 1.
5. **The rail before `my_headed_office()` answers**: no My office entry, no flash of another rail.
   Test in Task 4.

---

### Task 1: Head seat (`offices.sql` helper, `office-heads.sql` table, setter, triggers)

**Files:**
- Modify: `supabase/offices.sql` (`admin_attention_projects` → `office_attention_rows()` helper)
- Create: `supabase/office-heads.sql`, `supabase/tests/office-heads.test.sql`

**Interfaces:**
- Produces: `office_attention_rows() returns table(project_id uuid, project_name text, space_name
  text, office_id uuid, office_name text, no_pm boolean, quiet_since timestamptz)` (internal,
  revoked); audit value `office_head_changed`; table `office_heads(office_id uuid pk, user_id uuid,
  assigned_by uuid, assigned_at timestamptz)`; `set_office_head(p_office uuid, p_user uuid) returns
  void`; `admin_office_heads() returns table(office_id uuid, head_id uuid, head_name text)`.
- [ ] **Step 1: Failing suite** (pattern of `supabase/tests/offboarding.test.sql`, `Zz` fixtures):
  `the helper's no_pm agrees with admin_work_project_rows for every running project`;
  `set_office_head refuses a non-admin, a student, an admin, a member of another office, an
  inactive member, an archived office`; `set_office_head sets and clears, one audit row each`;
  `moving the head to another office clears the seat, actor = the admin`; `removing their office
  clears it`; `making the head a student clears it`; `deactivating the head clears it`;
  `admin_offboard_member on the head clears it`; `reactivating does not restore it`;
  `a member and another head read no office_heads row; the head reads their own`;
  `admin_office_heads lists heads for the admin and nothing for others`.
- [ ] **Step 2: Run** `node scripts/db.mjs supabase/offices.sql supabase/offboarding.sql supabase/office-heads.sql supabase/anon-lockdown.sql supabase/tests/offices.test.sql supabase/tests/office-heads.test.sql` — FAIL.
- [ ] **Step 3: Implement.** Helper computes "working PM" as a `pm` row whose profile is active with
  `can_manage_projects` (comment: rule owned by project-roles.sql). Triggers: `after delete or
  update of office_id on office_members` and `after update of status on profiles` (when it stops
  being 'active'); each deletes the seat if the person held it and writes the audit row.
- [ ] **Step 4: Run twice** (same command, plus `supabase/tests/offboarding.test.sql`). All PASS.
- [ ] **Step 5: Commit** — "Name one head per office".

### Task 2: Head reads

**Files:** Modify `supabase/office-heads.sql`, `supabase/tests/office-heads.test.sql`.

**Interfaces:**
- Produces (security definer, zero rows unless the caller is the active head of a live office):
  `my_headed_office() returns table(office_id uuid, office_name text)`;
  `my_office_overview() returns table(spaces int, running_projects int, people int, needs_attention int)`;
  `my_office_attention() returns table(project_id uuid, project_name text, space_name text, no_pm
  boolean, quiet_since timestamptz, i_am_on boolean)` (from `office_attention_rows()`, filtered to
  the office; ordered no-PM first, then oldest quiet);
  `my_office_spaces() returns table(space_id uuid, space_name text, running_projects int)`;
  `my_office_people() returns table(id uuid, name text)` (active members filed in the office, by name).
- [ ] **Step 1: Failing assertions:** each read refuses (zero rows) a member, the admin, and the
  head of another office; `my_office_overview equals that office's admin_org_overview row`;
  `my_office_attention lists the office's quiet and no-PM projects only`; `i_am_on is true only
  where the head is a general_members row`; `spaces and people match the office`; the column lists
  are pinned with `pg_get_function_result`.
- [ ] **Step 2–4:** run (FAIL), implement, run twice (PASS).
- [ ] **Step 5: Commit** — "Let an office head read their office".

### Task 3: Data layer, Offices head select, Admin Home head names

**Files:**
- Create: `src/lib/api/officeHeads.ts`, `src/lib/officeHeads.ts`, `src/lib/officeHeads.test.ts`
- Modify: `src/lib/types.ts` + `src/lib/auditSentence.test.ts` (audit `office_head_changed`,
  label 'Office head changed', sentence `The office ${who} now has ${after || 'no head'} as head`),
  `src/pages/app/admin/AuditLog.tsx` (icon `briefcase`, muted tone),
  `src/pages/app/admin/offices/OfficeDetail.tsx` (+ its tests in `Offices.test.tsx`),
  `src/pages/app/admin/home/OfficesBand.tsx` (+ `AdminHome.test.tsx`)

**Interfaces:**
- Produces in `lib/api/officeHeads.ts`: `setOfficeHead(officeId, userId | null)`,
  `adminOfficeHeads(): Promise<{ office_id: string; head_id: string; head_name: string }[]>`,
  `myHeadedOffice(): Promise<{ office_id: string; office_name: string } | null>`,
  `myOfficeOverview()`, `myOfficeAttention()`, `myOfficeSpaces()`, `myOfficePeople()` typed to
  Task 2's columns; types in `lib/officeHeads.ts`.
- Offices detail: a **Head** select (the office's active members plus "No head"), calling
  `setOfficeHead`, toast, reload. Admin Home's Offices band shows the head's name under each office
  name, or "No head".
- [ ] **Step 1: Failing tests:** `auditSentence names the new head and says no head when cleared`;
  Offices `the Head select lists the office's active members and calls setOfficeHead`; AdminHome
  `each office row names its head or says No head`.
- [ ] **Step 2–4:** run (FAIL), implement, run + `npm run build` (PASS).
- [ ] **Step 5: Commit** — "Choose an office head on Offices".

### Task 4: Rail entry and the My office page

**Files:**
- Modify: `src/lib/paths.ts` (`office: '/office'`), `src/components/app/nav.ts` (+ `nav.test.ts`),
  `src/components/app/SideNav.tsx` (reads `myHeadedOffice()` once), `src/App.tsx` (route inside
  `ProtectedRoute` + `AppShell`, members only)
- Create: `src/pages/app/MyOffice.tsx`, `src/pages/app/MyOffice.test.tsx`

**Interfaces:**
- `navFor(profile, admitted, membership?, headsOffice?: boolean)`; the entry `{ label: 'My office',
  icon: 'briefcase', to: paths.office }` goes into the rail's first main group (`TEACHING_MAIN`,
  `STAKEHOLDER_MAIN`, the in-nothing group, or `OVERVIEW`) when `headsOffice` is true.
- My office page: banner with the office name; four bands (figures, needs attention, spaces, people)
  in Admin Home's band style, each loading/empty/failed-with-retry on its own; attention lines link
  to the project only when `i_am_on`; a non-head is redirected Home.
- [ ] **Step 1: Failing tests:** nav `adds My office to each member rail only when headsOffice`;
  nav `headsOffice never changes which rail a member gets`; nav `no My office while the flag is
  undefined`; MyOffice `renders the four bands`, `links only projects the head is on`, `a failed
  band shows a retry while the others render`, `a non-head is sent Home`.
- [ ] **Step 2–4:** run (FAIL), implement, run + `npm run build` (PASS).
- [ ] **Step 5: Commit** — "Give an office head a My office page".

### Task 5: Docs and checks

- Modify `docs/07-backup.md` (`office-heads.sql` after `offboarding.sql` in every run line; an
  entry noting it reads `offices.sql`'s helper), `CLAUDE.md` (an "Office heads" bullet), `handoff.md`
  (dated section, Deferred, "Browser walk: pending").
- [ ] `npm run build`, `npm test`, and the SQL command with all three suites. Green.
- [ ] Commit "Document office heads". The controller walks it (naming a head only on a throwaway
  office it creates and deletes, then viewing My office would need that person's sign-in, so the
  walk covers the admin side; the head page is proven by tests) and stops for review before push.
