# Project Settings Group 5 (Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the project manager choose which events a work project announces: sprint ending reminder, overdue task alerts, milestone due reminder, overdue milestone alerts, task assignment notices and sprint completion notices.

**Architecture:**
- **Database:** a new file, `supabase/project-notification-rules.sql`, runs after `project-milestone-rules.sql` and before `anon-lockdown.sql`. It adds:
  - five project columns
  - four notification types
  - three "already sent" stamps
  - a daily reminders job
  - a sprint completion notice
  - a project switch on the assignment notice
  - personal-switch checks on the new notices and on the milestone overdue alert
- **App:** a Settings → Notifications section, the milestone switch moved there, links for the new types, and updated Account copy.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens, Supabase Postgres (plpgsql, RLS, pg_cron), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-project-settings-notifications-design.md` (calls 1–19 are referenced by number below).

## Global Constraints

- Work projects only (`class_board_id is null`); class boards untouched.
- Defaults are on, with the PDF timings, for new and existing projects:
  - `sprint_end_reminder_days` 1
  - `milestone_due_reminder_days` 2
  - `task_overdue_alerts`, `task_assignment_notices` and `sprint_completion_notices` true
- Only the project manager edits these (`edit_project`).
- Recipients never include stakeholders or QA (unless QA holds the task, which it cannot). "Planners" means the PM plus coordinators whose profile is active.
- Personal switches (`notification_prefs`), joined the same way the existing notify functions join them:
  - `deadline_reminders`: sprint ending, task overdue (holder and summary), milestone due, milestone overdue
  - `project_updates`: sprint completion
  - `task_assignments`: assignment (unchanged)
- Release boundary: only `routing_state = 'released'` tasks count or alert.
- Time is Asia/Manila. The daily job `collabify-project-reminders` runs at `'0 0 * * *'` UTC. Catch-up, not exact day (call 16). Each item notifies once until its date moves later.
- No flood: applying the file marks every case that already qualifies as sent, without a notice (call 17).
- Copy: sentence case, no exclamation marks, no "please", no "successfully". Tokens only. Idempotent SQL. Redefinitions start from the live `pg_get_functiondef`. Dry-run only until the owner approves.

## Review Focus

1. **The automation finishes a sprint.** The sprint team is told once. Planners get only `sprint_automation`, not a second notice. *(Task 3: "the automation tells the sprint team but not the planners again")*
2. **Unfinished work is carried over.** Holders of carried tasks still hear the sprint finished, and the counts are from before the move. *(Task 3: "carried-over holders are told and counts are from before the move")*
3. **A due time moves later after an overdue alert.** One new alert can go out. Moving it earlier doesn't re-arm the alert. *(Task 2: "moving the due time later allows a new overdue alert")*
4. **The project switch and the personal switch are both off, or only one is.** Either one silences the notice. *(Task 2: "a person's deadline switch silences their reminders"; Task 1: "assignment notices off stops general_task_assigned only")*
5. **The file is applied with work already late.** No notice goes out that morning. *(Task 2: "applying the file marks what already qualifies without notices")*

---

### Task 1: Database — settings, types, assignment switch, milestone overdue personal check

**Files:**
- Create: `supabase/project-notification-rules.sql`, `supabase/tests/project-notification-rules.test.sql`

**Interfaces:**
- Produces:
  - Enum values on `notification_type`: `sprint_ending_soon`, `general_task_overdue`, `milestone_due_soon`, `sprint_completed`. Add them in one committed block at the top (pattern: `sprint-settings.sql`).
  - Columns on `general_projects`:
    - `sprint_end_reminder_days int default 1 check (sprint_end_reminder_days in (1,2,3))`, nullable (null = off)
    - `task_overdue_alerts bool not null default true`
    - `milestone_due_reminder_days int default 2 check (milestone_due_reminder_days in (1,2,3,7))`, nullable
    - `task_assignment_notices bool not null default true`
    - `sprint_completion_notices bool not null default true`
  - Stamps:
    - `general_sprints.end_reminded_at timestamptz`
    - `general_tasks.overdue_notified_at timestamptz`
    - `general_milestones.due_reminded_at timestamptz`
  - Signed-in writes to a stamp are dropped: on insert and update, `if auth.uid() is not null` keep the old value or null. This mirrors `guard_general_milestone_overdue`.
  - Each stamp is cleared when its date moves later:
    - `ends_on` for sprints
    - `due_at` for tasks
    - `due_on` for milestones
    - also when the date is cleared
  - Use separate BEFORE triggers, and don't redefine the existing guards. Name them so they run after the existing guards on each table: check the live trigger names, e.g. `general_tasks_zz_…`.
  - `notify_general_assignment()` is redefined from the live body (latest owner: `general-archive-rbac.sql`; confirm live). It is unchanged except that it sends nothing when the task's project has `task_assignment_notices = false`. `work_task_handoff` notices are untouched (call 7).
  - `send_milestone_overdue_alerts(p_now, p_project)` is redefined from the live body (`project-milestone-rules.sql`). It now also needs the recipient's `deadline_reminders`. The milestone is stamped whether or not anyone received it.
- [ ] **Step 1: Write the failing suite.** Use the group 4 harness. Checks:
  - `'new projects get the PDF defaults'`
  - `'only the project manager can change the notification settings'` (coordinator, member: 0 rows, values unchanged)
  - `'reminder days accept only the offered choices'`
  - `'assignment notices off stops general_task_assigned only'` (a handoff still sends `work_task_handoff`)
  - `'assignment notices on keep today's behaviour'`
  - `'a person's deadline switch silences the milestone overdue alert'`
  - `'a signed-in person cannot write a reminder stamp'`
  - `'moving a date later clears its stamp, moving it earlier keeps it'` (one check per table)
  - `'class boards are untouched'`
