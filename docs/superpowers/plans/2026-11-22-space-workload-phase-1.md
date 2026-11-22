# Space workload balancing, phase 1 (demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly hours, time off and task estimates exist for work spaces, Collabify computes each person's load across the space, and a planner can break a released task into subtasks with recommended owners and save the approved plan in one transaction.

**Architecture:** One SQL file (`supabase/work-workload.sql`) owns the inputs, the load functions (layered visibility enforced inside them), the breakdown context and the atomic apply. `work-ai` gets `breakdown` and `estimate` actions that see labels only. A deterministic allocator in `supabase/functions/_shared/workloadPlan.ts` recommends owners in the browser; the review dialog never writes until Create.

**Tech Stack:** React + TypeScript (Vite), Supabase PostgreSQL, Deno Edge Function `work-ai` (Anthropic SDK, `ask()` with JSON schema), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-space-workload-balancing-design.md` (phase 1 = "Demo" under Phases). Phase 2 owns the team-lead row of the Visibility table, the holder picker, the Workload tab and the Open-flow estimate field and overload block; phase 3 the timer and Home card.

## Global Constraints

- Work projects and work spaces only. Class boards, class spaces and their tasks are refused.
- Store minutes; show hours with at most one decimal ("14 h", "1.5 h"). Weekly hours spread over Monday to Friday. Dates are Asia/Manila calendar dates.
- Unknown is never zero: null weekly hours shows "Not set"; tasks without an estimate are counted, never summed as 0.
- The model never receives names, user ids, hours, time off or a person's skills. Only the parent's title and description, the project's skill tags and position names as labels, and the window length in weekdays.
- No existing guard or function is redefined. Writes that bypass a guard use a transaction-local `collabify.*` flag, set and restored the way `supabase/send-to-planner.sql` does.
- SQL is idempotent, runs after `project-open-tasks.sql` and before `anon-lockdown.sql`, and is listed in the same position in `docs/07-backup.md` (both command lines) and `scripts/schema-drift.mjs`.
- Design tokens only (`success-*`, `warning-*`, `danger-*`, `pending-*` for load states), copy rules from `CLAUDE.md` (sentence case, no "please", no "successfully", errors say what to do next), desktop layout first.
- `npm run build` before claiming anything works. Ask the user before pushing `main`.

## Review Focus

- A window that holds no weekday (Saturday to Sunday) gives 0 available hours and 0 load, never a division by zero (Task 2 test `weekend window`).
- Time off covering every weekday of the window gives 0 h available and "0 h free", never negative (Task 2 test `time off floors at zero`).
- AI output with a cycle, a self link, a duplicate key or an unknown skill label is refused with a readable message, and the dialog stays usable (Task 5 tests).
- An owner removed from the receiving team (or turned QA) between review and Create makes the whole save fail with zero new rows (Task 6 test `owner left team`).
- A double click on Create, or two planners saving at once, never creates two sets of subtasks (Task 6 test `second apply refused`; Task 7 disables the button while saving).

## File map

| Path | Responsibility |
| --- | --- |
| `supabase/work-workload.sql` | Estimate writer, weekly hours, time off, load and hours functions, breakdown context, apply |
| `supabase/tests/work-workload.test.sql` | SQL suite, one section per task |
| `supabase/functions/_shared/workloadPlan.ts` | Allocator, dependency groups, breakdown output validation |
| `src/lib/work/workloadPlan.test.ts` | Allocator and validation tests |
| `supabase/functions/work-ai/index.ts` | `breakdown` and `estimate` actions |
| `src/lib/work/hours.ts` (+ test) | `formatHours`, `parseHours` |
| `src/lib/api/workload.ts` | RPC clients |
| `src/lib/api/workAi.ts` | `draftBreakdown`, `suggestEstimate` |
| `src/components/general/TaskDialog.tsx` | Estimate field in hours, Suggest estimate, Break down and balance entry |
| `src/lib/general/history.ts` | History line for an estimate change |
| `src/pages/general/SpaceMembers.tsx` | Weekly hours column |
| `src/components/settings/TimeOffSetting.tsx` (+ test), `src/pages/Settings.tsx` | Time off |
| `src/components/general/WorkloadPlanDialog.tsx` (+ test) | Review and Create |

---

### Task 1: Estimates, weekly hours and time off (SQL)

**Files:**
- Modify (rewrite): `supabase/work-workload.sql` (replace the Codex guard; keep `estimated_minutes`)
- Create: `supabase/tests/work-workload.test.sql` (copy the `act_as` / `service` / `check` / `refuse` helpers from `supabase/tests/project-open-tasks.test.sql`; the file runs in one transaction and rolls back)
- Modify: `docs/07-backup.md` (both commands: `work-workload.sql` right after `project-open-tasks.sql`), `scripts/schema-drift.mjs` (keep `work-workload` directly before `anon-lockdown` at the end of `ORDER`, where the Codex edit put it)

**Interfaces:**
- Produces:
  - column `general_tasks.estimated_minutes int null check (estimated_minutes between 1 and 60000)`
  - `set_work_task_estimate(p_task uuid, p_minutes int) returns void`
  - table `general_space_capacity(space_id uuid, user_id uuid, weekly_minutes int null check (weekly_minutes between 0 and 10080), updated_by uuid, updated_at timestamptz)`, PK `(space_id, user_id)`, FK `(space_id, user_id)` → `general_space_members` on delete cascade, RLS on, **no policies**
  - `set_space_weekly_minutes(p_space uuid, p_user uuid, p_minutes int) returns void`
  - table `user_time_off(id uuid pk, user_id uuid not null default auth.uid() references profiles on delete cascade, off_on date not null, minutes int null check (minutes between 1 and 1440), created_at timestamptz)`, `unique (user_id, off_on)`; null `minutes` = full day; RLS: a person selects, inserts, updates and deletes only their own rows
  - internal flag `collabify.estimate_write`

- [ ] **Step 1: Write the failing SQL checks** (section "estimates, hours, time off"). Seed a work space with a space PM, a space coordinator, two members; a work project in it with a pm, a coordinator, a member holding task T and a member not holding it; and a class board task. Checks:
  - `planner sets estimate`: pm calls `set_work_task_estimate(T, 360)` → `estimated_minutes = 360` and one `general_task_events` row with `kind='updated'`, `detail->'fields' = '["estimated_minutes"]'`, `detail->>'estimate_from'` null, `detail->>'estimate_to' = '360'`, `actor_id` = pm.
  - `holder sets estimate`: holder sets 300 → stored.
  - `non-holder refused`: other member → refuse, needle `Only the project manager, coordinators or the task's holder`.
  - `direct update refused`: as pm, `update general_tasks set estimated_minutes = 10` → refuse, needle `Use the estimate field`.
  - `class board refused`: needle `work projects only`.
  - `clear estimate`: pm sets null → null, history `estimate_to` null.
  - `own weekly hours`: member sets own 960 → row exists.
  - `space planner sets hours`: space coordinator sets another member's 960 → ok.
  - `member cannot set others`: needle `Only the space's project manager or coordinators`.
  - `hours read closed`: as a member, `select count(*) from general_space_capacity` = 0.
  - `time off own only`: member inserts own row; as another member, `select count(*) from user_time_off where user_id = <first>` = 0.
