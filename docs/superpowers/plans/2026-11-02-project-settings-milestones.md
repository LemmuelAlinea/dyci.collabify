# Project Settings Group 4 (Milestone Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project milestone settings:
- automatic or manual completion
- an optional due date
- milestone dependencies
- overdue alerts

**Architecture:**
- **Database:** a new file, `supabase/project-milestone-rules.sql`, runs after `project-member-rules.sql` and before `anon-lockdown.sql`. It adds:
  - the project columns
  - `reached_auto` and `overdue_notified_at` on milestones
  - a nullable `due_on` with a conditional check
  - a dependency table with RPCs
  - triggers that reach or un-reach milestones automatically
  - a daily cron job for overdue alerts
- **App:** a new Settings → Milestones section, mode-aware milestone status in every view, dependency controls, and the notification link.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens, Supabase Postgres (plpgsql, RLS, pg_cron), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-project-settings-milestones-design.md`

## Global Constraints

- Work projects only; class milestones (`project_milestones`) untouched.
- Defaults keep today's behaviour:
  - `milestone_completion` 'automatic'
  - `require_milestone_due` true
  - `allow_milestone_dependencies` true
  - `milestone_overdue_alerts` true
- Only the project manager edits the settings (`edit_project`).
- Dependency edits and marking reached use `general_can_manage_milestones` (group 3).
- Time is Asia/Manila. The overdue job runs at 08:00 Manila and sends one `milestone_overdue` per milestone. Undated and reached milestones never alert.
- In Manual mode, "reached" means `reached_at` is set. In Automatic mode the database sets and clears it (`reached_auto`), and the UI reads `reached_at` in both modes.
- Copy: sentence case, no exclamation marks, no "please", no "successfully". Tokens only. Idempotent SQL. Redefinitions from live definitions. Dry-run only until the owner approves.

## Review Focus

1. **A task reopens after an automatic reach.** The milestone is un-reached. A manual reach stays. *(Task 1: "reopening a task undoes an automatic reach but not a manual one")*
2. **A blocker gets reached later.** A milestone that waited for it is reached automatically at that moment. *(Task 1: "reaching the blocker reaches the waiting milestone")*
3. **The due date moves later after an alert.** One new alert can go out for the new date. *(Task 2: "moving the date later allows a new alert")*
4. **The job runs twice on the same morning.** No second alert. *(Task 2: "a second run sends nothing new")*
5. **The project switches to Manual while a milestone is 100% done.** It stays as it was if already reached. If it wasn't reached, it shows "Ready to mark reached". *(Task 3 UI test)*

---

### Task 1: Database — settings, completion, due dates, dependencies

**Files:**
- Create: `supabase/project-milestone-rules.sql`, `supabase/tests/project-milestone-rules.test.sql`

**Interfaces:**
- Produces:
  - Columns on `general_projects`:
    - `milestone_completion text not null default 'automatic' check in ('automatic','manual')`
    - `require_milestone_due bool not null default true`
    - `allow_milestone_dependencies bool not null default true`
    - `milestone_overdue_alerts bool not null default true`
  - Columns on `general_milestones`: `reached_auto bool not null default false` and `overdue_notified_at timestamptz`.
  - `due_on`: drop not null. A BEFORE INSERT/UPDATE trigger refuses a null `due_on` when the project's `require_milestone_due` is on, with "Give the milestone a due date." On an UPDATE that leaves an already-null date unchanged, refuse only when other fields change (the "editing requires a date" rule).
  - `general_milestone_dependencies (milestone_id, depends_on_id, project_id, created_by, created_at)`:
    - pk on the pair; composite FKs keep both rows in the same project; check against self-links.
    - RLS: read with `can_read_general_project`; no direct writes. Add it to realtime.
  - RPCs `add_general_milestone_dependency(p_milestone, p_depends_on)` and `remove_general_milestone_dependency(p_milestone, p_depends_on)`. Both are security definer. They check `general_can_manage_milestones`, the switch (for add), the same project, and loops (recursive CTE).
  - Messages:
    - "Milestone dependencies are turned off for this project."
    - "That would make the milestones wait for each other."
  - Reach rules:
    - Setting `reached_at` (by a person) is refused while any dependency isn't reached: "Waiting for {name}. Reach it first."
    - Automatic mode, AFTER UPDATE on `general_tasks` of `status`/`milestone_id`/`archived_at`: when every live task of a milestone is done, the milestone has at least one task and all its dependencies are reached, set `reached_at = now()` and `reached_auto = true`.
    - When a task reopens or a new open task is tagged, clear `reached_at` if `reached_auto`.
    - When a milestone becomes reached, re-check the milestones that wait for it.
    - Manual mode: no automatic changes.
    - Cascades run with a transaction-local flag, so the people-only refusals don't block them.
  - Who may write `reached_at`: unchanged (the existing milestone update policy, now `general_can_manage_milestones`). A person who sets or clears it sets `reached_auto = false`.
- [ ] **Step 1: Write the failing suite.** Checks:
  - `'new projects keep today's milestone rules'`
  - `'a missing due date is refused while required'`
  - `'an undated milestone is allowed when the switch is off'`
  - `'turning the switch back on keeps undated milestones until edited'`
  - `'all tasks done reaches a milestone automatically'`
  - `'a milestone with no tasks is never reached automatically'`
  - `'reopening a task undoes an automatic reach but not a manual one'`
  - `'manual mode never reaches automatically'`
  - `'a milestone can't be marked reached while it waits'`
  - `'automatic reach waits for the blocker'`
  - `'reaching the blocker reaches the waiting milestone'`
  - `'a dependency loop is refused'`
  - `'dependencies off refuses new links but keeps existing ones'`
  - `'a member manages dependencies only when the member switch allows milestones'`
  - `'class milestones are untouched'`
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `work-milestones`, `sprint-milestones`, `class-milestones`, `project-member-rules`, `project-task-rules`, `work-task-handoff` and `general-tasks` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Add milestone completion, due date and dependency rules".

