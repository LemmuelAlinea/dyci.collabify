# Admin offices and organization overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin offices (one home office per member, one office per work space), a
rail grouped as Organization / Academic program / Compliance, and an Admin Home that reads the
organization at a glance, without the admin ever reading inside a project.

**Architecture:** One new idempotent SQL file, `supabase/offices.sql`, holds three tables,
three triggers, admin-only RPCs and admin-only read functions that return names and counts.
It redefines nothing another file owns. The frontend reads it through `lib/api/offices.ts`
with types and pure helpers in `lib/offices.ts`; the pages are a new Offices page plus edits
to the nav, Accounts, the bulk import, the admin Archive, the Audit log and Admin Home.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind
tokens, Vitest, Deno Edge Functions.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-offices-overview-design.md`

## Global Constraints

- Counts and names only: no function here returns a task, comment, file, milestone title or
  due date, and no admin link opens a project.
- Every write is an admin-only RPC (`public.is_admin()` and active status); no direct write
  policies on the three new tables.
- `supabase/offices.sql` is idempotent, runs after `peer-round-delete.sql` and before
  `anon-lockdown.sql`, and redefines no existing function, trigger, view or policy.
- New `audit_action` values are added in their own committed transaction before any use.
- Offices are for `member` accounts only; students and admins never have one.
- Work spaces only (`general_spaces.kind = 'work'`); education spaces never get an office.
- Quiet: no `general_task_events` row with a non-null `actor_id` for 14 days, and the project
  has at least one live task not `done` or has no live tasks at all.
- Running project: `class_board_id is null`, `archived_at is null`, `trashed_at is null`, in a
  work space that is not archived or trashed.
- No hardcoded colors: tokens from `src/styles/index.css`. Status chips use `warning-*`,
  `danger-*`, `pending-*`, never `red-*`, `emerald-*` or brand amber.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully";
  errors say what happened and what to do next.
- Desktop layout first, then tablet, then phone.
- `npm run build` passes before any task is called done.

## Review Focus

1. **Two offices with names differing only in case or spaces** ("IT  Services" vs "it
   services"): the second create, rename or restore is refused with the clash named. Test in
   Task 1.
2. **Assigning to an archived office**: refused, never silently filed. Test in Task 1.
3. **An admin's own account or a pending bulk import**: an admin cannot be given an office; a
   pending (bulk) member can, and is left out of `people` until active. Test in Task 1/2.
4. **A space moved out of `work` kind or archived after filing**: an archived space keeps its
   row but leaves the counts; an education space is never listed. Test in Task 2.
5. **Admin Home when one of the four reads fails**: each band fails on its own with a retry;
   the rest still render. Test in Task 8.

---

### Task 1: Offices data and writes (`supabase/offices.sql`)

**Files:**
- Create: `supabase/offices.sql`
- Create: `supabase/tests/offices.test.sql`

**Interfaces:**
- Produces (SQL):
  - Tables `public.offices(id uuid pk, name text, description text default '', archived_at
    timestamptz, created_by uuid, created_at, updated_at)`; unique index
    `offices_live_name` on `lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))` where
    `archived_at is null`; name check 1 to 80 characters after trim.
  - `public.office_members(user_id uuid pk → profiles on delete cascade, office_id uuid →
    offices, assigned_by uuid, assigned_at timestamptz default now())`.
  - `public.office_spaces(space_id uuid pk → general_spaces on delete cascade, office_id uuid
    → offices, assigned_by uuid, assigned_at timestamptz default now())`.
  - Audit values: `office_created`, `office_renamed`, `office_archived`, `office_restored`,
    `office_deleted`, `office_changed`, `space_office_changed`.
  - RPCs, all `security definer`, refusing anyone but an active admin with
    `'Only an admin can change offices.'`:
    - `create_office(p_name text, p_description text default '') returns public.offices`
    - `rename_office(p_office uuid, p_name text, p_description text) returns public.offices`
    - `archive_office(p_office uuid) returns void`
    - `restore_office(p_office uuid) returns void`
    - `delete_office(p_office uuid) returns void`
    - `set_member_office(p_user uuid, p_office uuid) returns void` (null clears)
    - `set_space_office(p_space uuid, p_office uuid) returns void` (null clears)
    - `set_member_office_by_name(p_email text, p_office_name text) returns text`, one of
      `'set'`, `'unknown_office'`, `'not_member'`, `'no_account'`; matches the office by the
      same normalized name as the unique index, live offices only.

- [ ] **Step 1: Write the failing suite** `supabase/tests/offices.test.sql`, in the pattern of
  `supabase/tests/space-roles.test.sql` (`pg_temp.act_as`, `pg_temp.must_be`, `begin` …
  `rollback`). Seed an admin, two members, a student, a work space and an education space.
  Assertions (each a `must_be` label):
  - `a member cannot create an office` (raises), `the admin creates Registrar`.
  - `a second office named "  registrar " is refused`; the message contains `Registrar`.
  - `a member cannot set their own office`; `a member cannot set a space's office`.
  - `the admin cannot give a student an office`; `the admin cannot give an admin an office`.
  - `a pending member can be given an office`.
  - `assigning to an archived office is refused`.
  - `a new work space created by a member in Registrar starts in Registrar`;
    `an education space never gets an office row`; `a space created by someone with no
    office has no row`.
  - `a member made student loses their office` and an `office_changed` audit row exists with
    `before_value = 'Registrar'` and `after_value = ''`.
  - `archive with one active member is refused`, message `Move its 1 person first.`;
    with people and spaces: `Move its 3 people and 2 spaces first.`
  - `archive ignores a rejected member and clears their office`.
  - `archive ignores an archived space, which keeps its row`.
  - `restore is refused while a live office has the same name`.
  - `delete is refused for a live office`; `delete of an archived office removes its
    remaining space rows`.
  - `set_member_office_by_name` returns `'unknown_office'`, `'not_member'` (student),
    `'no_account'` and `'set'` in the four cases.
  - Each write leaves exactly one audit row of its action.

