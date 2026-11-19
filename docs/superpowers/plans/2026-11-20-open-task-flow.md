# Open task flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project task flow setting: Planned handoff (today) or Open (any member creates live tasks and assigns
anyone), plus Priority and Holder in the New task dialog.

**Architecture:** One new SQL file, `supabase/project-open-tasks.sql`, adds `general_projects.task_flow` and four
security-definer functions. It redefines nothing. The app reads `taskFlow` with the project and calls those
functions in Open mode. Planned projects keep every existing path.

**Tech Stack:** Postgres/Supabase SQL, React + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-open-task-flow-design.md`

## Global Constraints

- `task_flow` values exactly `'planned'` (default) and `'open'`. Class boards are untouched.
- Only the project manager switches the mode (`set_general_task_flow`).
- In Open mode, `pm`, `coordinator` and `member` create tasks and set holders. QA creates bugs only, with no holders.
  Stakeholders and read-only viewers do nothing.
- Holders are active project members whose role isn't `qa` or `stakeholder`. The single-holder rule
  (`allow_multiple_assignees`) applies.
- Open-created tasks keep `sent_at` null. Tasks released by the switch get `sent_at` now.
- Edit rights don't widen: no change to `guard_general_task`, `guard_general_task_child`,
  `guard_general_task_sent_creator` or any policy.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Colors from tokens only.
- SQL file order: after `message-mentions.sql`, before `anon-lockdown.sql`. Idempotent.
- `npm run build` before claiming anything works.

## Review Focus

- A Member's Open task with a holder in a `require_assignee` project lands at the default stage, not stage 0
  (Task 1 test `holder lands at default stage`).
- Two people setting holders on the same task at once serialize, and the single-holder rule still holds (row lock;
  Task 1 test `single holder refused`).
- A project switched to Open while a planning task is archived or trashed leaves that task in planning (Task 1 test
  `switch skips archived`).
- Switching back to Planned: a PM's New task goes to planning again, and the dialog hides Holder (Task 4 test).
- In Open mode, a planning task created by From notes still reaches Plan & route (Task 5 test).

---

### Task 1: SQL — column, mode switch, open create, holders

**Files:**
- Create: `supabase/project-open-tasks.sql`
- Test: `supabase/tests/project-open-tasks.test.sql`

**Interfaces:**
- Produces (all `security definer`, `set search_path = public`, execute granted to `authenticated` only):
  - `general_projects.task_flow text not null default 'planned'`, constraint `general_projects_task_flow` check
    `in ('planned','open')`.
  - `set_general_task_flow(p_project uuid, p_flow text) returns int`: tasks released.
  - `preview_general_task_flow(p_project uuid) returns table(planning int, review int)`.
  - `create_general_open_task(p_project uuid, p_title text, p_description text, p_starts_at timestamptz,
    p_due_at timestamptz, p_team uuid, p_priority text, p_kind text, p_holders uuid[]) returns uuid`.
  - `set_general_task_holders(p_task uuid, p_holders uuid[]) returns void`.
  - Trigger `general_projects_task_flow_guard` (before update of `task_flow`), function
    `guard_general_task_flow()`: raises "Change the task flow in Settings." unless
    `current_setting('collabify.task_flow_set', true) = 'on'` or `auth.uid() is null`.

- [ ] **Step 1: Write the suite.** Copy the fixture helpers (`act_as`, `service`, `check`, `refuse`) and the
  project/space/member setup from `supabase/tests/send-to-planner.test.sql`. Setup: a work project with
  `require_assignee` on, `default_stage` 1, four stages, QA stage `Testing` and an active QA member, so the gate is
  live; people pm, coordinator, member A, member B, qa, stakeholder; a team; two planning tasks, one in
  `coordinator_review`, one archived planning task. Checks (labels exact):
  - `default planned`: new project's `task_flow = 'planned'`.
  - `direct update refused`: as pm, `update general_projects set task_flow='open'` is refused with "Change the task
    flow in Settings".
  - `coordinator can't switch`: `set_general_task_flow` as coordinator refused, "Only the project manager".
  - `preview counts`: as pm, preview returns planning 2, review 1.
  - `switch releases`: as pm, `set_general_task_flow(p,'open')` returns 3; those three are `released`,
    `reviewer_id` null, `sent_at` not null, team kept; each has a `sent_to_team` event with the pm as actor.
  - `switch skips archived`: the archived task stays `planning`.
  - `member creates live`: as member A, `create_general_open_task(... priority 'high', kind 'task',
    holders {B})` returns an id; the row is `released`, `priority='high'`, `sent_at` null, `created_by` = A; B holds
    it; the `created` and `assigned` events have actor A; `assigned_by` = A.
  - `holder lands at default stage`: that task's stage index is 1.
  - `no holder stays first stage`: an Open create without holders (require_assignee on) is at stage 0.
  - `creator keeps rights while unheld`: as A, update the title of A's unheld Open task succeeds.
  - `member can't edit held task`: as A, updating the title of the task B holds is refused (the existing holder
    message).
  - `member reassigns`: as A, `set_general_task_holders(task held by B, {A})` leaves only A holding.
  - `member clears holders`: on a stage-0 task, `set_general_task_holders(t, '{}')` leaves none.
  - `single holder refused`: with `allow_multiple_assignees` off, holders `{A,B}` refused "one holder per task".
  - `qa/stakeholder holder refused`: holders `{qa}` refused, "can hold tasks".
  - `qa creates bug`: as qa, kind 'bug' with no holders works and is `released`; kind 'task' refused "QA creates
    bug tasks only"; bug with holders refused "QA can't assign".
  - `stakeholder refused`: create and set holders refused, "Stakeholders can view this project".
  - `holders refused in QA or done`: a task at the QA stage, then one Done: `set_general_task_holders` refused
    "Reopen it before changing who holds it".
  - `planned project refuses open calls`: on a second (planned) project, `create_general_open_task` and
    `set_general_task_holders` refused, "This project uses planned handoff".
  - `QA gate holds`: as B holding a task at stage 1, updating it past the QA stage is refused (existing gate
    message).
  - `release rule fires`: a workflow rule `task_released` → set priority `urgent`; an Open create ends `urgent`.
  - `switch back`: `set_general_task_flow(p,'planned')` returns 0; holders stay; as pm a direct insert into
    `general_tasks` is `planning`.
  Ends with `rollback;`.

