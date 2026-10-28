# Work Project Task Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route work-project tasks from private planning through optional coordinator review to teams, then let each lead assign only their own team's incoming tasks.

**Architecture:** Keep handoff state on each existing task, separate from its progress stage. Postgres guards and RLS own creation, visibility, batch transitions and team-scoped assignment. The existing Tasks tab gains planning/review/incoming views; the existing AI matcher supplies reviewed team suggestions for planners and member suggestions for leads.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres RLS and RPC, `work-ai` Edge Function, Vitest, SQL rollback suites.

**Spec:** `docs/superpowers/specs/2026-10-28-work-project-handoff-design.md`

## Global Constraints

- Only work projects (`class_board_id is null`) change. Class boards keep their current task and AI behavior.
- Regular task creation belongs to PMs and coordinators, even when a Member has a `manage_tasks` grant. QA alone retains bug-task creation; leads and ordinary Members cannot create regular tasks.
- Planning/review tasks are visible only to PMs and coordinators, plus a QA creator's own unsent bug. Unsent work must be absent from member lists, calendar, search, reports, notifications and progress counts.
- A task's team selection does not send it; **Send to team** is an atomic, reviewed action. PMs may bypass coordinator review.
- Released tasks retain existing project-wide read access. Team leads may assign only active members of teams they lead, on released incoming tasks for those teams. QA and Stakeholders never hold tasks.
- AI receives task text, position names and skill tags, never member names or email addresses; it drafts suggestions and writes nothing before review.
- Active released tasks may be rerouted by PM/coordinator with a required reason; clear old holders and notify both teams, preserving stage and history. QA/Done tasks must be reopened first.
- Use the tokens, copy style and desktop/tablet/phone rules in `CLAUDE.md`. SQL files stay idempotent; final `anon-lockdown.sql` follows function changes.
- Execute in an isolated checkout or branch; commit each task locally and push `main` only after the complete SQL/UI flow passes verification. Never deploy a half-enforced workflow.
- Never stage `.env.local`, `supabase/.temp/`, `.superpowers/` or `graphify-out/`. Stage named files only.

## Review Focus

- A stale batch with one edited or duplicated task sends none of its tasks (Task 2).
- Losing team leadership after opening an AI review prevents assignment at save time (Tasks 3 and 6).
- Rerouting an active task clears old holders but preserves comments, files, logs and stage (Task 2).
- A QA-created unsent bug is visible to its creator and planners, but never to another member through a child table or report (Task 1).
- A project archived during a handoff refuses the send and leaves every task unchanged (Task 2).

## File Map

- `supabase/work-task-handoff.sql`: final owner of routing columns, read policies/views, task guards, handoff RPCs, events and assignment rules; runs after `project-requests.sql`/`sprint-archive.sql` and before final `anon-lockdown.sql`.
- `supabase/tests/work-task-handoff.test.sql`: roles, visibility, transitions, concurrent edits, archived and QA cases.
- `scripts/schema-drift.mjs`, `docs/07-backup.md`: final SQL order and re-run ownership.
- `src/lib/general/types.ts`, `src/lib/general/permissions.ts`: route and event types, UI permission helpers.
- `src/lib/api/general.ts`: typed handoff RPC calls and task list fields.
- `src/components/general/TasksTab.tsx` (including its `NewTaskDialog`), `WorkTab.tsx`, `TaskDialog.tsx`, `TasksFromNotes.tsx`, `useGeneralProject.ts`: current task entry and read surfaces.
- `src/components/general/TaskRoutingPanel.tsx`: planner queue, coordinator review and mixed-team batch send.
- `src/components/general/LeadInbox.tsx`: lead's incoming queue, manual assignment and return.
- `src/components/general/AssignByPosition.tsx`, `src/lib/work/assignDraft.ts`, `src/lib/api/workAi.ts`, `supabase/functions/work-ai/index.ts`, `supabase/functions/_shared/assignPick.ts`: two AI scopes and reviewed saves.
- `src/components/general/WorkSummary.tsx`, `WorkOverview.tsx`, `src/lib/general/progress.ts`, `src/hooks/useGeneralDashboard.ts`, `src/hooks/useGeneralReport.ts`, `src/lib/api/search.ts`, `src/lib/api/sprints.ts`, `src/lib/api/milestones.ts`, `src/pages/app/tasks/MyTasks.tsx`: task summaries and cross-project reads.

