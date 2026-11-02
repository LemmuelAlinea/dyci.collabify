# Sprint Organization (Streams and Flexible parallel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a work project run sprints in three modes: Sequential (one at a time, as today), Multiple sprint streams (one at a time per team), or Flexible parallel (any number at once).

**Architecture:**
- **Database.** A new file, `supabase/sprint-organization.sql`, runs after `project-workflow-rules.sql` and before `anon-lockdown.sql`. It adds:
  - the mode and a team on each sprint
  - a per-mode start check that replaces the project-wide unique index
  - task and team rules
  - redefined finish, reopen and automation functions, each started from its live body
- **App.** Settings → Sprints gets live mode choices, sprints get a Team picker, and the screens show several running sprints through a switcher.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens, Supabase Postgres (plpgsql, RLS, pg_cron), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-03-sprint-organization-design.md` (calls 1–20 by number).

## Global Constraints

- Work projects only. `board_sprints` and class boards are untouched.
- `organization` defaults to 'sequential', so today's behaviour is unchanged until someone switches.
- Who changes the mode: the people who change sprint settings today (the project manager and coordinators).
- Streams-only rules apply only while `organization = 'streams'`:
  - the task's team must match the sprint's team
  - a task with no team can't join a sprint
  - the team lead runs their team's sprints
  - per-team automation
- Copy: sentence case, no exclamation marks, no "please", no "successfully".
- Tokens only. Idempotent SQL. Redefinitions start from the live `pg_get_functiondef`. Existing guards are not weakened. Dry-run only until the owner approves.
- Messages (verbatim):
  - "Choose the team this sprint is for."
  - "Finish {sprint} first."
  - "{team} is already running {sprint}."
  - "Give this sprint a team first."
  - "Give {sprint} a team first."
  - "Finish all but one running sprint first."
  - "{sprint} holds tasks of other teams. Move them out first."
  - "Give the task a team before planning it into a sprint."
  - "{n} tasks in this sprint belong to another team. Move them out first." (1 → "1 task in this sprint belongs to another team. Move it out first.")
  - "Move its tasks out first."

## Review Focus

1. **Two people start two Frontend sprints at the same moment.** One starts and the other is refused. *(Task 1: "two starts for one team can't both run")*
2. **A Frontend task is rerouted to Backend while it sits in a running Frontend sprint.** The task goes back to the backlog, and its history names it. A Done task stays. *(Task 1: "an open task that changes team leaves the sprint; a done one stays")*
3. **The automation runs in streams mode for a team that never used sprints.** No sprint is created for that team. *(Task 2: "a team without sprint history gets no sprint of its own")*
4. **An automatic start is blocked every 15 minutes.** Planners are told once, not every run. *(Task 2: "a blocked automatic start notifies once and records why")*
5. **The project switches back to Sequential while two sprints run.** The switch is refused and the mode stays. *(Task 1: "switching back to sequential is refused while two run")*

---

### Task 1: Database — mode, sprint team, start rules, task and team rules

**Files:**
- Create: `supabase/sprint-organization.sql`, `supabase/tests/sprint-organization.test.sql`

**Interfaces:**
- Produces:
  - `general_sprint_settings.organization text not null default 'sequential' check in ('sequential','streams','parallel')`.
  - `general_sprints.team_id uuid`: a composite FK `(team_id, project_id)` to `general_teams (id, project_id)` with `on delete set null (team_id)`. Check that the live Postgres version supports a column list in SET NULL; otherwise use a BEFORE DELETE trigger on `general_teams`.
  - `general_sprints.auto_start_blocked_reason text` and `auto_start_blocked_at timestamptz`, written only by the automation (signed-in writes are dropped, the `guard_general_milestone_overdue` pattern).
  - `general_sprints.next_auto_created boolean not null default false`: the per-sprint "next already created" memory.
    - Migration: set it true on the sprint that `general_sprint_settings.auto_created_after` points at.
  - `general_sprint_organization(p_project uuid) returns text`: stable, security definer.
  - Drop `general_sprints_one_running`.
  - **Running-count check.** A BEFORE UPDATE OF `state` trigger on `general_sprints`, for `planned` → `active`. It takes `pg_advisory_xact_lock` on the project and enforces call 3 with the messages above.
    - Streams also refuses to start while the sprint holds open tasks of another team or with no team (call 5 message).
    - Name it to run after the existing guards.
  - **Mode-switch check.** A BEFORE UPDATE OF `organization` trigger on `general_sprint_settings`, implementing calls 4 and 15.
  - **Who runs a sprint.** Redefine `general_can_run_sprint` from live with an added overload `general_can_run_sprint(p_project uuid, p_sprint uuid) returns boolean`. In streams mode it also accepts the active lead of the sprint's team. `guard_sprint_run`, `complete_general_sprint` and `reopen_general_sprint` (Task 2) call the two-argument form.
  - **Sprint team edits** (call 17):
    - A planned sprint's team changes only while it holds no tasks ("Move its tasks out first.").
    - A running or finished sprint's team is fixed ("A running or finished sprint keeps its team.").
    - In streams mode, inserting a sprint without a team is refused ("Choose the team this sprint is for.").
  - **Team archive** (read `project-team-archive.sql` live):
    - Refused while the team has an active sprint ("Finish {sprint} first.").
    - On archive, its planned sprints get `team_id = null`.
  - **Task rules in streams** (call 5):
    - A BEFORE INSERT/UPDATE OF `sprint_id`, `team_id` trigger on `general_tasks`.
      - Joining a sprint needs `task.team_id = sprint.team_id`. A team-less task is refused with "Give the task a team before planning it into a sprint." Mismatched teams are refused with "This sprint is for {team}. Move the task to that team's sprint."
      - When `team_id` changes on an open task in a team sprint, it sets `sprint_id = null` (not a refusal).
      - Done and archived tasks keep their sprint.
    - It runs only for work projects in streams mode. Subtasks follow their parent as today; check the order with `general_tasks_c_follow_parent`.
    - History: the move out of the sprint is recorded by the existing history trigger. Confirm it records `sprint_id`; if not, write a `general_task_events` 'updated' row with detail fields `['sprint_id']`.
- [ ] **Step 1: Write the failing suite** with the harness of `project-workflow-rules.test.sql`. Checks:
  - `'new projects stay sequential'`
  - `'only the project manager and coordinators change the mode'`
  - `'sequential still allows one running sprint'`
  - `'streams allow one running sprint per team'`
  - `'two starts for one team can't both run'` (serialised by the lock: start one, then start a second → refused)
  - `'a sprint without a team can't start in streams'`
  - `'parallel allows any number running'`
  - `'switching to streams is refused while a running sprint has no team or holds other teams' tasks'`
  - `'switching back to sequential is refused while two run'`
  - `'a team lead runs their team's sprint in streams, not another team's'`
  - `'a team lead runs nothing in sequential or parallel'`
  - `'a task joins only its team's sprint in streams; a team-less task joins none'`
  - `'starting is refused while a sprint holds another team's open tasks'`
  - `'an open task that changes team leaves the sprint; a done one stays'`
  - `'a planned sprint's team changes only while empty; a running one's never'`
  - `'archiving a team is refused while it runs a sprint and clears its planned sprints'`
  - `'deleting a team clears it from its sprints'`
  - `'outside streams the team is only a label'`
  - `'class boards keep one running sprint per board'`
  - `'the old created-after memory moves to the sprint'`
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `sprint-settings`, `sprint-reopen`, `sprint-milestones`, `work-planning`, `project-team-leads`, `project-notification-rules`, `project-workflow-rules`, `work-task-handoff`, `general-tasks` and `class-milestones` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Add sprint organization modes and team sprints".