- [ ] **Step 2: Run it and see it fail**

  Run: `node scripts/db.mjs supabase/tests/offices.test.sql`
  Expected: error, `relation "public.offices" does not exist` (or function missing).

- [ ] **Step 3: Write `supabase/offices.sql`.**
  - First transaction: `alter type public.audit_action add value if not exists …` for the
    seven values, then `commit` (as `supabase/access.sql:32-41` does).
  - Tables, index, `touch_updated_at` trigger on `offices`.
  - `office_members_member_only` (before insert or update on `office_members`): refuse unless
    the profile's role is `member`, `'Only members have an office.'`; refuse an archived
    office, `'This office is archived. Restore it first.'`.
  - `office_spaces_work_only` (before insert or update on `office_spaces`): refuse unless the
    space is `kind = 'work'`; refuse an archived office.
  - `general_spaces_office_default` (after insert on `general_spaces`, security definer):
    when `new.kind = 'work'` and `new.created_by` has an `office_members` row whose office is
    live, insert the `office_spaces` row with `assigned_by = new.created_by`.
  - `profiles_office_role` (after update of role on `profiles`, security definer): when the
    new role is not `member`, delete the `office_members` row and write `office_changed`
    (actor `auth.uid()`, subject the person, before the office name, after `''`).
  - RLS: enable on all three. `offices`: select for `authenticated`. `office_members`:
    select where `user_id = auth.uid()` or `is_admin()`. `office_spaces`: select where
    `is_admin()` or `is_general_space_member(space_id)` (confirm the exact helper name in
    `general-spaces.sql`). No insert/update/delete policies.
  - The RPCs above. Archive counts active members (`profiles.status = 'active'`) and live
    spaces (`archived_at is null and trashed_at is null`); the refusal is
    `'Move its N person|people[ and M space|spaces] first.'` with correct singular/plural;
    on success it deletes the office's non-active members' rows. Delete for good requires
    `archived_at is not null` and no `office_members` rows, else
    `'Archive this office and move its people first.'`. Restore refuses a live name clash
    with `'An office named <name> already exists. Rename one of them first.'`.
  - Audit labels: office lifecycle rows use `subject_id = office id`, `subject_label = office
    name`, rename puts old/new names in `before_value`/`after_value`; person rows use the
    person and office names; space rows use the space name and office names. Empty string
    means no office.
  - `revoke all … from public, anon; grant execute … to authenticated` for every function.

