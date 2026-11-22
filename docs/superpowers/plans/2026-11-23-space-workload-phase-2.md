# Space workload balancing, phase 2 (views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People see workload where they assign and plan: hours beside names in every work-task holder picker, a space Workload tab, an estimate on new Open-flow tasks, and a database block that stops a Member from loading someone who has no room.

**Architecture:** Phase 1's `supabase/work-workload.sql` grows: the load arithmetic moves into one internal helper that both the visible load function and the new checks use; a team-lead row joins the visibility rules; a deferred constraint trigger on `general_task_assignees` enforces the Member overload block using the `assigned_by` column the Open writers already fill; a wrapper creates an Open task with its estimate in one transaction. The frontend adds one hook for holder hours, the Workload tab, and the Open estimate field.

**Tech Stack:** React + TypeScript (Vite), Supabase PostgreSQL, Deno Edge Function `work-ai`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-space-workload-balancing-design.md` — phase 2 = "Views" under Phases: sections "Visibility" (team-lead row), "Space Workload view", "Hours in the holder picker", "Open task flow". Phase 1 shipped (`handoff.md`, "Space workload, phase 1").

## Global Constraints

- Work projects and work spaces only. Class boards and class spaces are untouched.
- Minutes stored, hours shown with at most one decimal ("14 h"). Weeks are Monday to Friday in Asia/Manila; on a weekend "this week" is the next Monday to Friday (`workWeek` in `src/lib/work/hours.ts`, `v_today` in SQL).
- Unknown is never zero: "Not set" for unknown weekly hours; unestimated tasks counted, never summed.
- Load colours: `success` under 80%, `warning` 80–100%, `danger` over 100%, `pending-soft`/`pending-ink` when hours are unknown. Tokens only.
- Members never see another person's hours; they see only "No room this week" status. The database enforces every visibility rule; the UI renders what the functions return.
- No existing guard or function is redefined. `create_general_open_task` (final owner `project-task-types.sql`) and `set_general_task_holders` (`project-open-tasks.sql`) stay as they are; new behaviour comes from functions and triggers in `work-workload.sql`, which keeps its place after `section-students.sql` and before `anon-lockdown.sql`.
- The model never receives names, ids, hours, time off or a person's skills.
- Copy: sentence case, no "please", no "successfully", no exclamation marks; errors say what happened and what to do next. Desktop first.
- Fetch `origin/main` before branching and before any deploy; ask the user before pushing `main`.

## Review Focus

- A Member adds two holders at once and only the second has no room: the whole change is refused and neither holder is added (Task 2 test `member multi-holder refused whole`).
- A Member picks themselves while over capacity: allowed (Task 2 test `member picks self over capacity`).
- A task with no estimate, or a holder with unknown weekly hours: no block, and the picker shows the unknown state rather than "No room" (Task 2 test `unknown never blocks`; Task 3 test `unknown hours label`).
- A project PM who is not a space planner opens the Workload tab: rows only for their projects' people, other projects as one unnamed total, no task titles from projects they cannot read (Task 4 SQL test `tab tasks hidden outside reads`; Task 5 test `pm sees folded other work`).
- The Workload tab on a space with nobody's hours set: rows show "Not set" bars, never 0 / 0 h or a divide-by-zero (Task 5 test `no hours set`).

## File map

| Path | Responsibility |
| --- | --- |
| `supabase/work-workload.sql` | Shared load helper, lead visibility, room check, overload trigger, Open wrapper, person tasks, summary |
| `supabase/tests/work-workload.test.sql` | New sections per task |
| `src/lib/api/workload.ts` | New RPC clients |
| `src/lib/work/useHolderHours.ts` (+ test) | Labels and tones for holder pickers |
| `src/components/general/TaskDialog.tsx`, `src/components/general/TasksTab.tsx` (`NewTaskDialog`), `src/components/general/LeadInbox.tsx` | Picker labels, warnings, Open estimate field |
| `src/pages/general/SpaceWorkload.tsx` (+ test), `src/pages/general/SpaceLayout.tsx`, `src/App.tsx`, `src/lib/paths.ts` | Workload tab |
| `supabase/functions/work-ai/index.ts`, `src/lib/api/workAi.ts` | Suggest estimate from text for a task not yet created |

---

### Task 1: Shared load helper, lead visibility and room status (SQL)

**Files:**
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`