---

### Task 1: Route state, visibility and safe migration

**Files:** Create `supabase/work-task-handoff.sql`, `supabase/tests/work-task-handoff.test.sql`; modify `scripts/schema-drift.mjs`, `docs/07-backup.md`.

**Interfaces:**
- Add `general_tasks.routing_state` (`planning | coordinator_review | released`), `reviewer_id uuid null`, and `sent_at timestamptz null`. Work tasks existing at migration are `released`; class boards keep their old behavior. Until the final activation, new tasks default to `released` so a partial deploy does not hide work.
- Produce `general_task_readable(p_project uuid, p_state text, p_creator uuid) returns boolean` and `general_task_child_readable(p_task uuid) returns boolean`; the latter reads a task through a security-definer helper without recursive RLS.
- Append routing fields to `general_task_overview`. The final `general_project_overview` and all progress/report/dashboard summaries count only released work tasks, independent of viewer role.

- [ ] **Step 1: Write a failing SQL suite.** Assert existing tasks remain released and readable; new explicit planning tasks are visible to PM/coordinator only; the QA creator sees their own unsent bug; other members, stakeholders and leads cannot read its task, comments, files, logs or events; class-board reads do not change; released counts exclude planning/review tasks for every role.
- [ ] **Step 2: Run `node scripts/db.mjs supabase/tests/work-task-handoff.test.sql`.** Expected: FAIL on missing route fields/helper.
- [ ] **Step 3: Implement schema, policies and view changes.** Before editing, inspect live `pg_get_functiondef`/`pg_get_viewdef` for final copies. Audit `general_task_overview`, `general_project_overview`, `general_space_overview`, `general_report_*`, sprint/milestone summaries, task search, calendar and archive queries, notification triggers, storage reads, and child-table policies. Include every security-definer task reader in this file or in the owning file plus the final SQL order; do not rely on a frontend filter for privacy. Register this file after the current final owners in both order lists.
- [ ] **Step 4: Apply and verify.** Run `work-task-handoff.sql`, `anon-lockdown.sql`, the new SQL suite and `anon-lockdown.test.sql`; expected: PASS. Re-run the SQL file to prove idempotence. Run the existing `project-qa`, `project-stakeholders`, `general-reports`, `member-skills` and dashboard SQL suites to catch ownership regressions.
- [ ] **Step 5: Commit locally.** Stage only the four named files; commit `Add private work task routing state` with trailer. Do not push until Plan Exit.

### Task 2: Atomic coordinator and team handoffs

**Files:** Modify `supabase/work-task-handoff.sql`, `supabase/tests/work-task-handoff.test.sql`.

**Interfaces:**
- Produce `send_work_tasks_to_coordinator(p_project uuid, p_rows jsonb, p_coordinator uuid) returns int`; each row carries `id` and `updated_at`.
- Produce `send_work_tasks_to_teams(p_project uuid, p_rows jsonb, p_reason text default null) returns int`. Each row is `{id: uuid, team_id: uuid, updated_at: timestamptz}`; `updated_at` is the optimistic concurrency token. A reason is required when any selected task was already released.
- Produce `return_work_task(p_task uuid, p_reason text) returns void`: the selected coordinator returns review work, or the receiving lead returns an unassigned incoming task, to private planning.
- These RPCs lock all selected tasks in id order, validate every row before any write, then update atomically. A team needs an active lead. A released task in QA/Done refuses reroute. A reroute clears old holders and retains stage, files, comments and logs.
- Extend `general_task_events.kind` with `sent_to_coordinator | returned | sent_to_team | rerouted`; detail holds actor, old/new team, reviewer, reason and former holder ids. Bell notifications go only to the next coordinator/lead, and old/new teams on reroute.