- [ ] **Step 2: Run it, expect failure.**
  Run: `node scripts/db.mjs supabase/tests/project-open-tasks.test.sql`
  Expected: error that `task_flow` or `set_general_task_flow` does not exist.

- [ ] **Step 3: Write `supabase/project-open-tasks.sql`.** Header comment in the style of `send-to-planner.sql`
  (what it owns, that it redefines nothing, run order). Pieces:
  - Column + constraint (`add column if not exists`, drop/add constraint).
  - Guard trigger as in Interfaces.
  - `set_general_task_flow`: refuses non-pm ("Only the project manager changes the task flow."), class boards,
    archived projects (`general_is_archived` / `general_archived_message`), unknown values. Locks the project
    `for update`. Same value → 0. To open: under `collabify.work_task_handoff = 'on'`, update live
    `planning`/`coordinator_review` tasks (`archived_at is null and trashed_at is null`) to released,
    `reviewer_id` null, `sent_at = clock_timestamp()`, and insert a `sent_to_team` event per task with the detail
    shape `send_work_tasks_to_planner` uses (`holder_id` null). Sets `collabify.task_flow_set` around the
    project update; restores both flags.
  - `preview_general_task_flow`: pm only; counts the same live tasks by state.
  - Shared checks for the two writers (inline or a private helper `general_open_task_check(p_project uuid)`, revoked
    from everyone): caller active writer (`general_can_write`), role from `general_members` joined to active
    `profiles`, work project, `task_flow='open'` else "This project uses planned handoff. Ask the project manager to
    open it.", not archived.
  - Holder validation: dedupe; each `general_members` row active, role not in `qa`,`stakeholder` ("Choose active
    project members who can hold tasks."); count > 1 with `allow_multiple_assignees` off → "This project allows one
    holder per task."
  - `create_general_open_task`: role in pm/coordinator/member/qa; QA rules as in Step 1; title trim, required, ≤ 200
    (the `create_general_member_task` messages); team in project; starts ≤ due ("A task cannot start after it is
    due."); priority null → project default, else must be a valid `task_priority` value. With claims cleared
    (save/restore `request.jwt.claims` and `request.jwt.claim.sub`, with the exception block
    `create_general_member_task` uses): insert as `planning`, `created_by` = caller; insert holders; restore the
    claims; then, under `collabify.work_task_handoff='on'`, update to `released` (leave `sent_at` null) so the
    default-stage and `task_released` triggers run as the caller. Fix `general_task_events.actor_id` (null →
    caller) for this task's `created`/`assigned` rows, and `general_task_assignees.assigned_by`.
  - `set_general_task_holders`: role pm/coordinator/member; lock the task `for update`; task released, live, same
    project; refuse at an active QA stage or Done (`general_project_has_qa`, `general_qa_stage_pick`,
    `general_task_stage_at`, `stage_count`): "Reopen it before changing who holds it."; validate holders; with
    claims cleared delete the holders not in the list and insert the missing ones; restore claims; fix actors and
    `assigned_by` as above. The existing `require_assignee` trigger decides an empty list past stage 0.
  - Grants; `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Apply and run.**
  Run: `node scripts/db.mjs supabase/project-open-tasks.sql supabase/anon-lockdown.sql` then
  `node scripts/db.mjs supabase/tests/project-open-tasks.test.sql`
  Expected: every `PASS`, no `FAIL`. Re-run `supabase/tests/send-to-planner.test.sql`,
  `project-member-rules.test.sql` and `project-task-rules.test.sql`: still pass.

- [ ] **Step 5: Commit** `supabase/project-open-tasks.sql`, the suite: "Add the open task flow to the database".

### Task 2: API and permission helpers

**Files:**
- Modify: `src/lib/api/general.ts` (getGeneralProject, createTask, new functions)
- Modify: `src/lib/general/permissions.ts`
- Test: `src/lib/general/permissions.test.ts`, `src/lib/api/generalTaskRules.test.ts` (or a new
  `src/lib/api/openTasks.test.ts` mocking supabase the way the existing api tests do)

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  - `export type TaskFlow = 'planned' | 'open'` in `permissions.ts`.
  - The project from `getGeneralProject` gains `taskFlow: TaskFlow` (its own query of `task_flow`, `'planned'` on a
    missing column, as the member-rules query does).
  - `createTask(input)` gains `priority?: TaskPriority` (sent only when given).
  - `createOpenTask(input: { projectId: string; title: string; description: string; startsAt: string | null;
    dueAt: string | null; teamId: string | null; priority: TaskPriority | null; kind: TaskKind; holderIds: string[] })
    : Promise<string>`.
  - `setTaskHolders(taskId: string, holderIds: string[]): Promise<void>`.
  - `setTaskFlow(projectId: string, flow: TaskFlow): Promise<number>`.
  - `previewTaskFlow(projectId: string): Promise<{ planning: number; review: number }>`.
  - `canCreateWorkTaskWith(role, kind, rules, flow: TaskFlow = 'planned')`: in `'open'`, `pm`/`coordinator`/`member`
    any kind, `qa` bug only.
  - `canSetHolders(role: ProjectRole | null, flow: TaskFlow, readOnly: boolean): boolean`: open and role in
    pm/coordinator/member and not readOnly.
  - `holderCandidates(members, roleOf): string[]`: active members not qa/stakeholder (shared by Task 4 and 5).

- [ ] **Step 1: Failing tests.** `canCreateWorkTaskWith('member','task',DEFAULT_MEMBER_RULES,'open')` true;
  `('member','bug',…,'open')` true; `('qa','task',…,'open')` false; `('stakeholder','task',…,'open')` false;
  `'planned'` keeps today's results. `canSetHolders('member','open',false)` true, `('qa','open',false)` false,
  `('member','planned',false)` false, `('member','open',true)` false. `holderCandidates` drops qa, stakeholder,
  inactive. API tests: `createOpenTask` calls `rpc('create_general_open_task', { p_project, p_title (trimmed),
  p_description, p_starts_at, p_due_at, p_team, p_priority, p_kind, p_holders })`; `setTaskHolders` calls
  `rpc('set_general_task_holders', { p_task, p_holders })`.
- [ ] **Step 2:** `npx vitest run src/lib/general/permissions.test.ts src/lib/api` → FAIL.
- [ ] **Step 3:** Implement the Interfaces above.
- [ ] **Step 4:** Same command → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** "Read the task flow and add open task calls".

### Task 3: Settings → Tasks flow panel

**Files:**
- Modify: `src/components/general/settings/TasksSection.tsx` (new `TaskFlowPanel`, first in `TasksSection`)
- Modify: `src/components/general/settings/MembersSection.tsx` (hide the `createTasks` option when
  `taskFlow === 'open'`)
- Test: `TasksSection.test.tsx`, `MembersSection.test.tsx`

**Interfaces:** Consumes `setTaskFlow`, `previewTaskFlow`, `project.taskFlow`.

- [ ] **Step 1: Failing tests.**
  - Shows "Task flow" with the two options and their lines, exactly:
    "Planned handoff" / "Tasks start in planning. The project manager or a coordinator sends them to a team." and
    "Open" / "Anyone on the project adds live tasks and assigns them to anyone."
  - A coordinator sees the current choice and no Save (the `RequestAccessButton` pattern StagesPanel uses).
  - PM picks Open and saves → confirmation shows "3 tasks waiting in planning or review go live now." (preview
    1+2; with 0 the line is "Nothing is waiting in planning.") → confirm calls `setTaskFlow(id,'open')`, toast
    "Task flow is open. 3 tasks are live." (0 → "Task flow is open.").
  - Switching to Planned needs no preview; toast "Task flow is planned handoff."
  - MembersSection: with `taskFlow: 'open'`, "Members can create tasks" isn't rendered.
- [ ] **Step 2:** `npx vitest run src/components/general/settings` → FAIL.
- [ ] **Step 3:** Build the panel: card like StagesPanel, two radio cards, Save, `Modal` confirm for Open, errors
  via `authErrorMessage(err, 'Could not change the task flow.')`, then `state.reload()`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** "Choose the task flow in Settings".

### Task 4: New task dialog — Priority and Holder

**Files:**
- Modify: `src/components/general/TasksTab.tsx` (`NewTaskDialog`, `mayCreate`)
- Test: `src/components/general/TasksTab.test.tsx` (create if missing, following the settings tests' state
  fixtures)

**Interfaces:** Consumes `createOpenTask`, `createTask({ priority })`, `canCreateWorkTaskWith(..., flow)`,
`holderCandidates`, `PRIORITIES` from `lib/general/types`.

- [ ] **Step 1: Failing tests.**
  - Open, member: dialog shows Type, Starts, Due, Team, Priority (default = project `defaultPriority`), Holder;
    no "goes to the project manager" description; Add calls `createOpenTask` with the picked holders and priority;
    toast "Task added"; the new task opens.
  - Open, `allowMultipleAssignees` false: Holder is a single select; true: picks several (chips with remove).
  - Open, qa: no Holder; Type fixed to Bug; Priority shown.
  - Planned, pm: Priority shown, no Holder; Add calls `createTask` with `priority`.
  - Planned, member with `createTasks`: no Priority, no Holder; still `createMemberTask` and "Sent to planners for
    review".
  - Switched back to planned (`taskFlow: 'planned'` after being open): pm sees no Holder.
  - Open, member: `mayCreate` true without the `createTasks` switch.
- [ ] **Step 2:** `npx vitest run src/components/general/TasksTab.test.tsx` → FAIL.
- [ ] **Step 3:** Implement. Reset priority and holders with the other fields after a save.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** "Set priority and holders when adding a task".

### Task 5: Task dialog holders and Tasks tab in Open mode

**Files:**
- Modify: `src/components/general/TaskDialog.tsx` (People section)
- Modify: `src/components/general/TasksTab.tsx` (Plan & route visibility, empty state)
- Test: `TaskDialog.test.tsx` (existing or new), `TasksTab.test.tsx`

**Interfaces:** Consumes `setTaskHolders`, `canSetHolders`, `holderCandidates`, `inQa` from `lib/work/qa.ts`.

- [ ] **Step 1: Failing tests.**
  - Open, member, task held by someone else: "Assign someone..." lists every holder candidate not already holding;
    picking calls `setTaskHolders(id, [...current, picked])` (with multiple holders off: `[picked]`, label
    "Reassign to..."); each holder chip has a remove button calling `setTaskHolders(id, current minus that one)`.
  - Open, task in QA (`inQa`) or Done: no picker, no remove, line "Reopen it before changing who holds it."
  - Open, qa or stakeholder viewer: no picker.
  - Planned: today's picker and `assignTask`/`unassignTask` unchanged (existing tests keep passing).
  - Tasks tab, Open, pm, no planning tasks: no "Plan & route work" button; empty state "Anyone on the project adds
    tasks and assigns them."; with one planning task (From notes): the button shows.
- [ ] **Step 2:** `npx vitest run src/components/general` → FAIL.
- [ ] **Step 3:** Implement. In Open mode the People section's assign/unassign go through `setTaskHolders`;
  Planned keeps the current code path untouched.
- [ ] **Step 4:** `npx vitest run` (whole suite) → PASS; `npm run build` clean.
- [ ] **Step 5: Commit** "Assign anyone in an open project".

### Task 6: Docs, live check, handoff

**Files:**
- Modify: `CLAUDE.md` (Project roles: an "Open task flow" bullet after "Send to planner", file order and suite),
  `docs/07-backup.md` (add `supabase/project-open-tasks.sql` after `message-mentions.sql` in both rerun lines and
  a paragraph like the message-mentions one), `handoff.md` (new section with **Deferred**: the role matrix doesn't
  reflect Open mode; From notes and AI drafts still start in planning; no bulk reassign).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2: Live check** with `npm run dev` in the browser pane on a test work project: switch to Open
  (confirm text, count), add a task as a Member with a holder and priority, reassign it from the task dialog, check
  the QA-stage block, switch back to Planned and add a task (goes to planning). Phone width 375 for both dialogs.
  Restore the test project's settings after.
- [ ] **Step 3: Commit** "Note the open task flow". Don't push: ask the user to review first.