- [ ] **Step 2: Run it to see it fail.** `node scripts/db.mjs supabase/tests/work-workload.test.sql` → `FAIL planner sets estimate` (function missing).
- [ ] **Step 3: Implement in `supabase/work-workload.sql`.**
  - Guard trigger `general_tasks_work_estimate` (BEFORE INSERT OR UPDATE OF estimated_minutes): with `auth.uid()` not null and the flag off, refuse "Use the estimate field to change the estimate." A non-null estimate on a class board task is always refused ("Estimates are for work projects only.").
  - `set_work_task_estimate`: security definer; task live (`archived_at`, `trashed_at` null) in a live work project; caller passes `general_can_write(project)` and is pm/coordinator (`general_role_of`) or a row in `general_task_assignees` for the task; no-op when unchanged; sets the flag, updates, restores the flag, inserts the history row (Step 1 shape).
  - `set_space_weekly_minutes`: work space (no class link, not archived); `p_user` is a space member; caller is `p_user` or has `general_space_members.role in ('pm','coordinator')` in that space; upsert; null stores null.
  - Grants: execute on both functions to `authenticated`; revoke from `public, anon`.
- [ ] **Step 4: Run the suite.** Apply `node scripts/db.mjs supabase/work-workload.sql supabase/anon-lockdown.sql`, then the test file → every `PASS`, no `FAIL`.
- [ ] **Step 5: Commit.** `git add supabase/work-workload.sql supabase/tests/work-workload.test.sql docs/07-backup.md scripts/schema-drift.mjs` and commit "Store estimates, weekly hours and time off".