- [ ] **Step 1: Add failing SQL cases.** Assert PM direct send, PM to coordinator to team, coordinator return, lead return/resend, mixed-team batch, stale timestamp and duplicate id atomic failure, leaderless team refusal, archived project refusal, active reroute preserving work, QA/Done refusal, direct route-column or released-team change refusal and event/notification recipients.
- [ ] **Step 2: Run the SQL suite.** Expected: FAIL on missing RPCs/events.
- [ ] **Step 3: Add the transition RPCs and notifications.** Keep all route and released-team mutations inside RPCs; direct updates of route columns or a released task's `team_id` are refused by the task guard. Use the existing notification and task event patterns; scope team recipients to project members and active leaders.
- [ ] **Step 4: Apply and verify.** Re-run `work-task-handoff.sql`, `anon-lockdown.sql`, new and anon-lockdown suites; expected: PASS. Re-run existing task, QA and notification suites. Reapply the SQL file twice without failure.
- [ ] **Step 5: Commit locally.** Stage the two named files; commit `Add atomic work task handoffs` with trailer.

### Task 3: Creation and assignment rules

**Files:** Modify `supabase/work-task-handoff.sql`, `supabase/tests/work-task-handoff.test.sql`, `src/lib/general/permissions.ts`, `src/lib/general/permissions.test.ts`, `src/lib/general/types.ts`, `src/lib/api/general.ts`, `src/components/general/TasksTab.tsx` (its nested `NewTaskDialog`), `src/components/general/TasksFromNotes.tsx`.

**Interfaces:**
- Add `TaskRoutingState = 'planning' | 'coordinator_review' | 'released'`, `GeneralTask.routing_state`, `reviewer_id`, `sent_at`, and the four handoff kinds in `GeneralTaskEvent`.
- Export `canCreateWorkTask(role: ProjectRole | null, kind: TaskKind): boolean` and `canAssignIncoming(viewerTeamIds: readonly string[], task: GeneralTask): boolean` from `permissions.ts`.
- Work-project `createTask` inserts explicit `routing_state = 'planning'`; class boards retain existing inserts. The database accepts regular inserts only from PM/coordinator and bug inserts from QA, irrespective of Member grants; it refuses holders on private tasks and outside-team lead assignments on released tasks. A lead may add another member of the same team after the first assignment, while the AI only drafts the initial holder.

- [ ] **Step 1: Write failing SQL and Vitest cases.** Assert PM/coordinator regular creation; Member, team lead, Stakeholder and granted Member refusal; QA bug creation but regular refusal; no pre-release assignee; lead may assign one or more active members of the receiving team, but nobody outside it; losing lead status or team membership refuses a stale save; existing class-board behavior remains. Vitest pins the matching button rules.
- [ ] **Step 2: Run `node scripts/db.mjs supabase/tests/work-task-handoff.test.sql` and `npx vitest run src/lib/general/permissions.test.ts`.** Expected: new cases FAIL.
- [ ] **Step 3: Update final guards/policies and client gates.** Start from live `guard_general_task`, `guard_general_task_child`, `general_tasks_insert`, and `general_task_assignees_insert` copies after `project-qa.sql`. Hide Add task and From notes from non-planners on work projects, including empty states and alternate entry points. Keep QA's bug entry. `TasksFromNotes` saves planning tasks without assigning a person or sending a notification.
- [ ] **Step 4: Apply and verify.** Run the new SQL file, `anon-lockdown.sql`, new, QA, team-lead and anon-lockdown SQL suites; run targeted Vitest, ESLint and `npm run build`; expected: PASS. Run `python -m graphify update .` after code edits.
- [ ] **Step 5: Commit locally.** Stage named files only; commit `Restrict work task creation and assignment` with trailer.

### Task 4: Planner and coordinator queues

**Files:** Create `src/components/general/TaskRoutingPanel.tsx`, `src/components/general/TaskRoutingPanel.test.tsx`; modify `src/components/general/WorkTab.tsx`, `TasksTab.tsx`, `TaskDialog.tsx`, `useGeneralProject.ts`, `src/lib/api/general.ts`.