### Task 2: Database — overdue alerts job

**Files:**
- Modify: `supabase/project-milestone-rules.sql`, `supabase/tests/project-milestone-rules.test.sql`

**Interfaces:**
- Produces:
  - Notification type `milestone_overdue`. Add it in its own committed block at the top, like `sprint-settings.sql` does.
  - `send_milestone_overdue_alerts(p_now timestamptz default now(), p_project uuid default null) returns int`:
    - security definer, revoked from clients;
    - only work projects that are not archived and have `milestone_overdue_alerts` on;
    - only milestones with `due_on < local date`, `reached_at is null`, `overdue_notified_at is null`;
    - recipients are the PM and active coordinators;
    - title "{milestone} is overdue in {project}", preview "It was due {Mon D}.";
    - sets `overdue_notified_at`.
  - A BEFORE UPDATE that clears `overdue_notified_at` when `due_on` moves later.
  - Cron `'collabify-milestone-overdue'` at `'0 0 * * *'` UTC (08:00 Manila). Use the unschedule-then-schedule pattern.
- [ ] **Step 1: Add failing checks** (always with `p_project`):
  - `'an overdue milestone alerts the pm and coordinators once'`
  - `'a second run sends nothing new'`
  - `'moving the date later allows a new alert'`
  - `'undated and reached milestones never alert'`
  - `'alerts off sends nothing'`
  - `'archived projects are skipped'`
- [ ] **Step 2: Dry-run.** Swap the new enum value for an existing one in the scratch copy only. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green.**
- [ ] **Step 5: Commit** "Alert planners when a milestone is overdue".

### Task 3: App — settings section, mode-aware status, dependencies

**Files:**
- Modify:
  - `src/lib/general/navigation.ts`: `SettingsSection` gains `'milestones'`.
  - `src/components/general/settings/ProjectSettings.tsx`: add the menu item "Milestones" between Tasks and Members & permissions.
  - Create `src/components/general/settings/MilestonesSection.tsx`.
  - `src/lib/api/general.ts`: `getGeneralProject` returns `milestoneRules: { completion: 'automatic'|'manual'; requireDue: boolean; allowDependencies: boolean; overdueAlerts: boolean }` with a missing-column fallback to the defaults. `ProjectPatch` accepts the columns.
  - `src/lib/api/milestones.ts`:
    - `listMilestoneDependencies(projectId)` with the missing-table fallback;
    - `addMilestoneDependency(milestoneId, dependsOnId)` and `removeMilestoneDependency(...)`;
    - read `reached_auto`;
    - allow a null `due_on`.
  - `src/lib/work/milestones.ts`: `milestoneStatus(m, progress, now, mode?)`. Manual mode: 100% done but no `reached_at` gives a new status `'ready'`. A null `due_on` is never `late` or `at_risk`. `sortMilestones` puts undated milestones last. Add `waitingFor(milestone, deps, milestones)`.
  - `MilestonesView.tsx`, `MilestoneDialog.tsx`, `MilestoneChart.tsx`, `MilestoneBits.tsx` (`StatusPill`), `WorkGlance.tsx` (next milestone), `ProgressTab.tsx`. Pass the mode, show "Ready to mark reached", "Waiting for {name}" and "No due date". The date field is optional when the switch is off. Add a "Waiting for" control in the milestone card for managers.
  - `src/lib/types.ts` and `NotificationBell.tsx`: `milestone_overdue` links to `?tab=plan&work=milestones&milestone={id}` when the notification carries no milestone id the project link is used.
- Test: `milestones.test.ts`, `settings/MilestonesSection.test.tsx`, `MilestonesView` tests.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces the panel:
  - Exact labels:
    - "Completion" (select: "Automatic — when all its tasks are done" / "Manual — when someone marks it")
    - "Require a due date"
    - "Allow milestone dependencies"
    - "Overdue milestone alerts" (help: "The project manager and coordinators are told the morning after a missed due date.")
  - Button "Save milestone settings", toast "Milestone settings saved".
  - Editable when `state.can('edit_project') && !state.readOnly`.
- [ ] **Step 1: Write failing tests:**
  - `milestoneStatus` manual → `'ready'`; automatic unchanged; undated never late.
  - Sort puts undated last.
  - The panel payload.
  - "Waiting for" shows and the add calls `addMilestoneDependency`.
  - The date is optional when the switch is off.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** "Add milestone settings and show completion mode, dependencies and undated milestones".

### Task 4: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: the file goes after `project-member-rules.sql` in both restore commands and the rerun tail, plus an ownership section.
  - `scripts/schema-drift.mjs`: the order.
  - `CLAUDE.md`: one concise bullet.
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Checks.**
  - Build, vitest, eslint, contrast.
  - SQL dry-runs of `project-milestone-rules` plus Task 1's sibling suites.

  Expected: green.
- [ ] **Step 2: Commit** "Document milestone settings".
- [ ] **Step 3: Stop for owner review**, then:
  1. `node scripts/db.mjs supabase/project-milestone-rules.sql supabase/anon-lockdown.sql`
  2. A read-only check.
  3. Re-run the suites.
  4. Push `main`.