### Task 2: Load and hours functions (SQL)

**Files:**
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `work_weekdays(p_from date, p_to date) returns int` (Mon–Fri count, inclusive; 0 when `p_to < p_from`); immutable; not granted to clients
  - `general_space_people_hours(p_space uuid, p_from date, p_to date, p_users uuid[] default null) returns table(user_id uuid, weekly_minutes int, available_minutes int, time_off_minutes int)`; `available_minutes` null when `weekly_minutes` is null
  - `general_space_people_load(p_space uuid, p_from date, p_to date, p_users uuid[] default null) returns table(user_id uuid, project_id uuid, load_minutes int, unestimated int)`; `project_id` null means "other work in this space"; one row per visible (user, project-or-null) with work

Rules both functions share (from the spec's "The numbers" and "Visibility"):
- Available per weekday = `weekly_minutes / 5.0` minus that day's time off (full day = all of it; else `least(minutes, share)`), floored at 0; summed over weekdays in the window; rounded to whole minutes at the end.
- A task counts when: in a live work project of the space, `routing_state = 'released'`, `status <> 'done'`, `archived_at` and `trashed_at` null, the person is in `general_task_assignees`, and it has no live subtasks (a parent with subtasks stops counting).
- Share = `estimated_minutes / holder count`. Span start = `greatest(coalesce(starts_at, sent_at, created_at)::date, today)`; span end = `due_at::date`; overdue or no due date → span is today only. Portion in window = share × `work_weekdays(span ∩ window) / work_weekdays(span)`; if the span has 0 weekdays, the whole share falls on the span's first day and counts when that day is in the window.
- No estimate → `unestimated + 1` when the span touches the window, never minutes.
- Visibility for caller `c`, subject `u`, project `p`: space PM sees all, `p` named; space coordinator sees all `u`, `p` named only when `can_read_general_project(p)`, else folded to null; a pm/coordinator of a live project in the space sees the members of the projects they plan, `p` named only for those projects, the rest folded; anyone sees themselves with `p` named; nobody else. The hours function shows a `u` exactly when the load function would.

- [ ] **Step 1: Write the failing checks** (section "load"). Seed weekly 960 for three developers A, B, C; a window Mon 2026-11-23 to Fri 2026-11-27; released open tasks dated inside the window: A 360 (one task), B 240, C 120; one unestimated task held by C; a task held by A and B with 120 (60 each); a Done task, a planning task and a trashed task held by A (all ignored); time off for A: 2026-11-24, 240 minutes. Checks:
  - `available with time off`: A 720, B 960.
  - `load sums estimates`: A 420, B 300, C 120.
  - `unestimated counted`: C row `unestimated = 1`.
  - `parent with subtasks ignored`: give A's task a released subtask of 60, dated in the window, held by A → A's load becomes 60 + 60 (the shared task) = 120.
  - `weekend window`: window Sat 2026-11-28 to Sun 2026-11-29 → available 0 and no load rows, no error.
  - `time off floors at zero`: full-day time off on every weekday of the window → available 0.
  - `layered`: as plain member B, rows only for B; as the project's pm (not a space planner), rows for A, B, C with this project named and another project's hours under `project_id is null`; as space coordinator not on a Private project, that project's hours folded to null; as space PM, it is named.
- [ ] **Step 2: Run, see `FAIL available with time off`.**
- [ ] **Step 3: Implement** both functions as `security definer`, `stable`, with `p_users` filtering after visibility. Grant execute to `authenticated`.
- [ ] **Step 4: Apply the file and `anon-lockdown.sql`, run the suite → all `PASS`.**
- [ ] **Step 5: Commit** "Compute space load and available hours".

### Task 3: Hours, estimate field and history line (frontend)

**Files:**
- Create: `src/lib/work/hours.ts`, `src/lib/work/hours.test.ts`, `src/lib/api/workload.ts`
- Modify: `src/components/general/TaskDialog.tsx` (the Codex estimate field), `src/lib/api/general.ts` (drop `estimated_minutes` from `TaskPatch`; keep the read with its fallback), `src/lib/general/history.ts` (+ its test if one exists)

**Interfaces:**
- Consumes: `set_work_task_estimate` (Task 1).
- Produces:
  - `formatHours(minutes: number): string` → `"14 h"`, `"1.5 h"`, `"0.3 h"` (one decimal, trailing `.0` dropped)
  - `parseHours(text: string): number | null | 'invalid'` → `"1.5"` → 90, `""` → null, `"0"`/`"-1"`/`"abc"`/`"1001"` → `'invalid'`
  - `setTaskEstimate(taskId: string, minutes: number | null): Promise<void>` in `src/lib/api/workload.ts`

- [ ] **Step 1: Write failing tests.** `hours.test.ts`: the values above. `history.test.ts` (or the existing history test file): an `updated` event with `fields: ['estimated_minutes']`, `estimate_from: null`, `estimate_to: 360` reads `Ana set the estimate to 6 h`; from 360 to 480 reads `Ana changed the estimate from 6 h to 8 h`; to null reads `Ana took the estimate off`.
- [ ] **Step 2: Run** `npx vitest run src/lib/work/hours.test.ts src/lib/general` → fails (module missing / old text).
- [ ] **Step 3: Implement.** In TaskDialog: the field is "Estimated effort (hours)", step 0.25, shown when the viewer is pm/coordinator or holds the task (and the task is on a work project, `estimated_minutes !== undefined`); Save calls `setTaskEstimate` only when the value changed, never through `updateTask`. Read-only viewers see `Estimated effort: 6 h` or `Not set`. Invalid input: "Enter the estimate in hours, up to 1000." (The Suggest estimate button comes in Task 5.)
- [ ] **Step 4: Run** the tests above and `npm run build` → pass.
- [ ] **Step 5: Commit** "Set task estimates in hours".

### Task 4: Weekly hours and time off (frontend)

**Files:**
- Create: `src/components/settings/TimeOffSetting.tsx`, `src/components/settings/TimeOffSetting.test.tsx`
- Modify: `src/pages/general/SpaceMembers.tsx` (+ `SpaceMembers.test.tsx`), `src/pages/Settings.tsx`, `src/lib/api/workload.ts`

**Interfaces:**
- Consumes: `set_space_weekly_minutes`, `user_time_off`, `general_space_people_hours` (Tasks 1–2).
- Produces in `src/lib/api/workload.ts`:
  - `setSpaceWeeklyMinutes(spaceId: string, userId: string, minutes: number | null): Promise<void>`
  - `listMyTimeOff(from: string): Promise<TimeOff[]>`, `saveTimeOff(offOn: string, minutes: number | null): Promise<void>` (upsert on `user_id, off_on`), `deleteTimeOff(id: string): Promise<void>`; `type TimeOff = { id: string; off_on: string; minutes: number | null }`
  - `spacePeopleHours(spaceId: string, from: string, to: string, users?: string[]): Promise<PeopleHours[]>`; `type PeopleHours = { user_id: string; weekly_minutes: number | null; available_minutes: number | null; time_off_minutes: number }`

- [ ] **Step 1: Write failing tests.** `SpaceMembers.test.tsx`: on a work space, a Weekly hours column shows `16 h` or `Not set`; the space PM and coordinators get an editable cell for every row; a member gets one only on their own row; saving calls `setSpaceWeeklyMinutes(space, user, 960)`; a class space shows no column. `TimeOffSetting.test.tsx`: lists upcoming entries ("Tue 24 Nov · 4 h", "Wed 25 Nov · Full day"); adding a full day calls `saveTimeOff('2026-11-25', null)`; adding hours calls `saveTimeOff(date, 240)`; Remove calls `deleteTimeOff`; copy says planners see only the hours, never a reason.
- [ ] **Step 2: Run** `npx vitest run src/pages/general/SpaceMembers.test.tsx src/components/settings/TimeOffSetting.test.tsx` → fail.
- [ ] **Step 3: Implement.** Hours read through `spacePeopleHours` for this week (it returns only rows the viewer may see). Time off goes in Settings next to `ActiveStatusSetting`, for every signed-in person who is in at least one work space.
- [ ] **Step 4: Run** the tests and `npm run build` → pass.
- [ ] **Step 5: Commit** "Set weekly hours and time off".

### Task 5: Allocator, breakdown validation and AI actions

**Files:**
- Modify: `supabase/functions/_shared/workloadPlan.ts`, `src/lib/work/workloadPlan.test.ts` (rewrite), `supabase/functions/work-ai/index.ts`, `src/lib/api/workAi.ts`, `src/components/general/TaskDialog.tsx` (Suggest estimate button)
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql` (breakdown context)

**Interfaces:**
- Produces in `workloadPlan.ts` (shared by the browser and Deno):
  - `type Candidate = { id: string; name: string; tags: string[]; positions: string[]; loadMinutes: number; availableMinutes: number | null }`
  - `type PlanRow = { key: string; title: string; description: string; minutes: number; tags: string[]; position: string | null; dependsOn: string[]; owner: string | null; pinned: boolean }`
  - `type Pick = { key: string; owner: string | null; reason: 'pinned' | 'fit' | 'fit_untagged' | 'no_skill' | 'unknown_hours' | 'no_room'; note: string }`
  - `balanceWorkPlan(rows: PlanRow[], people: Candidate[]): Pick[]` (order and rules from the spec's step 3; `fit_untagged` when nobody in the group has the label; `note` is the copy, e.g. `Only Ana is tagged Auth, and she has 2 h free.`, `No one here is tagged with Auth.`, `Ben has no weekly hours set.`)
  - `projectedTotals(rows: PlanRow[], people: Candidate[]): { id: string; existing: number; added: number; projected: number; available: number | null }[]`
  - `dependencyGroups(rows: { key: string; dependsOn: string[] }[]): string[][]` (kept)
  - `validateBreakdown(raw: unknown, labels: { tags: string[]; positions: string[] }): { rows: PlanRow[] } | { error: string }`: 2–12 rows; minutes 15–4800; unknown tag or position, duplicate key, self link, unknown link and cycle each return an `error` naming the row
- Produces in SQL: `general_breakdown_context(p_parent uuid, p_from date, p_to date) returns jsonb` → `{ parent: {id, project_id, title, description, task_flow, team_id, routing_state, starts_at, due_at, has_subtasks, allow_subtasks, allow_dependencies, holder_ids}, blocked: text|null, positions: [{id, name}], tags: [text], candidates: [{user_id, name, tags, position_ids}] }`. Caller must be pm/coordinator with `general_can_write`; otherwise refuse "Only the project manager or coordinators break down tasks." `blocked` holds the reason the button explains (not released / no receiving team or no active lead in Planned / already has subtasks / subtasks off / Done / class board). Candidates: Planned → the receiving team's members who can hold tasks (same eligibility as `general_handoff_assign_context(p, true)`); Open → project members who can hold tasks; never QA or stakeholders; always space members.
- Produces in `work-ai`: action `breakdown` (`{ parent_id, from, to }` → `{ rows: PlanRow[] }` with owner null, pinned false) and action `estimate` (`{ task_id }` → `{ minutes: number, reason: string }`), limits `hour: 12, day: 50` and `hour: 30, day: 150`.
- Produces in `workAi.ts`: `draftBreakdown(projectId, parentId, from, to)`, `suggestEstimate(projectId, taskId)` returning `Ok<…> | Failed` like the other helpers.

- [ ] **Step 1: Write failing Vitest tests** in `workloadPlan.test.ts`:
  - `defense split`: candidates A (tags `Auth`, load 360, available 960), B (`UI`, 240, 960), C (`Testing`, 120, 960); rows contract 120 Auth, page design 120 UI, test cases 180 Testing, auth 360 Auth (dependsOn contract), interface 480 UI (dependsOn contract), integration 240 Testing (dependsOn auth, interface), e2e 300 Testing (dependsOn integration) → owners A, B, C, A, B, C, C; `projectedTotals` projected 840 for each, available 960.
  - `defense groups`: `dependencyGroups` → `[[contract, page design, test cases], [auth, interface], [integration], [e2e]]`.
  - `bottleneck`: A available 720, load 600 → auth row (placed first, as the larger row) `{ owner: null, reason: 'no_room', note: 'Only A is tagged Auth, and has 2 h free.' }` (the note uses the candidate's `name` and the free hours before the plan); contract still goes to A.
  - `pins kept`: interface pinned to C → C keeps it after rebalance; others recomputed.
  - `nobody tagged`: a row tagged `DevOps` → picked by lowest projected ratio, `reason: 'fit_untagged'`.
  - `unknown hours`: only qualified person has `availableMinutes: null` → `unknown_hours`.
  - `stable ties`: equal ratios → lower id wins, same result on reruns.
  - `validation`: cycle, self link, unknown link, duplicate key, unknown tag, 1 row, 13 rows, 0 minutes → each `{ error }`.
- [ ] **Step 2: Run** `npx vitest run src/lib/work/workloadPlan.test.ts` → fail.
- [ ] **Step 3: Implement** the shared module, then the SQL context function (SQL checks: `context refuses member`, `context blocks unreleased planned parent`, `context candidates exclude QA and stakeholder`, `planned candidates are receiving team only`), then the two `work-ai` actions: each first calls the matching RPC with the caller's client (`general_breakdown_context`; for `estimate`, a read of the task under row security plus the Task 1 rights rule), then `ask()` with a JSON schema, then `validateBreakdown`. Mirror `assignAction`'s anonymised labels (`p1…` positions); the system prompt treats the task text as data and states the window in weekdays. Add the Suggest estimate button in TaskDialog (fills the field, says "Suggested from the title and description. Check it before saving.").
- [ ] **Step 4: Run** Vitest, the SQL suite and `npm run build` → pass. Deploy `work-ai` only in Task 8.
- [ ] **Step 5: Commit** "Recommend owners and draft breakdowns".

### Task 6: Save the approved plan atomically (SQL)

**Files:**
- Modify: `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`

**Interfaces:**
- Consumes: Tasks 1, 2, 5 SQL; `create_general_subtask(p_parent, p_title, p_description, p_due_at)`, `add_general_task_dependency(p_task, p_depends_on)`, the `collabify.work_task_handoff` flag pattern from `send-to-planner.sql`.
- Produces: `apply_work_breakdown(p_parent uuid, p_from date, p_to date, p_rows jsonb) returns uuid[]` (new subtask ids in row order). Each row: `{ key, title, description, minutes, owner: uuid|null, depends_on: [key], starts_on: date, due_on: date, shown_load_minutes: int|null }`.

Behaviour (spec step 5): lock the parent `for update`; recheck caller, parent state and `blocked` exactly as `general_breakdown_context`; every owner is in the current candidate list; every owner's current load (Task 2 function, window `p_from`–`p_to`) is not above `shown_load_minutes`; rows validated as in `validateBreakdown` (count, minutes, keys, links, no cycles); then create each subtask, set `starts_at`/`due_at` (Manila start and end of day) and the estimate under `collabify.estimate_write`, add the owner under `collabify.work_task_handoff`, add links through `add_general_task_dependency`. Any failure raises, so nothing stays. Messages:
- load rose: `Ben's work changed since you reviewed it. Review again.`
- owner not eligible: `Ben can no longer take tasks from this team. Review again.`
- already split: `This task already has subtasks. Reload it to see them.`
- generic state change: `The task changed since you reviewed it. Review again.`

- [ ] **Step 1: Write failing checks:** `apply creates all` (7 rows from the defense fixture → 7 subtasks, 7 holders, 5 links, estimates and dates set, parent holders, team and routing unchanged); `open flow apply`; `planned flow apply assigns directly`; `member refused`; `owner left team` (remove an owner from the team after building the payload → refused, `count(*)` of the parent's subtasks = 0); `load rose refused`; `bad link rolls back` (last row links to an unknown key → 0 subtasks); `subtasks off refused`; `second apply refused` (apply twice → second raises `already has subtasks`, still 7).
- [ ] **Step 2: Run, see `FAIL apply creates all`.**
- [ ] **Step 3: Implement.** Grant execute to `authenticated`.
- [ ] **Step 4: Apply the file and `anon-lockdown.sql`; run this suite plus `project-task-rules`, `work-task-handoff`, `project-open-tasks`, `project-qa` and `anon-lockdown` suites → all `PASS`.**
- [ ] **Step 5: Commit** "Save an approved breakdown in one step".

### Task 7: Break down and balance dialog

**Files:**
- Create: `src/components/general/WorkloadPlanDialog.tsx`, `src/components/general/WorkloadPlanDialog.test.tsx`
- Modify: `src/components/general/TaskDialog.tsx` (entry button), `src/lib/api/workload.ts`

**Interfaces:**
- Consumes: `balanceWorkPlan`, `projectedTotals`, `dependencyGroups` (Task 5), `draftBreakdown` (Task 5), `spacePeopleHours` (Task 4), and new clients in `workload.ts`:
  - `breakdownContext(parentId: string, from: string, to: string): Promise<BreakdownContext>` (shape of `general_breakdown_context`)
  - `spacePeopleLoad(spaceId: string, from: string, to: string, users?: string[]): Promise<PeopleLoad[]>`
  - `applyBreakdown(parentId: string, from: string, to: string, rows: ApplyRow[]): Promise<string[]>`
- Produces: `<WorkloadPlanDialog parentId projectId spaceId onClose onSaved />`.

Screens follow the spec's sketch: window and people (parent holders preselected), then the grouped rows ("Can start now", "After …"), per-person bars (existing + added = projected / available, `success` < 80%, `warning` 80–100%, `danger` over, `pending` unknown), the count of tasks without an estimate, Rebalance, Cancel, "Create and assign N subtasks". Editing an owner pins it; editing minutes, tags, links or removing a row recomputes at once; a removed row's key is removed from every `dependsOn`. On a refused save the edits stay and the message shows with "Review again", which reloads context and loads and reruns balancing with pins kept.

- [ ] **Step 1: Write failing tests:** `no writes before Create` (open, draft, edit, Rebalance → `applyBreakdown` not called); `shows the defense totals` (mocked context and AI → three bars `14 / 16 h`); `bottleneck row explains` (shows `Only A is tagged Auth, and has 2 h free.` and no owner); `pinned owner survives Rebalance`; `removing a prerequisite clears links`; `stale save keeps edits` (apply rejects with the load-rose message → message shown, rows unchanged); `button disabled while saving`; `entry hidden for members`, `entry explains blocked parent` (Planned, unreleased → "Send it to a team in Plan & route first.").
- [ ] **Step 2: Run** `npx vitest run src/components/general/WorkloadPlanDialog.test.tsx src/components/general/TaskDialog.test.tsx` → fail.
- [ ] **Step 3: Implement.** Desktop: rows left, people bars right; tablet and phone: bars above the rows. Tokens only.
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Break down and balance a task".

### Task 8: Apply live, demo walk and notes

**Files:**
- Modify: `handoff.md` (new section at the end), `CLAUDE.md` (one bullet under Project roles for `work-workload.sql`: what it owns, its place before `anon-lockdown.sql`, its suite)

- [ ] **Step 1: Apply and test live.** `node scripts/db.mjs supabase/work-workload.sql supabase/anon-lockdown.sql`, then the suites from Task 6 Step 4 → all `PASS`; `node scripts/schema-drift.mjs` reports no drift.
- [ ] **Step 2: Deploy `work-ai`** with the frontend build (`supabase functions deploy work-ai`).
- [ ] **Step 3: Demo walk on the dev server** (desktop and 375 px phone) with a demo work space: three developer test accounts at 16 h, existing loads 6 / 4 / 2 h in the window, skill tags Auth / UI / Testing, a released task "Develop Login Module" they hold. Break down and balance → seven rows, groups as in the spec, three bars `14 / 16 h`; Create → subtasks, holders, links, history; parent untouched. Bottleneck: A takes 4 h off and holds 10 h → the 6 h row stays unassigned with its note. Stale: change B's load in another tab before Create → refused, nothing saved. Repeat in an Open project.
- [ ] **Step 4: Write `handoff.md` and the `CLAUDE.md` bullet**, then `npm run build` once more.
- [ ] **Step 5: Commit** "Note workload phase 1", then ask the user before merging to `main` and pushing.