**Interfaces:**
- API exports `sendTasksToCoordinator(projectId: string, rows: { id: string; updated_at: string }[], coordinatorId: string): Promise<number>`, `sendTasksToTeams(projectId: string, rows: { id: string; team_id: string; updated_at: string }[], reason?: string): Promise<number>`, `returnWorkTask(taskId: string, reason: string): Promise<void>`.
- `TaskRoutingPanel({ state }: { state: GeneralProjectState })` shows Planning and Coordinator review for PM/coordinator, including per-row team selection and a single Send to team action. Coordinator selection is per batch; tasks retain one reviewer id.

- [ ] **Step 1: Write a failing component test.** PM selects mixed-team rows; selecting a team alone leaves tasks in Planning; Send to team calls one batch RPC with each team and timestamp; coordinator sees assigned review work; return requires a reason; stale send shows a reload message and changes no local task state.
- [ ] **Step 2: Run `npx vitest run src/components/general/TaskRoutingPanel.test.tsx`.** Expected: FAIL on missing panel/API.
- [ ] **Step 3: Implement planner UI.** Put Planning/Review inside existing Tasks tab, preserve normal released board and existing task dialog. Show task routing state, reviewer and return reason in task detail. Reload after mutations; display server refusals. Use a confirmation when rerouting active work and require a reason; show former holders before clearing.
- [ ] **Step 4: Verify.** Run targeted Vitest, ESLint and `npm run build`; browser-check PM direct send, optional coordinator review, mixed-team batch, return and active reroute. Expected: buttons and queues follow SQL state.
- [ ] **Step 5: Commit locally.** Stage named files only; commit `Add planner task handoff views` with trailer.

### Task 5: Lead inbox and manual assignment

**Files:** Create `src/components/general/LeadInbox.tsx`, `src/components/general/LeadInbox.test.tsx`; modify `src/components/general/WorkTab.tsx`, `TaskDialog.tsx`, `src/lib/general/permissions.ts`, `src/lib/general/permissions.test.ts`.

**Interfaces:**
- `LeadInbox({ state }: { state: GeneralProjectState })` lists only `routing_state === 'released'`, no holders, and `team_id` led by the viewer. It reuses `assignTask` for manual assignment and `returnWorkTask` for a required-reason return. The server rechecks team leadership and recipient membership at save time.

- [ ] **Step 1: Write a failing test.** A lead of Team A sees only Team A's released unassigned tasks; a task merely tagged Team A in Planning is absent; Team B's task is absent; manual assignment offers only active Team A members; a returned task leaves Incoming and shows a return receipt.
- [ ] **Step 2: Run targeted Vitest.** Expected: FAIL on missing inbox.
- [ ] **Step 3: Implement the inbox.** Show it within Tasks for viewers leading at least one team; keep normal board for released tasks. Reuse existing task dialog, names and team data. Do not offer regular task creation to leads.
- [ ] **Step 4: Verify.** Run targeted Vitest, the handoff SQL suite, ESLint and build; browser-check two leads with different teams. Expected: no cross-team assignment or incoming card.
- [ ] **Step 5: Commit locally.** Stage named files only; commit `Add team lead incoming tasks` with trailer.

### Task 6: Team and member suggestions by position

**Files:** Modify `supabase/work-task-handoff.sql`, `supabase/tests/work-task-handoff.test.sql`, `supabase/functions/work-ai/index.ts`, `supabase/functions/_shared/assignPick.ts`, `src/lib/api/workAi.ts`, `src/lib/work/assignDraft.ts`, `src/lib/work/assignDraft.test.ts`, `src/components/general/AssignByPosition.tsx`, `src/components/general/TasksFromNotes.tsx`, `src/components/general/TaskRoutingPanel.tsx`, `src/components/general/LeadInbox.tsx`.

**Interfaces:**
- Produce `general_route_context(p_project uuid) returns jsonb`: only planning/review tasks and project teams/positions/skills; PM/coordinator only.
- Produce `general_lead_assign_context(p_project uuid) returns jsonb`: only released, unassigned incoming tasks and active candidates in teams led by the caller; a lead may belong to several teams.
- Extend `work-ai` action `assign` with `mode: 'route' | 'lead'`. Export `draftTeamRoutes(projectId: string)` and `draftLeadAssignees(projectId: string)` from `workAi.ts`; results are suggestions only. Disable the old unrestricted `tasks`/`drafts` modes for work projects once these callers are migrated.
- For routing, the AI identifies an existing position/tag. The deterministic picker chooses the matched position's team when set; otherwise the team with the most active matching members, then lowest open released-task load, then name. No match leaves the team blank. Lead mode reuses the current person picker after server-side candidate restriction.

