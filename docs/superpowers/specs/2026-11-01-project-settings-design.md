# Project Settings tab — design

Date: 2026-11-01. Source: the owner's "Project Settings Recommendations 1–5" PDF
(sections 1–5), narrowed to what Collabify needs now.

## Why

The owner wants options for how sprints run in a work project — above all, that a
sprint can finish and the next one start on their own when the end date passes
(today both are always by hand; see the Sprint 3 / Dec 9 question). There is no
place for per-project options, so this adds a **Settings** tab to work projects and
gathers the project's existing management controls there instead of scattering
them across People, Overview → Project info and the header.

Success: a project manager opens one tab to run the project — details, stages,
people, and sprint rules — and Barangay Tuktukan Website can roll from Sprint 3 to
Sprint 4 on Dec 10 without anyone clicking.

## Goals

1. A **Settings** tab on work projects with a side menu: **General**, **Sprints**,
   **Tasks**, **Members & permissions**.
2. **Sprints** gets new, per-project options (all new code; see below).
3. Everything else in Settings is **moved, not rebuilt**: same components, same
   rules, same database calls.
4. Start, finish and reopen of a sprint are limited to the project manager and
   coordinators, **enforced in the database**.

## Non-goals (this upgrade)

- No new task features: no priority, subtasks, dependencies, required assignee,
  or completion rules (PDF section C beyond stages).
- No milestone settings (PDF D), project-level notification settings (PDF F),
  project color/icon or default view (PDF A), custom permission matrix (PDF E),
  templates or workflow automation (PDF 3). Custom fields and "Save as template"
  already exist and stay as they are.
- No per-team sprints yet. "Multiple sprint streams" and "Flexible parallel" show
  as unavailable ("soon").
- Class boards (`board_sprints`, class projects) are untouched.
- No change to who may do what in Members & permissions.

## Anti-goals

- Settings that look like they do something but don't. The two "soon" options are
  the only exception, and they are visibly disabled.
- Automation that creates a duplicate sprint, or creates sprints in a project
  nobody is running.
- Losing a link: anything that pointed at the People tab must still land on the
  same content.

## Constraints

- Follow `CLAUDE.md`: tokens only, desktop first then tablet and phone, copy style,
  `supabase/*.sql` idempotent, new member-write paths use `general_can_write`,
  restore order recorded in `docs/07-backup.md`, `anon-lockdown.sql` re-run last.
- The owner reviews every change before it is pushed to `main` (live site), and
  database changes that affect the live site also wait for that review.
- `guard_sprint_state` is now owned by `supabase/sprint-reopen.sql`; any change to
  it starts from the live `pg_get_functiondef`.

## Decided by the owner

### The tab

- **Settings replaces People** in the project tab row: Overview, Plan, Tasks,
  Conversations, Files, Settings. The open-access-request count People shows moves
  to Settings. `?tab=people` and the `members` alias open Settings → Members &
  permissions.
- **Layout A (side menu)**: section list on the left, one section on the right. On
  a phone the list becomes a row at the top. The open section is in the URL so a
  link can point at Settings → Sprints.
- **Everyone on the project sees Settings**; what a person cannot change is shown
  read-only (stakeholders included, as People is today). Editing follows today's
  rules: General and Tasks need `edit_project` (the project manager); Sprints, the
  project manager and coordinators; Members & permissions, exactly what People
  allows today.

### Sections

- **General**: name, description, start and due dates, status, custom fields —
  moved from Overview → Project info. Bottom of General: **Archive / Restore**
  (project manager), moved from the header button and the archived banner's
  "Restore it". Delete stays where it is (space archive, archived projects only).
- **Tasks**: progress stages and the QA stage — moved from Project info.
- **Sprints**: the new options below.
- **Members & permissions**: everything the People tab has today — member list and
  search, roles, grants, role guide, teams and positions (StructurePanel), invite
  and join code, access requests, handover — unchanged.