- [ ] **Step 2: Dry-run.** In the scratch copy, swap the new enum values for an existing one. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `project-milestone-rules`, `general-tasks`, `work-task-handoff`, `sprint-settings`, `project-task-rules` and `project-member-rules` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Add project notification settings and assignment switch".

### Task 2: Database — daily reminders job

**Files:**
- Modify: `supabase/project-notification-rules.sql`, `supabase/tests/project-notification-rules.test.sql`

**Interfaces:**
- Consumes: Task 1 columns, stamps and types.
- Produces: `send_project_reminders(p_now timestamptz default now(), p_project uuid default null) returns int`. It is security definer and revoked from public, anon and authenticated. It returns the number of items stamped. `v_today = (p_now at time zone 'Asia/Manila')::date`. It covers live work projects only: not archived, not trashed.
  - **Sprint ending** (`sprint_end_reminder_days` not null):
    - Applies to the `active` sprint with `ends_on >= v_today`, `ends_on - v_today <= days` and `end_reminded_at is null`.
    - Planners get `sprint_ending_soon` with `general_project_id`.
    - Title: "{sprint} ends tomorrow" when `ends_on - v_today = 1`, "{sprint} ends today" when 0, else "{sprint} ends in {n} days".
    - Preview: "{k} tasks remain unfinished." (with "1 task remains unfinished." for one), or "Every task is done." when k = 0.
    - k counts the sprint's released, live tasks with `status <> 'done'`.
  - **Task overdue** (`task_overdue_alerts`):
    - Applies to released, live (not archived, not trashed), `status <> 'done'` tasks with `due_at` set, `(due_at at time zone 'Asia/Manila')::date < v_today` and `overdue_notified_at is null`.
    - Each holder (`general_task_assignees`) gets `general_task_overdue` with `general_task_id`. Title "{task} is overdue", preview "It was due {Mon D}.".
    - Planners get one notice per project per run for that run's newly stamped tasks: `general_task_overdue` with no `general_task_id`, title "{k} tasks became overdue in {project}" ("1 task became overdue in {project}"), preview "Open Tasks to see them.".
  - **Milestone due** (`milestone_due_reminder_days` not null):
    - Applies to unreached milestones with `due_on >= v_today`, `due_on - v_today <= days` and `due_reminded_at is null`.
    - Planners get `milestone_due_soon`. Title "{milestone} is due tomorrow" / "is due today" / "is due in {n} days", preview "{project}".
  - Every notice needs the recipient's `deadline_reminders`. Stamp with `p_now`, using `for update skip locked` like `send_milestone_overdue_alerts`.
  - Cron `'collabify-project-reminders'` at `'0 0 * * *'`, unschedule then schedule.
  - At the end of the file, a no-notice pre-mark (call 17): stamp `now()` on every sprint, task and milestone that would qualify at apply time. Base it on the same conditions with the project switches ignored, so turning a switch on later doesn't send old cases.