- [ ] **Step 1: Write failing SQL and pure tests.** SQL: PM/coordinator context contains private planning tasks; lead context contains only their team's incoming tasks/candidates; Member, QA and Stakeholder refuse; no inactive/QA/Stakeholder candidate. Vitest: position team wins, tie rules are stable, no match stays blank, load balances within a lead's team, and stale leadership at save is refused by SQL.
- [ ] **Step 2: Run the new SQL suite and `npx vitest run src/lib/work/assignDraft.test.ts`.** Expected: new cases FAIL.
- [ ] **Step 3: Implement contexts, picker and UI.** Planners' Assign by position reviews team suggestions; leads' button reviews member suggestions only in Incoming. From notes creates planning tasks and may suggest teams; a person named in notes is shown as context but is not assigned before the lead confirms. Never write on AI response alone. Reuse existing review rows where practical.
- [ ] **Step 4: Verify.** Re-run `work-task-handoff.sql`, `anon-lockdown.sql`, new, member-skills and anon-lockdown SQL suites; run targeted Vitest, ESLint and build; deploy `work-ai` only with the matching client/server change. Browser-check planner and lead AI reviews with two teams.
- [ ] **Step 5: Commit locally.** Stage named files only; commit `Scope position assignment to handoff roles` with trailer.

### Task 7: Activate routing and verify the whole flow

**Files:** Modify `supabase/work-task-handoff.sql`, `supabase/tests/work-task-handoff.test.sql`, `docs/07-backup.md`, `CLAUDE.md`, `handoff.md` and any read surface identified in Task 1; no unrelated cleanup.

**Interfaces:**
- New work tasks now default to `planning` at the database level. Existing tasks stay `released`. New class-board tasks keep their current behavior. All task read surfaces honor the release boundary, and the task event UI names new handoff events.

- [ ] **Step 1: Add final failing SQL/UI regression cases.** Assert a direct API insert without a routing value creates a private work task for a planner, not an immediately released one; an ordinary member's direct insert refuses; existing tasks remain visible; no planner-only title/count leaks through Home, Space overview, My tasks, search, reports, calendars, task child tables or notifications; client progress in `WorkSummary`, `TasksTab` and `WorkOverview` counts released tasks only; event history names each transition.
- [ ] **Step 2: Run the new and existing targeted suites.** Expected: FAIL on at least the new default or leak assertions.
- [ ] **Step 3: Switch the default and close every read path.** A before-insert guard sets work tasks to `planning` while class-board tasks remain `released`. Include any final SQL redefinitions in `work-task-handoff.sql` after the current company-role chain, then reapply `anon-lockdown.sql`. Remove or server-disable old AI assignment modes that bypass routing. Document the re-run order in `docs/07-backup.md` and final task rules in `CLAUDE.md`/`handoff.md`.
- [ ] **Step 4: Verify fully.** Run `npx vitest run`, `npm run build`, ESLint on changed TS/TSX, `Get-ChildItem supabase/tests -Filter *.test.sql | ForEach-Object { node scripts/db.mjs $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }`, and `python -m graphify update .`; expected: no failure. Browser-check desktop, tablet and phone. Have the owner sign into PM, coordinator, lead, member, QA and stakeholder accounts for the role walk; the agent does not sign in on their behalf.
- [ ] **Step 5: Commit and integrate.** Stage named files only; commit `Activate work project task handoffs` with trailer. Review all plan commits together, integrate to `main`, push once fully verified, and confirm the deployed flow.

## Plan Exit

- [ ] Every requirement in the spec maps to a passing SQL/Vitest case or a browser walk step; class-board regression suites pass.
- [ ] Existing tasks remain visible, while new planning tasks stay private across every read path.
- [ ] The PM→coordinator→team→lead→member→QA route and PM→team shortcut both work, including return and active reroute.
- [ ] `handoff.md` records completion, migration and exact SQL re-run order.
