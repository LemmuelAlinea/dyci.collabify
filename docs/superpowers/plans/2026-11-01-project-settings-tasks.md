# Project Settings Group 2 (Task Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task priority, a default status, one-level subtasks, task dependencies, and the per-project task rules (allow subtasks, allow dependencies, allow multiple assignees, require an assignee, require all subtasks to be Done).

**Architecture:**
- **SQL:** a new file `supabase/project-task-rules.sql` runs after `supabase/project-settings-general.sql` and before `anon-lockdown.sql`. It adds the columns, a dependency table, two RPCs, and **new** triggers that enforce the rules. It does not touch the existing task guards, which are owned by `work-task-handoff.sql`, `project-qa.sql` and `task-stages.sql`.
- **App:** the rules live on `general_projects`. Tasks gain `priority` and `parent_id`. The UI adds a Task rules panel, the task window sections, and badges and sorting on the board and in My tasks.

**Tech Stack:** React + TypeScript (Vite), Tailwind v4 tokens, Supabase Postgres (plpgsql, RLS), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-01-project-settings-tasks-design.md`

## Global Constraints

- Work projects only (`class_board_id is null`). Class boards and `project_tasks` are untouched.
- Priority values are exactly `low`, `normal`, `high`, `urgent`, with labels Low, Normal, High, Urgent. The default is `normal`.
- Project rule defaults keep today's behaviour:
  - `default_priority` `normal`
  - `default_stage` `0` (the first stage)
  - `allow_subtasks` true
  - `allow_dependencies` true
  - `allow_multiple_assignees` true
  - `require_assignee` false
  - `require_subtasks_done` true
- Subtasks are one level deep. A subtask's parent is in the same project and is not itself a subtask.
- The release boundary holds everywhere: a subtask under a private planning parent stays private, and counts, search, calendars and notifications behave as for any task.
- New member-write paths use `general_can_write`. New SQL is idempotent. Redefinitions start from the live `pg_get_functiondef`.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Colors only from tokens. Lay out desktop first, then tablet, then phone.
- SQL is dry-run only (in rolled-back transactions on a scratch copy) until the owner approves. No push.

## Review Focus

1. **A subtask cycle or a two-level chain.** Making a task with subtasks into a subtask, or putting a subtask under a subtask, is refused. *(Task 1: "a subtask cannot have subtasks", "a task with subtasks cannot become a subtask")*
2. **A dependency loop.** If A waits for B and B waits for A, the second link is refused, including through a longer chain (A→B→C→A). *(Task 2: "a dependency loop is refused")*
3. **Marking Done by any path.** A status-only update, a stage move to the last stage, and the QA pass RPC are all blocked when a blocker or a subtask isn't Done. *(Task 2: "qa pass of a waiting task is refused"; Task 1: "moving to the last stage counts as done")*
4. **Turning a switch off with data present.** Existing subtasks and dependencies stay readable and keep enforcing. Only new ones are refused. *(Tasks 1–2: "switching subtasks off keeps existing ones")*
5. **A holder adding a subtask to a released task.** The subtask is released immediately, not stuck in private planning. Under a planning parent, it stays planning. *(Task 2: "a subtask follows its parent's release state")*

---

### Task 1: Database — rule columns, priority, parents, rule triggers

**Files:**
- Create: `supabase/project-task-rules.sql`
- Create: `supabase/tests/project-task-rules.test.sql`

**Interfaces:**
- Produces:
  - `general_projects` columns:
    - `default_priority text not null default 'normal'`
    - `default_stage int not null default 0`
    - `allow_subtasks bool not null default true`
    - `allow_dependencies bool not null default true`
    - `allow_multiple_assignees bool not null default true`
    - `require_assignee bool not null default false`
    - `require_subtasks_done bool not null default true`
  - Value checks:
    - priority values must be in the list in Global Constraints;
    - `default_stage >= 0`;
    - if `default_stage` is past the last stage, it falls back to 0 when used.
  - `general_tasks` columns:
    - `priority text not null` (same check; no column default — the insert trigger fills it)
    - `parent_id uuid references general_tasks(id) on delete cascade`
    - an index on `parent_id`
  - BEFORE INSERT trigger `general_tasks_0_defaults` on work projects. It sorts before `general_tasks_a_stage`, which syncs status from stage.
    - It sets `priority` from the project's `default_priority` when the insert didn't name one. `general_tasks.priority` has **no column default**: the trigger fills a null with the project's `default_priority` (or `'normal'` on class boards and rows with no project rule), and the not-null check runs after the trigger. Existing rows are backfilled to `'normal'`.
    - When the task is created already released, or becomes released (`routing_state` changes to `released`) while still at stage 0 and To do, it sets `stage` to the project's `default_stage`.
  - BEFORE INSERT OR UPDATE trigger `general_tasks_rules`. It enforces:
    - the parent rules: same project, one level, and no parent that is already a subtask;
    - refusing a task with subtasks from becoming a subtask;
    - refusing a new `parent_id` when `allow_subtasks` is off (existing rows keep theirs);
    - `require_assignee`: no move to stage > 0 or status `in_progress`/`done` without an assignee;
    - `require_subtasks_done`: no move to `done` (status, or the last stage) while any subtask isn't done.
  - BEFORE INSERT trigger on `general_task_assignees`, `general_task_assignees_single`: when the project's `allow_multiple_assignees` is false and the task already has an assignee, refuse.
  - Error messages:
    - "A subtask can't have its own subtasks."
    - "This task has subtasks, so it can't become one."
    - "Subtasks are turned off for this project."
    - "Give this task a holder before moving it on."
    - "Finish its subtasks first."
    - "This project allows one holder per task."

- [ ] **Step 1: Write the failing suite** with the phase 1 harness. Checks:
  - `'new projects keep today's task rules'`
  - `'a new task takes the project's default priority'`
  - `'a released task starts in the default stage'`
  - `'a subtask must be in the same project'`
  - `'a subtask cannot have subtasks'`
  - `'a task with subtasks cannot become a subtask'`
  - `'switching subtasks off refuses new ones but keeps existing ones'`
  - `'require assignee blocks leaving the first stage without a holder'`
  - `'a parent cannot be done while a subtask is open'`
  - `'moving to the last stage counts as done'`
  - `'the subtask rule can be turned off'`
  - `'one-holder mode refuses a second holder and keeps existing pairs'`
  - `'class boards are unaffected'`