**Interfaces:**
- Produces:
  - internal `work_person_load(p_space uuid, p_user uuid, p_from date, p_to date, p_skip_task uuid default null) returns table(project_id uuid, load_minutes numeric, unestimated int)` — the phase-1 counting rules exactly (released, not Done, live, held, no live subtasks, share ÷ holders, span spreading with the weekend anchor), with **no** visibility; revoked from every client role. `general_space_people_load` is rewritten to call it and then apply visibility, with identical results (all existing load checks must still pass unchanged).
  - internal `work_person_available(p_space uuid, p_user uuid, p_from date, p_to date) returns int` (null when weekly hours are null) — same rules as `general_space_people_hours`, which is rewritten to use it.
  - visibility: in `work_workload_people`, a caller who is `leader_id` of a live team (`general_teams.archived_at is null`) in a live work project of the space, with an active profile, also sees that team's members (`general_team_members`); for them only that project is named, the rest folds to null.
  - `general_task_holder_room(p_task uuid, p_users uuid[]) returns table(user_id uuid, room text)`: `room` is `'ok'`, `'full'` or `'unknown'`. Window = the task's weeks: Monday of the week holding its anchored start (or the anchored today when undated or overdue) to Friday of the week holding its due date (or that same Friday). `'full'` when the person's load in that window plus this task's share as if they held it (estimate ÷ (current holders not counting them + 1)) exceeds their available minutes; `'unknown'` when the task has no estimate or the person has no weekly hours. Callable by anyone who passes `general_open_task_role(project) in ('pm','coordinator','member')` or is a lead of the task's team; refuses others with "You can't assign tasks in this project."; only returns rows for `p_users` who are project members. Returns no minutes.
- [ ] **Step 1: Write failing checks** (section "phase 2: helper and room"): `people_load unchanged` (re-run the phase-1 load expectations through the rewritten function — they already exist; they must still pass); `lead sees team` (a lead who is a plain member sees their team's members with their project named and nothing else); `lead not other teams`; `room ok`, `room full` (16 h a week, 14 h held in the task's week, a 3 h task → `'full'`), `room unknown no estimate`, `room unknown no hours`, `room counts shared share` (2 current holders + them → estimate ÷ 3), `room refuses stakeholder`.
- [ ] **Step 2: Run, see the first new check fail.** `node scripts/db.mjs supabase/tests/work-workload.test.sql`
- [ ] **Step 3: Implement.** Grants: `general_task_holder_room(uuid, uuid[])` to `authenticated`.
- [ ] **Step 4: Apply `supabase/work-workload.sql` then `supabase/anon-lockdown.sql`; run the suite → all `PASS`.**
- [ ] **Step 5: Commit** "Share load arithmetic and add holder room".

### Task 2: Member overload block and Open task with estimate (SQL)

**Files:**
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - constraint trigger `general_task_assignees_room` — `after insert on general_task_assignees deferrable initially deferred for each row` — calling `guard_work_holder_room()`. It acts only when: the task's project is a work project with `task_flow = 'open'`; `new.assigned_by` is not null and `<> new.user_id`; `general_role_of(project, new.assigned_by) = 'member'`; the row still exists at check time; the task has an estimate; the holder has weekly hours. It then compares the holder's load (Task 1 helper, which now includes this task at its final holder count) with their available minutes over the task's weeks (same window rule as `general_task_holder_room`) and raises `'<First name> has no room this week. Pick someone else or ask a project manager.'` when the window is one week, else `'<First name> has no room in those weeks. Pick someone else or ask a project manager.'`, errcode `check_violation`. Because it is deferred, a multi-holder change is judged on its final state and refused as a whole.
  - `create_work_open_task(p_project uuid, p_title text, p_description text, p_starts_at timestamptz, p_due_at timestamptz, p_team uuid, p_priority text, p_kind text, p_holders uuid[], p_task_type text, p_estimate_minutes int) returns uuid` — calls the existing 10-argument `create_general_open_task` unchanged with the first ten arguments, then, when `p_estimate_minutes` is not null, sets it on the new task under `collabify.estimate_write` and writes the same `updated` history row `set_work_task_estimate` writes (actor = caller), all in one transaction so the deferred room check sees the estimate. `p_estimate_minutes` must be 1–60000. Granted to `authenticated`.
- [ ] **Step 1: Write failing checks** (section "phase 2: overload"): an Open project, a Member M, holders B (16 h, 14 h held this week) and C (16 h, free):
  - `member over capacity refused`: as M, `create_work_open_task(..., holders [B], estimate 180)` → refuse, needle `has no room this week`; the task does not exist.
  - `member set holders refused`: an existing estimated task, `set_general_task_holders(t, [B])` as M → refuse; holders unchanged.
  - `member multi-holder refused whole`: `set_general_task_holders(t, [C, B])` → refuse; C not added.
  - `member picks self over capacity`: M at capacity adds themselves → allowed.
  - `planner over capacity allowed`: the project's coordinator adds B → allowed.
  - `unknown never blocks`: no estimate → allowed; B with null weekly hours → allowed.
  - `planned project untouched`: same as M in a Planned project's lead flow → no room check.
  - `wrapper sets estimate`: `create_work_open_task(..., estimate 90)` → `estimated_minutes = 90` and one `updated` history row with `estimate_to = 90`.