- [ ] **Step 1: Add failing checks** (always pass `p_project`, with fixed `p_now` values):
  - `'a sprint ending tomorrow tells the planners once with the unfinished count'`
  - `'a sprint ending reminder catches up after a missed morning'`
  - `'an overdue task tells its holders and sends the planners one summary'`
  - `'private planning, done, archived and trashed tasks never alert'`
  - `'a task in QA can be overdue'`
  - `'moving the due time later allows a new overdue alert'`
  - `'a milestone due in two days tells the planners once'`
  - `'reached and undated milestones never get a due reminder'`
  - `'each project switch off sends nothing for its notice'`
  - `'a person's deadline switch silences their reminders'`
  - `'stakeholders and qa get none of these'`
  - `'a second run sends nothing new'`
  - `'archived and trashed projects are skipped'`
  - `'applying the file marks what already qualifies without notices'`. Simulate with a fixture that qualifies before the pre-mark block runs. If the splice order makes that impractical, assert the pre-mark statement's effect directly on fixture rows.
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus Task 1's siblings. Expected: 0 failures.
- [ ] **Step 5: Commit** "Send sprint, task and milestone reminders each morning".

### Task 3: Database — sprint completion notice

**Files:**
- Modify: `supabase/project-notification-rules.sql`, `supabase/tests/project-notification-rules.test.sql`

**Interfaces:**
- Consumes: Task 1 columns and types.
- Produces:
  - A sprint completion notice for each finish path, by a person (`complete_general_sprint`) or by the automation (`run_sprint_automation`).
  - Capture the counts and the sprint team before unfinished work moves. First read the live `complete_general_sprint` and `run_sprint_automation` for the order of the carry and the state change. If the state changes first, a BEFORE UPDATE OF `state` trigger on `general_sprints` (`active` → `completed`) can capture. If the carry runs first, redefine both finish paths from their live bodies so they capture before the carry and send after it. Record the choice in the report.
  - Recipients:
    - Planners, plus every holder of a released task in the sprint at that moment.
    - Not the signed-in finisher (`auth.uid()`).
    - When `current_setting('collabify.sprint_automation', true) = 'on'` (check the live flag name and value), planners are skipped, because `sprint_automation` already told them.
    - Each recipient needs `project_updates`.
    - Gated by `sprint_completion_notices`.
  - Type `sprint_completed` with `general_project_id`. Title "{sprint} is finished".
  - Preview "{done} of {total} tasks done." plus " {moved} moved to {next sprint}." or " {moved} went back to the backlog." when moved > 0. Totals count released, live tasks.
- [ ] **Step 1: Add failing checks:**
  - `'finishing a sprint tells the planners and the sprint team, not the finisher'`
  - `'carried-over holders are told and counts are from before the move'`
  - `'work sent back to the backlog is counted in the preview'`
  - `'the automation tells the sprint team but not the planners again'`
  - `'sprint completion notices off sends nothing'`
  - `'a person's project updates switch silences it'`
  - `'reopening and finishing again announces again'`
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `sprint-settings`, `sprint-reopen` (if present), `sprint-milestones`, `work-milestones` and Task 1's siblings. Expected: 0 failures.
- [ ] **Step 5: Commit** "Announce finished sprints to the planners and the sprint team".