- **Overview → Project info** becomes view-only. Its edit buttons become "Edit in
  Settings", linking to the matching section.

### Sprint options (per project, new)

| Option | Values | Default |
|---|---|---|
| Sprint organization | Sequential (on) · Multiple sprint streams (soon, disabled) · Flexible parallel (soon, disabled) | Sequential |
| Finish sprints automatically | on / off | off |
| Start the next sprint automatically | on / off | off |
| Unfinished tasks at finish | Ask on finish · Move to the next sprint · Return to the backlog | Ask on finish |
| Default sprint length | days | 14 |
| Sprint start day | weekday | the weekday the project's first sprint started on, else Monday |
| Start and finish time | time of day | 9:00 AM |

- "Start the next sprint automatically": when the next sprint is due, start it; if
  no sprint is planned, **create the next one, then start it**. Never create one if
  a planned sprint already exists, and **never create one that would start after
  the project's due date** (it may end after it). A project with no due date has
  no such limit.
- **"Ask on finish" is unavailable while "Finish sprints automatically" is on**:
  the choice is greyed out and the project manager or a coordinator must pick
  "Move to the next sprint" or "Return to the backlog", so nothing is decided
  behind anyone's back. The database enforces the same pair.
- "Move to the next sprint" with no next sprint (none planned and none created)
  returns the tasks to the backlog, as the Finish sprint dialog does today.
- **Time is always Philippine time (Asia/Manila)**; no time zone setting.
- **The project manager and coordinators get an in-app notification** whenever
  Collabify finishes, starts or creates a sprint on its own.
- **Who changes sprint options and starts/finishes/reopens sprints: the project
  manager and coordinators**, enforced in the database. Members holding the
  `manage_tasks` grant keep creating, editing and planning tasks into sprints but
  can no longer start or finish them.
- **Later (not now):** per-team sprints. When they exist, a team lead may start and
  finish **their own team's** sprints; reopen stays with the project manager and
  coordinators. Nothing in this design should make that harder (see "Builder
  notes").

## My calls (owner has not confirmed; flagged for review)

1. **Turning auto-finish on while "Ask on finish" is chosen** switches the choice
   to "Move to the next sprint" and says so next to the control; the person can
   change it to "Return to the backlog".
2. **Sprint start day default** is the weekday the project's first sprint
   started on, else Monday.
3. **When things happen** (all in Manila time, at the configured time of day):
   - *Finish*: on the day after the running sprint's `ends_on` (the end date is
     inclusive), once the time is reached.
   - *Start*: when no sprint is running, the earliest planned sprint whose
     `starts_on` is today or earlier starts once the time is reached.
   - *Create*: only right after a sprint finishes (by hand or automatically) with
     auto-start on and nothing planned. A project with no sprints, or whose last
     sprint was finished before auto-start was turned on, never gets one created
     out of nowhere.
   - A created sprint is named "Sprint N" (count + 1, as `nextSprintDraft` does),
     starts on the next start day on or after the day after the finished sprint
     ended (today if that has passed), lasts the default length, has no goal and
     no milestone. If its start day is today, it starts in the same run.
4. **"Unfinished tasks" also shapes the Finish sprint dialog** done by hand:
   "Ask on finish" keeps today's dialog; the other two values pre-select that
   choice in the dialog, and the person can still change it.
5. **Default length and start day also prefill "Create sprint"** in Backlog
   (`nextSprintDraft` reads them).
6. **Notification wording and plumbing**: "Sprint 3 finished on its own. 4
   unfinished tasks moved to Sprint 4." / "Sprint 4 started on its own.", through
   the existing `notifications` table with a new type.
7. **Reopen is unaffected by the settings.** Reopening a sprint while automation
   is on is allowed; if the reopened sprint's end date has already passed,
   automation will finish it again at the next run. The reopen dialog says so
   when that is the case.