- [ ] **Step 2: Run, see `member over capacity refused` fail.**
- [ ] **Step 3: Implement.** Use `create constraint trigger` with `drop trigger if exists` first for idempotency. Read the first name from `profiles`.
- [ ] **Step 4: Apply the file and `anon-lockdown.sql`; run this suite plus `project-open-tasks`, `project-task-types`, `work-task-handoff`, `anon-lockdown` → all `PASS`.**
- [ ] **Step 5: Commit** "Refuse a Member's holder with no room".

### Task 3: Hours in holder pickers and the Open estimate field

**Files:**
- Create: `src/lib/work/useHolderHours.ts`, `src/lib/work/useHolderHours.test.ts`
- Modify: `src/lib/api/workload.ts`, `src/components/general/TaskDialog.tsx` (the "Assign someone" select), `src/components/general/TasksTab.tsx` (`NewTaskDialog`: holders and the estimate field), `src/components/general/LeadInbox.tsx` (Assign members), `src/lib/api/general.ts` (`createOpenTask` calls `create_work_open_task`), `supabase/functions/work-ai/index.ts`, `src/lib/api/workAi.ts`, related test files

**Interfaces:**
- Consumes: `general_space_people_load` / `general_space_people_hours` (phase 1), `general_task_holder_room` and `create_work_open_task` (Tasks 1–2).
- Produces:
  - `holderRoom(taskId: string, userIds: string[]): Promise<{ user_id: string; room: 'ok' | 'full' | 'unknown' }[]>` in `workload.ts`
  - `useHolderHours({ spaceId, projectId, userIds, taskId, viewer }): Map<string, { text: string; tone: 'success' | 'warning' | 'danger' | 'pending' }>` where `viewer` is `'planner'` (pm, coordinator, or a lead of the task's team: reads this week's load and hours and shows `"14 / 16 h this week"`, `"Not set"`) or `'member'` (reads `holderRoom` and shows only `"No room this week"` for `'full'`; nothing for `'ok'` or `'unknown'`). With no `taskId` (new task), members get no room status.
  - `createOpenTask(...)` gains `estimateMinutes: number | null` and calls `create_work_open_task`.
  - `work-ai` `estimate` action accepts `{ title, description }` without `task_id` for a caller with `general_open_task_role(project) in ('pm','coordinator','member')`; `suggestEstimateFromText(projectId, title, description)` in `workAi.ts`.
- Picker rules: the label follows each name (`"Ben Cruz · 14 / 16 h this week"` in native `<option>` text; chips elsewhere use the tone). Picking someone whose projected load passes their hours shows a `warning` line under the picker: "Ben goes over available hours this week." Nothing is blocked in the UI; for a Member the database refusal message shows as the error. In the New task dialog there is no task yet, so a Member sees no room status there and learns of a full person from the refusal (controller ruling; cost: one extra try).
- [ ] **Step 1: Write failing tests:** `useHolderHours.test.ts`: planner labels (`14 / 16 h this week`, tone `warning`; `18 / 16 h this week`, `danger`; `Not set`, `pending`); member labels (`full` → `No room this week`; `ok` and `unknown` → no entry); `unknown hours label`. TaskDialog test: an Open project, viewer pm, the select's option text includes `· 14 / 16 h this week`; viewer member sees `· No room this week` for a full person; picking an over-capacity person as pm shows the warning line. NewTaskDialog test: Open project shows "Estimated effort (hours)" and Suggest estimate; Create passes `estimateMinutes: 90` for "1.5"; a refusal "Ben has no room this week. Pick someone else or ask a project manager." shows as the error. LeadInbox test: Assign members shows each candidate's hours.
- [ ] **Step 2: Run** `npx vitest run src/lib/work/useHolderHours.test.ts src/components/general` → fail.
- [ ] **Step 3: Implement.** Reuse `formatHours`, `workWeek`, `parseHours`. One fetch per open picker, not per option.
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Show hours where holders are picked".

### Task 4: Person tasks and summary for the Workload tab (SQL)