### Task 4: App — Notifications section, moved switch, links, Account copy

**Files:**
- Modify:
  - `src/lib/general/navigation.ts`: `SettingsSection` gains `'notifications'`.
  - `src/components/general/settings/ProjectSettings.tsx`: add "Notifications" after Members & permissions, with an existing bell-like `IconName`.
  - Create `src/components/general/settings/NotificationsSection.tsx`.
  - `src/components/general/settings/MilestonesSection.tsx`: remove the "Overdue milestone alerts" switch and stop sending that column.
  - `src/lib/api/general.ts`: `getGeneralProject` returns `notificationRules: { sprintEndDays: 1|2|3|null; taskOverdue: boolean; milestoneDueDays: 1|2|3|7|null; assignment: boolean; sprintCompletion: boolean }`. Missing-column fallback to the defaults, with a "remove once live" comment. `ProjectPatch` accepts the five columns.
  - `src/lib/types.ts` and `src/components/app/notificationDestination.ts` (or wherever `destination()` now lives):
    - `sprint_ending_soon` and `sprint_completed` go to `?tab=plan&work=sprints`.
    - `general_task_overdue` goes to the task when `general_task_id` is set, else `?tab=tasks`.
    - `milestone_due_soon` goes to `?tab=plan&work=milestones`.
    - Add an icon/label wherever the bell maps types.
  - `src/pages/Settings.tsx` `NOTIFICATIONS`: update the "Deadline reminders" description to name sprint ending, overdue task and milestone reminders, and "Project updates" to name finished sprints. Sentence case.
- Test: `settings/NotificationsSection.test.tsx`, `MilestonesSection.test.tsx`, `notificationDestination` test, `general.ts` API test.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces the panel:
  - Title "Notifications". Help: "These decide what this project sends. Each person can still turn notices off for themselves in Account → Notifications."
  - Exact labels, in order:
    - "Sprint ending reminder" (select: "Off" / "1 day before" / "2 days before" / "3 days before")
    - "Overdue task alerts"
    - "Milestone due reminder" (select: "Off" / "1 day before" / "2 days before" / "3 days before" / "1 week before")
    - "Overdue milestone alerts" (help: "The project manager and coordinators are told the morning after a missed due date.")
    - "Task assignment notices"
    - "Sprint completion notices"
  - Button "Save notification settings", toast "Notification settings saved". One `updateGeneralProject` call with the six columns (`milestone_overdue_alerts` included).
  - Editable when `state.can('edit_project') && !state.readOnly`, read-only otherwise. Follow `MilestonesSection`.
- [ ] **Step 1: Write failing tests:**
  - The panel's payload and toast.
  - Read-only for non-PM and in an archived project.
  - "Off" maps to null.
  - The Milestones panel no longer shows the overdue switch.
  - Each new type's destination.
  - `getGeneralProject` maps the columns and falls back only on a missing column.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`, and `npx eslint` on the changed files. Expected: PASS.
- [ ] **Step 5: Commit** "Add project notification settings".

### Task 5: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: add the file after `project-milestone-rules.sql` in both restore commands and the rerun tail, plus an ownership section and the re-run rule. Re-running `project-milestone-rules.sql`, `general-archive-rbac.sql` (or whichever file owns `notify_general_assignment` live) or `sprint-settings.sql` means re-running this file afterwards, then `anon-lockdown.sql`.
  - `scripts/schema-drift.mjs`: the order.
  - `CLAUDE.md`: one concise bullet after the milestone bullet.
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Checks.**
  - Build, vitest, eslint and contrast.
  - SQL dry-runs of `project-notification-rules` plus every sibling named in Tasks 1–3.

  Expected: green.
- [ ] **Step 2: Commit** "Document project notification settings".
- [ ] **Step 3: Stop for owner review**, then:
  1. `node scripts/db.mjs supabase/project-notification-rules.sql supabase/anon-lockdown.sql`
  2. A read-only check.
  3. Re-run the suites.
  4. Push `main`.