8. Sprint options live in their **own table** (not `general_projects` columns),
   because `general_projects` updates need `edit_project`, which coordinators do
   not hold.

## How it is built (builder's guide)

### Database (new file `supabase/sprint-settings.sql`, after `sprint-reopen.sql`)

- Table `general_sprint_settings` (one row per work project, `project_id` primary
  key, cascade on project delete): `auto_finish boolean`, `auto_start boolean`,
  `carry text check in ('ask','next','backlog')` with a table check
  `not (auto_finish and carry = 'ask')`, `length_days int check 1–90`,
  `start_weekday int check 0–6`, `run_at time`, `updated_by`, `updated_at`.
  Missing row = all defaults (read through a function or a coalescing view so the
  app never has to insert first).
- RLS: read with `can_read_general_project`; insert/update only when
  `general_role_of(project) in ('pm','coordinator')` and the project is not
  archived. No delete.
- Start/finish restriction: on `general_sprints`, a state change to `active` or
  `completed` requires `general_role_of(project_id) in ('pm','coordinator')`
  unless it comes from the automation (no `auth.uid()`, i.e. the cron job, or a
  setting the automation function raises, as `sprint-reopen.sql` does).
  `complete_general_sprint`'s permission check changes to the same rule. Update
  `lib/general/permissions.ts` (`ROLE_GUIDE` "Plan sprints and milestones" row and
  a new helper the UI uses to show Start/Finish) to match.
- `run_sprint_automation()` (security definer, `search_path = public`, revoked
  from `public, anon, authenticated`), scheduled with `pg_cron` every 15 minutes
  like the existing `collabify-*` jobs. Per work project with `auto_finish` or
  `auto_start` on and not archived (and respecting the project due date for creation), applying the decided rules above and "My calls" 3 and 6 in one
  transaction per project, idempotent (running twice in the same minute does
  nothing new). Skip and log a project that errors; never stop the whole run.
- Tests: `supabase/tests/sprint-settings.test.sql` (rollback-only): defaults, who
  may change settings, grant holders refused on start/finish, automation finish /
  carry / create / start, no duplicate creation, archived projects skipped, a
  second run is a no-op.
- `docs/07-backup.md`: add the file to the restore order and record that it owns
  the start/finish rule; re-running `sprint-reopen.sql` or an earlier sprint owner
  means re-running this after it.

### App

- `GeneralTabId`: replace `'people'` with `'settings'`; keep `people`/`members`
  as aliases to Settings → Members. Settings section in `?section=`.
- New `components/general/settings/` (or similar) with the side-menu shell and one
  file per section. Sections reuse `MembersTab` (split so its content renders as a
  section), `StructurePanel`, `RoleGuide`, the Project info edit forms from
  `OverviewTab`, and the archive confirm from `GeneralProject.tsx`.
- Sprints section: the table above as controls, saving per change (with a toast)
  or with one Save button — builder's choice, matching how Project info saves.
- `useGeneralProject` loads the sprint settings with the project.
- `SprintsView` / `FinishSprintDialog` / `BacklogView` read the settings (carry
  pre-selection, create-sprint defaults, Start/Finish shown only to PM and
  coordinators).

### Builder notes

- Per-team sprints later will add a team to a sprint and relax "one running per
  project" to "one running per team". Keep the role check in one SQL helper (e.g.
  `general_can_run_sprint(project, sprint)`) so adding "or the lead of this
  sprint's team" is a one-line change.
- The "soon" options are display only; no column for them now.

## Verification

- `npm run build`, Vitest, the new SQL suite plus `work-planning`, `sprint-reopen`,
  `sprint-milestones` suites green.
- Browser walk on localhost as PM, coordinator, member with `manage_tasks` grant,
  QA and stakeholder: who sees and can edit each section; old People links land on
  Members; Project info is view-only; archive/restore from General.
- Automation checked by calling `run_sprint_automation()` inside a rolled-back
  transaction with dates set so a sprint is due, not by waiting for the clock.
