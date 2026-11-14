# Notices by office or group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each program notice one audience (Everyone, chosen offices, or chosen groups),
enforced in the database, and show the notice card on every Home it is meant for.

**Architecture:** A new `supabase/notice-audience.sql` adds audience columns, one shared check
`notice_reaches`, and takes ownership of the notices read policy, both views and the notifier from
`program-notices.sql`. The app gains a Send to choice with a live reach count on the Notices page and
places `ProgramNotices` on the member Homes.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-notice-audience-design.md`

## Global Constraints

- Audience values: `everyone` | `offices` | `groups`; groups: `students` | `teaching` | `staff`.
  Students = `role = 'student'`; teaching = `role = 'member'` and `can_teach`; staff = `role =
  'member'` and not `can_teach`. Admins are in no group.
- A notice is readable and notified only within its audience (the admin reads all); inactive
  accounts are never in an audience.
- `notice_reaches` stays executable by `authenticated` and answers false unless `p_user =
  auth.uid()` or the caller is an admin.
- Existing notices become `everyone`; a sent notice's audience never changes.
- `supabase/notice-audience.sql` runs after `supabase/office-heads.sql`, before
  `supabase/anon-lockdown.sql`; re-running `program-notices.sql` means re-running it afterwards.
  Apply with `node scripts/db.mjs supabase/notice-audience.sql supabase/anon-lockdown.sql <suite>`
  (live project; approved; additive plus the four owned objects; suites roll back).
- Supabase errors reach the person as-is via `authErrorMessage`.
- Tokens only; sentence case, no "please", "successfully" or exclamation marks; desktop first; repo
  style no semicolons, single quotes; never run a formatter over whole files. `npm run build` passes
  before a task is done.

## Review Focus

1. **Realtime**: a non-audience subscriber receives no insert or update for a notice (RLS on the
   table). Test the policy in Task 1.
2. **A hand-built row**: `notice_reaches(row(...)::program_announcements, someone_else)` returns false
   for a non-admin. Test in Task 1.
3. **A teacher filed in an office**: an Offices notice for that office reaches them on Professor
   Home. Test in Task 1 (SQL) and Task 3 (placement doesn't duplicate).
4. **An office archived after a notice was sent to it**: its members still read the notice (they are
   still filed until moved). Test in Task 1.
5. **Reach count vs notified**: `admin_notice_reach` equals the rows the notifier writes, including
   someone with announcements off excluded. Test in Task 1.

---

### Task 1: Audience in the database (`supabase/notice-audience.sql`)

**Files:** Create `supabase/notice-audience.sql`, `supabase/tests/notice-audience.test.sql`.

**Interfaces:**
- Produces: columns `audience text`, `audience_offices uuid[]`, `audience_groups text[]` on
  `program_announcements` with the shape check; `notice_reaches(program_announcements, uuid)
  returns boolean`; redefined `program_announcements_read` policy, `program_notices` (+ `audience`),
  `program_notices_all` (+ `audience`, `audience_offices`, `audience_groups`, `audience_office_names
  text[]`), `notify_program_announcement`; trigger refusing audience changes with "A sent notice
  keeps its audience. Take it down and send a new one."; `admin_notice_reach(p_audience text,
  p_offices uuid[], p_groups text[]) returns int`.
- [ ] **Step 1: Failing suite** (pattern of `supabase/tests/office-heads.test.sql`, `Zz` fixtures):
  every case in the spec's Tests (SQL) list, plus the five Review Focus items, plus: a notice row
  inserted with an `offices` audience and an empty list is refused; `program_notices` column list
  pinned.
- [ ] **Step 2: Run** `node scripts/db.mjs supabase/notice-audience.sql supabase/anon-lockdown.sql supabase/tests/notice-audience.test.sql` — FAIL.
- [ ] **Step 3: Implement** (start from the live `pg_get_viewdef` / `pg_get_functiondef` of the four
  owned objects, keep `security_barrier` on both views).
- [ ] **Step 4: Run twice** — PASS. Also run `supabase/tests/offices.test.sql` once to confirm nothing
  in phase 1 broke.
- [ ] **Step 5: Commit** — "Aim a program notice at offices or groups".

### Task 2: Notices page (compose with audience, labels, the list bug)

**Files:** Modify `src/lib/api/program.ts` (+ types), `src/pages/app/admin/Notices.tsx`; Test
`src/pages/app/admin/Notices.test.tsx` (new).

**Interfaces:**
- `postNotice({ title, body, pinned, audience, audienceOffices, audienceGroups })`;
  `noticeReach(audience, offices, groups): Promise<number>`; `ProgramNoticeRecord` gains the audience
  fields; `listAllNotices` drops `.order('expired', …)`.
- Compose: **Send to** radio (Everyone / Offices / Groups); Offices shows live offices as checkboxes
  (from `listOffices`, archived excluded); Groups shows Students / Teaching faculty / Office staff;
  the existing "will notify" line uses `noticeReach` (debounced); Send disabled while Offices or
  Groups has nothing ticked. Each listed notice shows its audience label ("Everyone", office names
  joined, or group names joined); edit shows it read-only.
- [ ] **Step 1: Failing tests:** `lists notices without asking for an expired column` (the mock
  asserts the order calls); `sends an Offices notice with the ticked offices`; `disables Send with no
  office ticked`; `shows the reach count`; `labels each notice with its audience`.
- [ ] **Step 2–4:** run (FAIL), implement, run + `npm run build` (PASS).
- [ ] **Step 5: Commit** — "Choose who a program notice is for".

### Task 3: The card on every member Home

**Files:** Modify `src/pages/app/WaitingHome.tsx` (find its path), `WorkOverview` (only when
`standalone`), `src/pages/app/StakeholderHome.tsx`; tests beside them.

- [ ] **Step 1: Failing tests:** `WaitingHome shows ProgramNotices`; `standalone WorkOverview shows
  ProgramNotices`; `stacked WorkOverview does not` (so Professor/Student Home show it once);
  `StakeholderHome shows ProgramNotices`.
- [ ] **Step 2–4:** run (FAIL), implement in the same visual slot the professor and student Homes
  use, run + `npm run build` (PASS).
- [ ] **Step 5: Commit** — "Show program notices on every member Home".

### Task 4: Docs and checks

- Modify `docs/07-backup.md` (`notice-audience.sql` after `office-heads.sql` in every run line; an
  entry naming the four objects it takes from `program-notices.sql` and the re-run rule),
  `CLAUDE.md` (a "Notice audiences" bullet), `handoff.md` (dated section, Deferred incl. the
  rate-limit copy if not fixed, "Browser walk: pending").
- [ ] `npm run build`, `npm test`, and the Task 1 command. Green. Commit "Document notice audiences".
- [ ] The controller walks it as the admin: the Notices list now loads, the compose dialog's Send to
  and reach count work; it sends nothing unless the user asks.