**Files:**
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`

**Interfaces:**
- Consumes: Task 1 helpers and visibility.
- Produces:
  - `general_space_person_tasks(p_space uuid, p_user uuid, p_from date, p_to date) returns table(task_id uuid, project_id uuid, title text, minutes int, unestimated boolean)` — the tasks counted in that person's load for the window, only in projects named for the caller (`work_workload_names`); refuses a person the caller may not see (same message as the load function).
  - `general_space_workload_summary(p_space uuid, p_from date, p_to date) returns table(unestimated_tasks int, people_without_hours int)` — over the people the caller may see; `unestimated_tasks` counts distinct tasks.
- [ ] **Step 1: Write failing checks:** `person tasks for planner` (space PM sees titles from every project); `tab tasks hidden outside reads` (a project PM sees only their project's titles; another project's work returns no rows); `member own tasks`; `member refused for others`; `summary distinct` (a task held by two visible people counts once); `summary no hours`.
- [ ] **Step 2–4:** run (fail), implement (grant both to `authenticated`), apply the file and `anon-lockdown.sql`, run → `PASS`.
- [ ] **Step 5: Commit** "Read a person's tasks for the Workload tab".

### Task 5: Space Workload tab

**Files:**
- Create: `src/pages/general/SpaceWorkload.tsx`, `src/pages/general/SpaceWorkload.test.tsx`
- Modify: `src/pages/general/SpaceLayout.tsx` (tab between Projects and Reports, work spaces only), `src/App.tsx` (route `workload`), `src/lib/paths.ts` (`spaceWorkload`), `src/lib/paths.test.ts`, `src/lib/api/workload.ts`

**Interfaces:**
- Consumes: `spacePeopleLoad`, `spacePeopleHours` (phase 1); `spacePersonTasks(spaceId, userId, from, to)` and `spaceWorkloadSummary(spaceId, from, to)` added to `workload.ts` for Task 4's functions.
- Produces: `paths.spaceWorkload(id) === '/spaces/<id>/workload'`; `<SpaceWorkload />`.
- Layout (spec "Space Workload view"): people down the side, four Mon–Fri weeks across starting at this week (`workWeek`), arrows move one week; each cell a bar `load / available` with the load colours and time off as a hatched segment (`time_off_minutes`); "Not set" cells in pending tokens; a row expands to that week's tasks from `spacePersonTasks`, with other projects as one "Other work in this space" total; footer from `spaceWorkloadSummary` ("3 tasks have no estimate · 1 person has no weekly hours set"). Members see only their own row. Class spaces have no tab. Phone: one week at a time with the arrows.
- [ ] **Step 1: Write failing tests:** `four weeks from this week`; `bar tones` (10/16 → success, 13/16 → warning, 18/16 → danger); `no hours set` (shows "Not set", no NaN); `pm sees folded other work` ("Other work in this space · 6 h", no foreign titles); `member own row only`; `expand loads tasks once`; `class space has no tab` (SpaceLayout test); `paths.spaceWorkload`.
- [ ] **Step 2: Run** `npx vitest run src/pages/general/SpaceWorkload.test.tsx src/pages/general/SpaceLayout* src/lib/paths.test.ts` → fail.
- [ ] **Step 3: Implement.** Load four weeks in parallel (load and hours per week); cache by week start.
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Add the space Workload tab".

### Task 6: Live checks, deploy, walk and notes

**Files:**
- Modify: `handoff.md` (new section at the end), `CLAUDE.md` (extend the Space workload bullet), `docs/07-backup.md` (Space workload section names the new functions and trigger)

- [ ] **Step 1:** `git fetch origin` and merge `origin/main` if it moved. Apply `supabase/work-workload.sql` then `supabase/anon-lockdown.sql`; run suites `work-workload`, `project-open-tasks`, `project-task-types`, `work-task-handoff`, `anon-lockdown` → all `PASS`. Full `npx vitest run` and `npm run build` → pass.
- [ ] **Step 2:** Deploy `work-ai` from the up-to-date branch: `supabase functions deploy work-ai --project-ref jublbxdqzcjmbunukxct --use-api`.
- [ ] **Step 3 (controller, browser):** on Capstone 2 → Collabify (Open flow, demo data from phase 1): as the PM, the holder select shows hours; the Workload tab shows Wilson, Ivan and Keneth over four weeks with Wilson's time off hatched; as a Member (ask the user to sign in as one), the picker shows "No room this week" for a full person and assigning them is refused with the copy above; New task with an estimate saves it. Desktop and 375 px.
- [ ] **Step 4:** Write the docs, `npm run build`, commit "Note workload phase 2"; ask the user before merging to `main` and pushing.