### Task 2: Database — finish, reopen, automation per mode

**Files:**
- Modify: `supabase/sprint-organization.sql`, `supabase/tests/sprint-organization.test.sql`

**Interfaces:**
- Consumes: Task 1.
- Produces, each redefined from its live body:
  - **`complete_general_sprint`** (live owner `project-notification-rules.sql`). It uses the two-argument `general_can_run_sprint`.
    - In streams, `p_carry_to` must be a planned sprint of the same team ("Carry the work to one of {team}'s planned sprints.").
    - Keep its `notify_general_sprint_completed` call. The notice title names the team in streams ("{team}: {sprint} is finished"), done in the helper or by redefining it from live.
  - **`reopen_general_sprint`** (live owner `sprint-reopen.sql`), call 8:
    - Sequential: as today.
    - Streams: demotes only the same team's active sprint.
    - Parallel: demotes nothing.
    - Rights: the two-argument form.
  - **`run_sprint_automation`** (live owner `project-notification-rules.sql`):
    - Sequential: unchanged.
    - Streams: the same three steps per team that has sprint history (call 14).
      - Next sprint name "{team} sprint {n}", where n is the team's sprint count + 1.
      - Start date is the day after that team's latest end, snapped to `start_weekday`. Add `general_next_sprint_start(p_project, p_team)` or extend the live one.
      - It uses and sets `next_auto_created` on the finished sprint.
    - Parallel: auto-finish every active sprint whose `ends_on` has passed, and auto-start every planned sprint whose `starts_on <= today` (within each project's `run_at` rule). Never create.
    - A blocked automatic start (any mode) skips the sprint and sets `auto_start_blocked_reason` and `auto_start_blocked_at`. The first time it notifies the planners plus the team lead (streams) with `sprint_automation`: title "{sprint} couldn't start on its own", preview = the reason. It doesn't notify again while `auto_start_blocked_at` is set. A later successful start, or a person's start, clears both columns.
  - **The sprint ending reminder** (`send_project_reminders`, live owner `project-notification-rules.sql`): in streams it also notifies the sprint team's active lead. Redefine from live and change only the recipients.
  - Record every redefined function and its previous owner in the file header for Task 4.
- [ ] **Step 1: Add failing checks:**
  - `'finishing a team sprint carries work only to that team's planned sprint'`
  - `'reopening in streams sends back only the same team's running sprint'`
  - `'reopening in parallel sends nothing back'`
  - `'streams automation finishes, creates and starts per team'`
  - `'a team without sprint history gets no sprint of its own'`
  - `'parallel automation finishes and starts by date and never creates'`
  - `'a blocked automatic start notifies once and records why'`
  - `'starting it by hand clears the reason'`
  - `'the team lead gets their team's ending reminder in streams'`
  - `'sequential automation is unchanged'` (reuse two existing sprint-settings scenarios)
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus Task 1's siblings. Expected: 0 failures.
- [ ] **Step 5: Commit** "Run sprints per team or in parallel".

### Task 3: App — settings, sprint team, running-sprint switcher

**Files:**
- Modify:
  - `src/lib/work/types.ts`: `Sprint` gains `team_id: string | null`, `auto_start_blocked_reason: string | null`.
  - `src/lib/api/sprints.ts`: add the columns, with a missing-column fallback ("remove once live").
  - `src/lib/work/sprintSettings.ts` and `saveSprintSettings`: add `organization: 'sequential' | 'streams' | 'parallel'`.
  - `src/lib/work/sprints.ts`:
    - add `runningSprints(sprints): Sprint[]` (sorted by `ends_on`)
    - keep `runningSprint()` for sequential callers
    - add `canStartSprint(sprint, sprints, organization): string | null` (the message or null, mirroring Task 1)
    - add `nextSprintDraft` team-aware naming ("{team} sprint {n}")
  - `src/components/general/settings/SprintsSection.tsx`: the three choices go live, with the help lines from call 1. Changing the mode opens a ConfirmDialog that says what changes. Database refusals show as the alert.
  - `src/components/work/AddSprintDialog.tsx` and the edit dialog: a "Team" select. It is required in streams ("Choose the team this sprint is for."), otherwise optional ("No team"), and disabled with the reason for running or finished sprints.
  - Create `src/components/work/RunningSprintTabs.tsx`. It renders nothing in sequential or with ≤ 1 running sprint.
    - Streams: tabs per team that has a running sprint.
    - Parallel: tabs per running sprint.
    - Order: the viewer's own team first (streams), else ending soonest.
    - The last pick is remembered in localStorage per project, with every read and write in try/catch.
  - `SprintsView.tsx` and `WorkGlance.tsx`: use the tabs and show the picked sprint. In streams each card's heading names the team.
  - `BacklogView.tsx`:
    - "Start sprint" is disabled only by `canStartSprint`, with that message as its title.
    - "Move to" labels read "Sprint 3 · Frontend · running".
    - In streams, a task only sees its team's sprints. A team-less task sees none, with the hint "Give the task a team before planning it into a sprint."
  - `src/lib/work/scope.ts`: one `running:{id}` scope per running sprint. Keep `'running'` as an alias for the first, so old links work.
  - `MilestoneChart.tsx`, `MilestonesView.tsx`, `ProgressTab.tsx`: `runningId` becomes `runningIds: string[]`.
  - The Sprints tab and Backlog show `auto_start_blocked_reason` as "Couldn't start on its own: {reason}" in warning tokens.
- Test: `sprints.test.ts`, `scope.test.ts`, `SprintsSection.test.tsx`, `RunningSprintTabs.test.tsx`, `BacklogView` / `SprintsView` / `MilestoneChart` tests.
- [ ] **Step 1: Write failing tests:**
  - `runningSprints` sorting.
  - `canStartSprint` per mode, with each message.
  - Team-aware draft naming.
  - The mode save payload and the confirm.
  - The Team select is required only in streams.
  - The tabs: hidden in sequential, team tabs in streams, sprint tabs in parallel, the remembered pick, and a storage failure that still renders.
  - The Backlog move-to filter in streams.
  - Old `'running'` scope links still resolve.
  - Several milestones are highlighted.
  - The blocked reason line.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`, and `npx eslint` on the changed files. Expected: PASS.
- [ ] **Step 5: Commit** "Add sprint streams and parallel sprints to the app".

### Task 4: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: add the file after `project-workflow-rules.sql` in both restore commands and the rerun tail, plus an ownership section and the re-run rule. Fix every older re-run passage that ends before it.
  - `scripts/schema-drift.mjs`: the order.
  - `CLAUDE.md`: one bullet, and update the sprint bullet's "one running sprint".
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Checks.**
  - Build, vitest, eslint and contrast.
  - SQL dry-runs of `sprint-organization` plus every sibling named in Tasks 1–2.

  Expected: green.
- [ ] **Step 2: Commit** "Document sprint organization".
- [ ] **Step 3: Stop for owner review**, then:
  1. `node scripts/db.mjs supabase/sprint-organization.sql supabase/anon-lockdown.sql`
  2. A read-only check.
  3. Re-run the suites.
  4. Push `main`.