- [ ] **Step 4: Apply to a scratch run and pass the suite**

  `scripts/db.mjs` talks to the linked project, which is the live database. `offices.sql` is
  additive (new tables and functions, nothing the live app reads), so it is applied there as
  earlier phases' SQL was, always followed by `anon-lockdown.sql`. The suite rolls back.
  Run: `node scripts/db.mjs supabase/offices.sql supabase/anon-lockdown.sql supabase/tests/offices.test.sql`
  Expected: every line `PASS …`, no `FAIL`. Run the same command a second time: no error
  (idempotent). Use this command wherever a later task re-applies the file.

- [ ] **Step 5: Commit**

```bash
git add supabase/offices.sql supabase/tests/offices.test.sql
git commit -m "Add offices, home offices and space offices for the admin"
```

### Task 2: Admin read functions (same file)

**Files:**
- Modify: `supabase/offices.sql` (append before the final `anon` grants section)
- Modify: `supabase/tests/offices.test.sql`

**Interfaces:**
- Consumes: Task 1 tables; existing `public.admin_work_project_rows()` (for `has_pm`,
  read-only use; do not redefine it).
- Produces (all `stable security definer`, return no rows for a non-admin):
  - `admin_office_people() returns table(id uuid, name text, email text, status text,
    office_id uuid)`: every `member` profile.
  - `admin_office_spaces() returns table(id uuid, name text, office_id uuid, archived
    boolean, running_projects int)`: every work space not trashed.
  - `admin_org_overview() returns table(office_id uuid, office_name text, spaces int,
    running_projects int, people int, needs_attention int)`: one row per live office plus
    one row with `office_id null, office_name ''` for Unassigned (live work spaces with no
    row, active members with no row). `spaces` counts live spaces; `people` active members.
  - `admin_attention_projects() returns table(project_id uuid, project_name text, space_name
    text, office_id uuid, office_name text, no_pm boolean, quiet_since timestamptz)`: running
    projects with `no_pm` or quiet; `quiet_since` is the last person-made activity when quiet,
    else null. Ordered no-PM first, then oldest `quiet_since`.
  - `admin_org_summary() returns table(accounts_in_setup int, privacy_due int)`:
    `bulk_setup_required and status = 'pending'`; privacy rows with `status = 'open' and
    acknowledge_by <= current_date + 2` or `status = 'acknowledged' and complete_by <=
    current_date + 2`.
  - Index `general_task_events_person_recent on general_task_events (project_id, created_at
    desc) where actor_id is not null`.