- [ ] **Step 2: Dry-run.** Expected: FAIL (`column "default_priority" does not exist`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green.** Then dry-run `work-task-handoff`, `project-qa` (if present), `task-stages` (if present), `project-roles`, `project-settings-general` and `sprint-settings` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit**: "Add task priority, subtasks and task rules to the database".

### Task 2: Database — dependencies and subtask creation

**Files:**
- Modify: `supabase/project-task-rules.sql`, `supabase/tests/project-task-rules.test.sql`

**Interfaces:**
- Consumes: Task 1's columns and triggers.
- Produces:
  - Table `general_task_dependencies`:
    - `task_id uuid` and `depends_on_id uuid`, both referencing `general_tasks` with on delete cascade;
    - `created_by uuid`, `created_at`;
    - pk `(task_id, depends_on_id)`;
    - check `task_id <> depends_on_id`.
  - RLS: read when the reader can read both tasks (reuse the task read rules, including the release boundary). There are no direct writes. Add the table to realtime.
  - `add_general_task_dependency(p_task uuid, p_depends_on uuid) returns void`. Security definer. It requires:
    - a work project, with both tasks in the same project;
    - `allow_dependencies` on;
    - a caller who may edit the task: planner, the lead of the task's team, or a holder of the task;
    - no loop, checked with a recursive CTE.
  - `remove_general_task_dependency(p_task uuid, p_depends_on uuid) returns void`, with the same edit rule.
  - `create_general_subtask(p_parent uuid, p_title text, p_description text default '', p_due_at timestamptz default null) returns uuid`. Security definer. It requires:
    - `allow_subtasks` on;
    - a caller who is PM, coordinator, the lead of the parent's team, or a holder of the parent;
    - a parent that isn't a subtask, isn't archived and isn't trashed.

    It inserts a task with the parent's `project_id`, `team_id`, `sprint_id`, `milestone_id` and `routing_state` (released when the parent is released), the project's default priority, and `created_by` = caller. It returns the id.
  - The `general_tasks_rules` trigger also refuses moving a task to done while any task it depends on isn't done. Message: "Waiting for {title}. Finish it first." It covers status-only updates, stage moves and `qa_pass_general_task`.
- [ ] **Step 1: Add failing checks:**
  - `'a dependency links two tasks in one project'`
  - `'a dependency across projects is refused'`
  - `'a dependency loop is refused'` (direct and through three tasks)
  - `'a waiting task can start but cannot be done'`
  - `'qa pass of a waiting task is refused'`
  - `'removing the dependency lets it finish'`
  - `'dependencies off refuses new links but keeps existing ones'`
  - `'a member who cannot edit the task cannot link it'`
  - `'a holder can add a subtask to a released task and it is released'`
  - `'a subtask follows its parent's release state'` (planning parent → planning subtask)
  - `'a subtask takes the parent's team, sprint and milestone'`
  - `'a stakeholder or workspace viewer cannot add a subtask'`
  - `'a viewer cannot see dependencies of private planning tasks'`
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus the sibling suites from Task 1.
- [ ] **Step 5: Commit**: "Add task dependencies and subtask creation".

### Task 3: App data layer

**Files:**
- Modify: `src/lib/general/types.ts`, `src/lib/api/general.ts`, `src/components/general/useGeneralProject.ts`
- Create: `src/lib/general/taskRules.ts`, `src/lib/general/taskRules.test.ts`

**Interfaces:**
- Produces:
  - `type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'` and `PRIORITIES: readonly { value: TaskPriority; label: string }[]`, ordered Urgent, High, Normal, Low for sorting.
  - `GeneralTask` gains `priority: TaskPriority` and `parent_id: string | null`. Add them to the task list select and the `general_task_overview` read path the app already uses. If that view lacks the columns, read them beside it the way `listProjectStages` does, rather than redefining the view.
  - `TaskRules = { defaultPriority; defaultStage: number; allowSubtasks; allowDependencies; allowMultipleAssignees; requireAssignee; requireSubtasksDone }` and `DEFAULT_TASK_RULES`. `getGeneralProject` returns `taskRules`, with the fallback to the defaults only for missing columns. `ProjectPatch` accepts the snake_case columns.
  - API functions:
    - `createSubtask(parentId, title, description?, dueAt?) → Promise<string>`
    - `addDependency(taskId, dependsOnId)`
    - `removeDependency(taskId, dependsOnId)`
    - `listDependencies(projectId) → Promise<{ task_id: string; depends_on_id: string }[]>`
  - `GeneralProjectState.dependencies`, loaded with the missing-table fallback, plus `'general_task_dependencies'` added to `useLive`.
  - Pure helpers in `taskRules.ts`:
    - `subtasksOf(tasks, id)`
    - `subtaskProgress(tasks, id) → { done; total }`
    - `blockersOf(deps, tasks, id) → GeneralTask[]`, the open ones only
    - `comparePriority(a, b)`
- [ ] **Step 1: Write failing tests:**
  - `subtaskProgress` counts done children;
  - `blockersOf` returns only blockers that aren't done;
  - `comparePriority` sorts urgent first.
- [ ] **Step 2: Run** `npx vitest run src/lib/general/taskRules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Load task priority, subtasks, dependencies and task rules".

### Task 4: Settings → Tasks "Task rules" panel

**Files:**
- Modify: `src/components/general/settings/TasksSection.tsx`
- Test: `settings/TasksSection.test.tsx`

**Interfaces:**
- Consumes: `TaskRules`, `PRIORITIES`, `updateGeneralProject`, the project stages (`stagesOf(p.stages)`).
- Produces: a panel titled "Task rules", below Stages. Editable with `state.can('edit_project') && !state.readOnly`; read-only otherwise. Controls, with exact labels:
  - "Default priority" (select)
  - "New tasks start in" (select over the project's stages)
  - "Allow subtasks"
  - "Allow dependencies"
  - "Allow multiple holders"
  - "Require a holder before work starts"
  - "Require all subtasks to be done first"

  Help text for "Allow multiple holders": "Turning this off keeps current holders; tasks just can't get another." One Save button, "Save task rules", with the toast "Task rules saved".
- [ ] **Step 1: Write failing tests:**
  - the save payload has the snake_case columns;
  - a member sees every control disabled;
  - the stage select lists the project's stages.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Add task rules to project settings".

### Task 5: Task window — priority, subtasks, waiting for

**Files:**
- Modify: `src/components/general/TaskDialog.tsx`, plus a new `src/components/general/TaskSubtasks.tsx` and `src/components/general/TaskDependencies.tsx`
- Test: `TaskDialog.test.tsx`, `TaskSubtasks.test.tsx`, `TaskDependencies.test.tsx`

**Interfaces:**
- Consumes: Task 3 API and helpers; `canEditTask` from `src/lib/general/permissions.ts` for who may edit priority and dependencies.
- Produces:
  - **Priority.** A "Priority" select in the task window, saved with the task's existing update path, editable when `canEditTask`.
  - **"Subtasks" section.** It's hidden when the task is itself a subtask, and its add control is hidden when `allowSubtasks` is off.
    - It lists the children with status and holder, and each child opens in the same dialog.
    - The header shows "{done}/{total} done".
    - An "Add a subtask" title field calls `createSubtask`. It's shown to the PM and coordinators, the lead of the task's team, and the task's holders.
  - **Parent link.** A subtask shows "Part of {parent title}", which opens the parent.
  - **"Waiting for" section.** Its add control is hidden when `allowDependencies` is off.
    - It lists the blockers with their status, each with a remove control when `canEditTask`.
    - An "Add" picker searches the project's tasks (excluding the task itself and its subtasks) and calls `addDependency`.
  - **Done blocked.** When the task has open blockers, a note shows: "Waiting for {n} task(s). It can't be marked done until they are."
  - Errors use `authErrorMessage`.
- [ ] **Step 1: Write failing tests:**
  - adding a subtask calls `createSubtask(parentId, 'Login form')`;
  - a subtask shows "Part of …";
  - adding a dependency calls `addDependency`;
  - the waiting note appears with an open blocker;
  - controls are hidden for a viewer without edit rights;
  - the add controls are hidden when the switches are off.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Show priority, subtasks and dependencies in the task window".

### Task 6: Board, list and My tasks

**Files:**
- Modify: `src/components/tasks/TaskCard.tsx` (or the work-project card used by `src/components/general/TasksTab.tsx`), `src/components/tasks/TaskList.tsx`, `src/components/tasks/TaskFilters.tsx` and `taskFilterState.ts`, `src/pages/app/tasks/MyTasks.tsx`
- Create: `src/components/general/PriorityBadge.tsx`
- Test: the matching `*.test.tsx`, plus `taskFilterState` tests

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces:
  - **Priority badge.** `PriorityBadge`: Urgent uses `danger-*`, High `warning-*`, Low `pending-*`. Normal shows no badge, so cards stay as they are today.
  - **Subtask count.** Shown on a parent card as "2/3".
  - **Waiting marker.** A small "Waiting" marker with a tooltip that names the blockers.
  - **Subtask cards.** They show "Part of {parent}" in the meta line.
  - **Filters.** Tasks and My tasks gain a Priority filter (multi-select) and a "Priority" sort option (Urgent first, then the current order). The filter state is saved like the existing filters.
  - **Class boards.** Unchanged: no badges, because their tasks have no priority.
- [ ] **Step 1: Write failing tests:**
  - the badge renders for urgent, high and low, and not for normal;
  - the filter keeps only matching priorities;
  - the priority sort puts urgent first;
  - a parent card shows "2/3".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**: "Show priority, subtasks and waiting on task cards and filters".

### Task 7: Docs, checks, owner review

**Files:**
- Modify: `docs/07-backup.md`. Add `supabase/project-task-rules.sql` after `supabase/project-settings-general.sql` in both restore commands and the rerun tail, plus a section on what it owns.
- Modify: `CLAUDE.md`. Add one bullet under Project roles covering the run position, the re-run rule, and that the task rules are separate triggers.
- Modify: `handoff.md`. Add a new section at the end.
- [ ] **Step 1: Run checks.**
  - `npm run build`
  - `npx vitest run`
  - eslint on the changed files
  - `node scripts/contrast.mjs`
  - SQL dry-runs: `project-task-rules`, plus the sibling suites

  Expected: all green.
- [ ] **Step 2: Commit**: "Document task priority, subtasks, dependencies and rules".
- [ ] **Step 3: Stop for owner review**, then:
  1. Run `node scripts/db.mjs supabase/project-task-rules.sql supabase/anon-lockdown.sql`.
  2. Do a read-only check.
  3. Re-run the suites.
  4. Push `main`.
