# Default weekly hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every work-space member starts on the space's default weekly hours (40 h), so workload works without setup.

**Architecture:** A side table holds each space's default; `work_person_hours`, the one function every hours read goes
through, falls back to it. `general_space_people_hours` also returns the person's own value so the app can tell
"on the default" from "set". The Members page edits the default; My load stops asking for hours.

**Tech Stack:** Supabase Postgres (SQL suites via `node scripts/db.mjs`), React + TS, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-default-weekly-hours-design.md`

## Global Constraints

- Default with no row: 2400 minutes (40 h). Range 0–10080. Work spaces only; archived spaces refuse.
- Writers: the space's `pm` or `coordinator` (`general_space_members.role`). Readers: members of the space.
- `supabase/work-workload.sql` stays idempotent and redefines nothing another file owns; after applying it, re-run
  `work-leave.sql` then `anon-lockdown.sql`.
- Copy: sentence case, no "please", no "successfully"; errors say what to do next. Tokens only, no raw colors.

## Review Focus

- A person with an own value of 0 stays at 0, never falls back to the default.
- Clearing a person's own value (null) puts them on the default, not on "Not set".
- Changing the default moves everyone on it, and nobody with an own value.
- A Member (not planner) cannot change the default; an archived or class space refuses it.
- The Members field for someone on the default is empty with the default as placeholder; saving an empty field
  for someone with an own value clears it.

---

### Task 1: Database default and fallback

**Files:**
- Modify: `supabase/work-workload.sql` (table, setter, reader, `work_person_hours`, `general_space_people_hours`,
  `general_space_workload_summary`)
- Test: `supabase/tests/work-workload.test.sql`, `supabase/tests/work-leave.test.sql`

**Interfaces:**
- Produces: table `general_space_hours_default(space_id pk → general_spaces, weekly_minutes int not null 0..10080,
  updated_by, updated_at)`, RLS on, no policies.
- Produces: `set_space_default_weekly_minutes(p_space uuid, p_minutes int) returns void` (definer).
- Produces: `space_default_weekly_minutes(p_space uuid) returns int` (definer; members of the space; else refuse
  "You are not in this space.").
- Produces: `general_space_people_hours(...)` returns `(user_id, weekly_minutes, own_weekly_minutes,
  available_minutes, time_off_minutes)`; `weekly_minutes` is the effective value.

- [ ] **Step 1: Write failing checks** in `work-workload.test.sql`:
  `default applies` (u[6], no row → weekly 2400, own null, available 2400 over Mon–Fri);
  `zero stays zero` (own 0 → weekly 0); `cleared falls back` (set null → weekly 2400);
  `default change reaches the unset` (planner sets 1200 → u[6] weekly 1200, u[3] keeps 960);
  refusals: Member ("Only the space's project manager or coordinators can change the default weekly hours."),
  out of range ("Weekly hours run between 0 and 168 hours."), archived space; `members read the default`.
  Replace `not set stays null` and the "no weekly hours" summary/room checks with the new values.
- [ ] **Step 2: Run** `node scripts/db.mjs supabase/tests/work-workload.test.sql` — Expected: FAIL on the first new check.
- [ ] **Step 3: Implement** in `work-workload.sql`; `general_space_people_hours` needs `drop function if exists` first
  (return shape changes). The summary's `people_without_hours` reads the effective value (always 0 now).
- [ ] **Step 4: Apply** `work-workload.sql`, `work-leave.sql`, `anon-lockdown.sql`; run both suites and
  `anon-lockdown.test.sql` — Expected: all PASS (update work-leave checks that assumed missing hours).
- [ ] **Step 5: Commit** "Start everyone on the space's default weekly hours".

### Task 2: App

**Files:**
- Modify: `src/lib/api/workload.ts` (`PeopleHours.own_weekly_minutes`, `spaceDefaultWeeklyMinutes`,
  `setSpaceDefaultWeeklyMinutes`), `src/pages/general/SpaceMembers.tsx`, `src/components/general/MyLoadCard.tsx`
- Test: `src/pages/general/SpaceMembers.test.tsx`, `src/components/general/MyLoadCard.test.tsx`

- [ ] **Step 1: Write failing tests:** Members shows "Default weekly hours" with 40 for a planner and saves through
  `setSpaceDefaultWeeklyMinutes(space, 2400)`; a member on the default has an empty hours field with placeholder
  "40 (default)"; read-only viewers see "40 h (default)"; My load shows "Weekly hours: 40 h · space default" and no
  "Not set" or Set weekly hours field.
- [ ] **Step 2: Run** `npx vitest run src/pages/general/SpaceMembers.test.tsx src/components/general/MyLoadCard.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the "Not set" weekly-hours branches these screens no longer reach.
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` — Expected: PASS.
- [ ] **Step 5: Docs and commit:** CLAUDE.md Space workload bullet ("null is "Not set"" → the default),
  `handoff.md` section. Commit "Edit the space default and stop asking for weekly hours".