- [ ] **Step 1: Add failing assertions** to the suite:
  - `a member reads no rows from each of the five functions`.
  - `quiet at 15 days`, `not quiet at 13 days` (backdate a person event's `created_at`).
  - `an event with a null actor 1 day ago does not reset quiet`.
  - `a project whose live tasks are all done is never quiet`.
  - `a project with no tasks created 15 days ago is quiet`.
  - `a project whose PM lost Project manager shows no_pm`.
  - `an archived project and a class board project are never listed`.
  - `the Unassigned row counts a space with no office and a member with no office`.
  - `an archived space keeps its office row and leaves spaces and running_projects`.
  - `an education space is not in admin_office_spaces`.
  - `a pending member is not in people`.
  - `privacy_due counts open past acknowledge_by and acknowledged near complete_by, not
    completed`.
  - The column lists of all five functions match the Interfaces above exactly (read
    `pg_get_function_result`), so no project content can be added unnoticed.

- [ ] **Step 2: Run it and see it fail**

  Run: `node scripts/db.mjs supabase/offices.sql supabase/anon-lockdown.sql supabase/tests/offices.test.sql`
  Expected: `FAIL` or `function admin_org_overview() does not exist`.

- [ ] **Step 3: Implement the five functions and the index.**
- [ ] **Step 4: Run it and see it pass** (same command; all `PASS`; re-run the file once more).
- [ ] **Step 5: Commit**

```bash
git add supabase/offices.sql supabase/tests/offices.test.sql
git commit -m "Read offices, attention projects and setup counts for the admin"
```

### Task 3: Frontend data layer

**Files:**
- Create: `src/lib/offices.ts`, `src/lib/offices.test.ts`
- Create: `src/lib/api/offices.ts`
- Modify: `src/lib/types.ts` (`AuditAction`, `AUDIT_ACTIONS`, `auditSentence`)
- Modify: `src/pages/app/admin/AuditLog.tsx` (`ICON`, `TONE` records)

**Interfaces:**
- Produces in `lib/offices.ts`:
  - Types `Office { id; name; description; archived_at: string | null }`,
    `OfficePerson { id; name; email; status: 'active' | 'pending' | 'rejected'; office_id:
    string | null }`, `OfficeSpace { id; name; office_id: string | null; archived: boolean;
    running_projects: number }`, `OfficeOverviewRow { office_id: string | null; office_name:
    string; spaces; running_projects; people; needs_attention: number }`,
    `AttentionProject { project_id; project_name; space_name; office_id: string | null;
    office_name: string; no_pm: boolean; quiet_since: string | null }`,
    `OrgSummary { accounts_in_setup: number; privacy_due: number }`.
  - `sortOverview(rows: OfficeOverviewRow[]): OfficeOverviewRow[]`: by name, case-insensitive,
    Unassigned (`office_id === null`) last.
  - `attentionReason(p: AttentionProject): string`: `'No project manager'` when `no_pm`
    (wins over quiet), else `` `Quiet since ${dayLabel(p.quiet_since)}` `` (use the existing
    `dayLabel` from `lib/report`).
  - `officeName(id: string | null, offices: Office[]): string`: the name, or `'No office'`.
- Produces in `lib/api/offices.ts` (each throws the Supabase error, like `lib/api/accounts.ts`):
  `listOffices(): Promise<Office[]>` (all, archived included), `createOffice(name,
  description)`, `renameOffice(id, name, description)`, `archiveOffice(id)`,
  `restoreOffice(id)`, `deleteOffice(id)`, `setMemberOffice(userId, officeId | null)`,
  `setSpaceOffice(spaceId, officeId | null)`, `listOfficePeople(): Promise<OfficePerson[]>`,
  `listOfficeSpaces(): Promise<OfficeSpace[]>`, `orgOverview():
  Promise<OfficeOverviewRow[]>`, `attentionProjects(): Promise<AttentionProject[]>`,
  `orgSummary(): Promise<OrgSummary>`.
- Audit labels: `office_created` 'Office created', `office_renamed` 'Office renamed',
  `office_archived` 'Office archived', `office_restored` 'Office restored', `office_deleted`
  'Office deleted', `office_changed` 'Office changed', `space_office_changed` 'Space moved'.
  Icon `briefcase` for all seven; tone `surface-sunken text-muted`, except `office_deleted`
  with `class_deleted`'s danger tone.

- [ ] **Step 1: Write failing tests** in `src/lib/offices.test.ts`:
  - `sortOverview puts Unassigned last and sorts the rest by name` (input `IT`, unassigned,
    `events` → `events`, `IT`, unassigned).
  - `attentionReason prefers No project manager over quiet`.
  - `attentionReason names the quiet date` (expects the string to start with `Quiet since `).
  - `officeName returns No office for null and unknown ids`.
- [ ] **Step 2: Run** `npx vitest run src/lib/offices.test.ts`. Expected: FAIL, module not
  found.
- [ ] **Step 3: Implement** `lib/offices.ts`, `lib/api/offices.ts`, and the audit types,
  labels and sentences (sentences in the style of the existing `auditSentence` cases: person
  moves read "<person> moved from <old> to <new>", with `No office` for an empty side).
- [ ] **Step 4: Run** `npx vitest run src/lib/offices.test.ts` then `npm run typecheck`.
  Expected: PASS; no type errors (the `Record<AuditAction, …>` maps force all seven).
- [ ] **Step 5: Commit**

```bash
git add src/lib/offices.ts src/lib/offices.test.ts src/lib/api/offices.ts src/lib/types.ts src/pages/app/admin/AuditLog.tsx
git commit -m "Read offices from the app and label office changes in the audit log"
```

### Task 4: Admin rail in three groups

**Files:**
- Modify: `src/lib/paths.ts` (`admin.offices: '/admin/offices'`)
- Modify: `src/components/app/nav.ts:226-248, 316-326`
- Modify: `src/components/app/nav.test.ts:129-150` and any other `'Admin'` title assertion

**Interfaces:**
- Produces: `adminGroups(withHome: boolean): NavGroup[]` in `nav.ts`, returning
  `Organization` (`[HOME?, Offices (briefcase), Accounts, Work projects, Notices]`),
  `Academic program` (`collapsible: true`; Sections, Syllabi, Curriculum, Classes, Faculty,
  Cohort), `Compliance` (Audit log, Privacy requests). The `ADMIN` constant is removed.

- [ ] **Step 1: Update and add failing tests** in `nav.test.ts`:
  - `gives an admin in nothing Organization, Academic program, Compliance and Account`, and
    their first Organization item is Home.
  - `an invited admin has Home once` (count of `'Home'` labels across groups is 1).
  - `an admin in a space has Home once`.
  - `Offices sits right after Home in Organization and opens /admin/offices`.
  - `Academic program is collapsible`.
  - Rewrite the existing `'Admin'` assertions to the new titles; keep `Work projects` right
    after `Accounts`.
- [ ] **Step 2: Run** `npx vitest run src/components/app/nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `adminGroups`, and in `navFor`'s admin branch: in nothing and not
  invited → `[...adminGroups(true), ADMIN_ACCOUNT]`; invited → `[ADMIN_INVITED,
  ...adminGroups(false), ADMIN_ACCOUNT]`; in something → `[SPACES_ONLY, OVERVIEW,
  workGroup(false), QUICK_ACCESS, ...adminGroups(false), ADMIN_ACCOUNT]`. Update the doc
  comments that say "Admin and Account".
- [ ] **Step 4: Run** `npx vitest run src/components/app` and `npm run typecheck`. Expected: PASS
  (including `SideNav.test.tsx`).
- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts src/components/app/nav.ts src/components/app/nav.test.ts
git commit -m "Group the admin rail as Organization, Academic program and Compliance"
```

### Task 5: Offices page

**Files:**
- Create: `src/pages/app/admin/Offices.tsx` (split dialogs into
  `src/pages/app/admin/offices/*.tsx` if it passes ~350 lines)
- Modify: `src/App.tsx:284-298` (lazy import, `<Route path="/admin/offices" element={<Offices />} />`)
- Test: `src/pages/app/admin/Offices.test.tsx`

**Interfaces:**
- Consumes: Task 3 API and types; `?office=<id>` in the URL selects an office and
  `?office=unassigned` the Unassigned entry (Admin Home links here).

Layout (desktop first): `DirectoryHero` banner like `Sections.tsx`; left a list of live
offices (name, description, people and spaces counts from `listOfficePeople` /
`listOfficeSpaces` filtered to `status = 'active'` / not archived); right the selected
office's people and spaces, each with **Move to** (a `Select` of live offices plus "No
office") calling `setMemberOffice` / `setSpaceOffice`. An **Unassigned** entry at the end of
the list shows members and live spaces with no office. Actions: **New office**, **Rename**,
**Archive** (confirmation dialog; the RPC's refusal text is shown as-is in an `Alert`).
Tablet stacks the two panes; phone shows the list, then the office as its own view.

- [ ] **Step 1: Write failing render tests** (mock `lib/api/offices`):
  - `lists offices with Unassigned last`.
  - `selecting an office from ?office= shows its people and spaces`.
  - `Move to calls setMemberOffice with the chosen office`.
  - `an archive refusal shows the database message`.
  - `an empty program shows "No offices yet" with New office`.
- [ ] **Step 2: Run** `npx vitest run src/pages/app/admin/Offices.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page and route.
- [ ] **Step 4: Run** the test, then `npm run build`. Expected: PASS, build clean.
- [ ] **Step 5: Commit**

```bash
git add src/pages/app/admin/Offices.tsx src/pages/app/admin/offices src/pages/app/admin/Offices.test.tsx src/App.tsx
git commit -m "Add the Offices page for the admin"
```

### Task 6: Office on Accounts and in the bulk import

**Files:**
- Modify: `src/pages/app/admin/Accounts.tsx`
- Modify: `src/lib/bulkAccounts.ts`, `src/lib/bulkAccounts.test.ts`
- Modify: `src/pages/app/admin/BulkRegisterDialog.tsx`
- Modify: `supabase/functions/_shared/bulkAccounts.ts` (`BulkResult.warning?: string`,
  `normalizeBulkUser` keeps an optional trimmed `office`)
- Modify: `supabase/functions/bulk-register-users/index.ts`

**Interfaces:**
- Consumes: `listOffices`, `listOfficePeople`, `setMemberOffice`, `officeName` (Task 3);
  `set_member_office_by_name` (Task 1).
- Produces: `BULK_HEADERS` gains `'office'` (optional); `BulkPreviewRow` gains
  `office: string`.

- [ ] **Step 1: Failing tests** in `bulkAccounts.test.ts`:
  - `reads an optional office column and trims it`.
  - `a file without an office column still parses` (office `''`).
  - `an office on a student row is kept for the preview with a warning "Students have no
    office. It will be ignored."`.
- [ ] **Step 2: Run** `npx vitest run src/lib/bulkAccounts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Parser and preview: show the office column; unknown names are not checked client-side
    (the server reports them).
  - Edge Function: after a `created` or `updated` member row with a non-empty office, call
    `caller.rpc('set_member_office_by_name', { p_email, p_office_name })`; on
    `'unknown_office'` add `warning: 'No office named <name>. Imported with no office.'`;
    blank office on an overwrite calls nothing (keeps the current office). Student rows with
    an office get `warning: 'Students have no office. It was ignored.'`. The results list in
    the dialog shows warnings under the row.
  - Accounts: each member row shows its office (`officeName`) with **Change office** in the
    row menu (a small dialog with a `Select`); a filter by office beside the existing
    filters; students and admins show nothing.
- [ ] **Step 4: Run** `npx vitest run src/lib` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/pages/app/admin/Accounts.tsx src/lib/bulkAccounts.ts src/lib/bulkAccounts.test.ts src/pages/app/admin/BulkRegisterDialog.tsx supabase/functions/_shared/bulkAccounts.ts supabase/functions/bulk-register-users/index.ts
git commit -m "Set a member's office on Accounts and in the bulk import"
```

### Task 7: Offices on the admin Archive

**Files:**
- Modify: `src/pages/app/admin/AdminArchive.tsx`

**Interfaces:**
- Consumes: `listOffices` (archived ones), `restoreOffice`, `deleteOffice` (Task 3).

- [ ] **Step 1: Add the Offices panel** beside Sections, in the same `Panel` pattern, icon
  `briefcase`; Restore and Delete for good with the existing confirmation dialog. Refusals
  (name clash, people still filed) show the database message.
- [ ] **Step 2: Run** `npm run build`. Expected: clean.
- [ ] **Step 3: Commit**

```bash
git add src/pages/app/admin/AdminArchive.tsx
git commit -m "Restore or delete archived offices from the admin Archive"
```

### Task 8: Admin Home as the organization overview

**Files:**
- Modify: `src/pages/app/AdminHome.tsx` (split bands into
  `src/pages/app/admin/home/*.tsx` if it passes ~300 lines)
- Test: `src/pages/app/AdminHome.test.tsx`

**Interfaces:**
- Consumes: `orgOverview`, `attentionProjects`, `orgSummary`, `sortOverview`,
  `attentionReason` (Task 3); `programClasses`, `readiness`, `paceOf` (existing).

Top to bottom, each band loading, empty and failed (with `Alert` `onRetry`) on its own:
1. **Offices** table: Office, Spaces, Running projects, People, Needs attention; rows open
   `/admin/offices?office=<id>` (Unassigned opens the Unassigned entry).
2. **Needs attention**: project, space, office, `attentionReason`. A no-PM line links to
   `paths.admin.projects`; a quiet line has no link. Empty: "Every running project has a
   project manager and recent activity."
3. **Accounts in setup** and **Privacy requests due**: two counts linking to
   `paths.admin.accounts` and `paths.admin.privacy`; a count of zero reads as zero, not
   hidden.
4. **Academic program**: classes that cannot start (`readiness(c).length > 0`) and classes
   behind (`paceOf` covered < elapsed), linking to `paths.admin.classes`; the band is absent
   when `programClasses()` returns no classes.

Rewrite `headline`, `intro` and the `UPCOMING` cards for the organization (Offices, Work
projects, Notices). Remove `GeneralCountsBand` (the Offices band replaces it); keep
`generalCounts` in the API if anything else uses it.

- [ ] **Step 1: Failing render tests** (mock the APIs):
  - `renders an office row per office with Unassigned last`.
  - `names why a project needs attention`.
  - `shows a retry for a failed overview while the other bands still render` (Review Focus 5).
  - `hides the academic band with no classes`.
  - `shows zero accounts in setup as 0`.
- [ ] **Step 2: Run** `npx vitest run src/pages/app/AdminHome.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/pages/app/AdminHome.tsx src/pages/app/admin/home src/pages/app/AdminHome.test.tsx
git commit -m "Make Admin Home the organization overview"
```

### Task 9: Docs, full check and the live walk

**Files:**
- Modify: `docs/07-backup.md` (add `supabase/offices.sql` after `peer-round-delete.sql` in
  both run lines; a short "Offices" entry: what it owns, that it redefines nothing)
- Modify: `CLAUDE.md` (an "Offices" bullet under Project roles: the three tables, admin-only
  RPCs, the counts-only read functions, run position, suite path)
- Modify: `handoff.md` (append a dated section: what shipped, verification, Deferred)

- [ ] **Step 1: Full checks.** Run `npm run build`, `npm test`, and
  `node scripts/db.mjs supabase/offices.sql supabase/anon-lockdown.sql supabase/tests/offices.test.sql`. Expected: all
  green, every suite line `PASS`.
- [ ] **Step 2: Browser walk on the dev server** (`npm run dev`, signed in as the admin):
  create two offices; file a member and a space; see Admin Home's Offices and Needs attention
  bands; archive an office with people (refused with the count), move them, archive, restore
  from Archive; confirm the Audit log lines; check light and dark, and 768 px and 375 px
  widths. Screenshot each.
- [ ] **Step 3: Write the docs** above and commit.

```bash
git add docs/07-backup.md CLAUDE.md handoff.md
git commit -m "Document offices and the organization overview"
```

- [ ] **Step 4: Stop for review.** Do not push `main` or deploy `bulk-register-users` until
  the user has reviewed. On approval: deploy the function (its office field is optional, so
  the old frontend keeps working), then push `main`.
