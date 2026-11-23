# Leave-aware workload, phase 1 (leave and impact) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person or a space planner records leave as a date range; each affected project's manager and coordinators are told which open tasks it puts at risk, review them, and move due dates, reassign or swap in temporary cover that is handed back when the leave ends.

**Architecture:** A new `supabase/work-leave.sql` (after `work-workload.sql`, before `anon-lockdown.sql`) keeps away days as `user_time_off` rows, adds `added_by`, derives a leave as a run of consecutive weekday rows, and refreshes a per-project notice table from a statement trigger on `user_time_off`. Cover is a small table plus RPCs that change holders through the existing paths. The frontend adds a date range to Time off, Mark away on the Workload tab, a Leave review dialog on the project, and a cover box in the task dialog.

**Tech Stack:** React + TypeScript (Vite), Supabase PostgreSQL (RLS, pg_cron), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-leave-aware-workload-design.md` — phase 1 = "Leave and impact". Phase 2 (AI suggestions, badges, forecast, sprint hours) is not in this plan.

## Global Constraints

- Work spaces and work projects only. Away days are per person and count in every space.
- Dates are Asia/Manila. A leave is a run of away weekdays with no away-free weekday between them; a weekend does not split it. Part days count as away days. "End" is the run's last away weekday.
- Never store, ask for or show a reason. Planners still see hours only through the phase 1–3 reads; away dates are visible to anyone sharing a live work space with the person (spec decision 6).
- The person may add, edit or remove any of their own rows. A planner (space `pm`/`coordinator` of any live work space the person is in) may add rows and remove rows a planner added (`added_by is not null`), never the person's own rows.
- Impact statuses, in order: `blocks`, `due_during`, `wont_fit`, `fine`. Remaining = max(0, estimate − all logged minutes) ÷ holder count. Fit uses `work_person_available` minus `work_person_load` (skipping the task) from today to the due day. No due date → never `due_during`/`wont_fit`. Past due with remaining > 0 → `wont_fit`.
- One notice per person, project and leave; re-sent only when the flagged task set changes and is not empty. Recipients: the project's `pm` and `coordinator` members, not the away person, with `notification_prefs.leave_and_cover`.
- Cover changes holders through existing paths with no bypass on start; at most one open cover per task.
- No existing guard, policy or function redefined; history uses kind `updated` (no new kinds). Copy rules and tokens from `CLAUDE.md`.
- Fetch `origin/main` before deploying or merging; ask the user before pushing `main`.

## Review Focus

- Sudden leave recorded on a day already under way: today counts as away, the check runs, cover lasts to the last day (Task 2 `leave already started`).
- A planner in space A records leave for someone also in space B: B's project manager gets the notice and can open the review (Task 2 `other space notified`).
- A leave removed or shortened after cover started: the hand-back reminder still comes (cover keeps its `until` or moves earlier), never lost (Task 3 `cancelled leave reminds hand back`).
- Extending a leave twice: one "ends today" reminder per last day, no repeat notice when the flagged set is unchanged (Task 2 `extend without change sends nothing`, Task 3 `one reminder per last day`).
- A covered task finished or reassigned by someone else: the cover closes silently, no reminder (Task 3 `done closes cover`).

---

### Task 1: Recording leave (SQL)

**Files:** Create `supabase/work-leave.sql`, `supabase/tests/work-leave.test.sql`; modify `docs/07-backup.md` (new "Leave and cover" section, file in both order lists before `anon-lockdown.sql`), `scripts/schema-drift.mjs` (after `work-workload`).

**Interfaces — Produces:**
- `user_time_off.added_by uuid references profiles on delete set null` (null = the person). BEFORE INSERT trigger `user_time_off_added_by`: `added_by := case when auth.uid() is distinct from new.user_id then auth.uid() end`.
- `work_can_mark_away(p_user uuid) returns boolean` (definer, internal): caller is `p_user`, or caller is `pm`/`coordinator` in `general_space_members` of a live work space (`kind = 'work'`, not archived, not a class space) where `p_user` is a member.
- `save_time_off_range(p_user uuid, p_from date, p_to date, p_minutes int default null) returns int` (definer, granted): refuses "You can't mark this person away." when not allowed; "Choose a start date on or before the end date." when `p_to < p_from`; "Choose 60 days or fewer." when more than 60 weekdays; `p_minutes` 1–1440 or null (whole day). Upserts one row per weekday in one statement (`on conflict (user_id, off_on) do update set minutes, added_by`), returns rows written.
- `remove_time_off_range(p_user uuid, p_from date, p_to date) returns int` (definer, granted): same permission; a planner deletes only rows with `added_by is not null`; the person deletes any; one statement; returns rows deleted.
- `work_leave_runs(p_user uuid, p_from date) returns table(first_day date, last_day date, part_day boolean)` (definer, internal): runs of the person's rows with `last_day >= p_from`; consecutive when `work_weekdays(prev + 1, cur - 1) = 0`; `part_day` true when any day has minutes.
- `space_away_ranges(p_space uuid) returns table(user_id uuid, first_day date, last_day date, part_day boolean, added_by uuid)` (definer, granted): runs ending on or after Manila today for members of the space; only for a caller who is a member of that live work space; `added_by` is the planner on the run's rows if any (else null).

- [ ] **Step 1: Write failing checks** (fixture: space PM, coordinator, two members Ann and Bo, a second space B with Ann and its own PM; one live project per space): `person saves own range` (Mon–Fri 5 rows, `added_by` null, weekend skipped for a Fri–Mon range → 2 rows); `planner saves range` (coordinator → rows with `added_by` = coordinator); `planner from other space` (B's PM may mark Ann); `member refused` (Bo marks Ann → "You can't mark this person away."); `bad range refused`; `planner removes only planner rows` (Ann adds Wed herself, coordinator adds Mon–Fri, coordinator removes Mon–Fri → only Wed left); `runs join over weekend` (Thu, Fri, Mon → one run Thu–Mon); `runs split by a weekday` (Mon, Wed → two runs); `away ranges readable in space` (Bo reads Ann's run in space A; someone outside the space gets no rows); `own rows policy unchanged` (Bo selects `user_time_off` → 0 rows of Ann's).
- [ ] **Step 2: Run** `node scripts/db.mjs supabase/tests/work-leave.test.sql` → fails (function missing).
- [ ] **Step 3: Implement** in `supabase/work-leave.sql` (`begin; … commit;`, idempotent).
- [ ] **Step 4: Apply** `node scripts/db.mjs supabase/work-leave.sql supabase/anon-lockdown.sql`; run this suite, `work-workload` and `anon-lockdown` → all `PASS`.
- [ ] **Step 5: Commit** "Record leave as a date range".

### Task 2: Impact check and leave notices (SQL)

**Files:** Modify `supabase/work-leave.sql`, `supabase/tests/work-leave.test.sql`, `docs/07-backup.md`.

**Interfaces:**
- Consumes: Task 1 runs; phase 1–2 `work_person_available(space, user, from, to)`, `work_person_load(space, user, from, to, skip_task)`, `general_task_dependencies (task_id waits for depends_on_id)`.
- Produces:
  - Enum values (own `begin; do $$ … $$; commit;` block at the top, like `project-notification-rules.sql`): `leave_impact`, `leave_ending`, `cover_hand_back`.
  - `notification_prefs.leave_and_cover boolean not null default true`.
  - `work_leave_task_status(p_user uuid, p_first date, p_last date) returns table(task_id uuid, project_id uuid, status text, remaining_minutes int, short_minutes int, due_on date, no_estimate boolean)` (definer, internal): open (`status <> 'done'`), released, live tasks the person holds in live work projects; rules from Global Constraints; `short_minutes` = remaining − fit hours when `wont_fit`, else 0; `due_on` = Manila date of `due_at`.
  - Table `general_leave_notices(id uuid pk, user_id, project_id, first_day, last_day, flagged uuid[] not null default '{}', notified_at timestamptz, ended_reminded_on date, unique (user_id, project_id, first_day))`, RLS on, select policy: caller is `pm`/`coordinator` of the project; no write grant.
  - `work_leave_refresh(p_user uuid) returns void` (definer, internal): for each run from Manila today and each live work project with tasks from `work_leave_task_status`, update the overlapping notice row's dates or insert one; when the flagged set (non-`fine`) differs from the stored one and is non-empty, store it and insert one `leave_impact` notification per recipient (title `"<First Last> is away <label>"`, preview `"<n> task(s) in <project> need a look."`, `general_project_id` set); delete rows with `last_day >= today` that no run overlaps. `<label>`: `work_leave_label(first, last)` → "26–28 Nov", "30 Nov – 2 Dec", "26 Nov".
  - Statement trigger `user_time_off_leave_refresh` AFTER INSERT/UPDATE/DELETE on `user_time_off` with transition tables, calling `work_leave_refresh` once per distinct `user_id`.
  - `general_project_leaves(p_project uuid) returns table(notice_id uuid, user_id uuid, first_day date, last_day date, added_by uuid, tasks jsonb)` (definer, granted): project `pm`/`coordinator` only ("Only the project manager and coordinators can review leave."); rows with `last_day >= today`; `tasks` = live recomputation for this project: `[{task_id, title, status, remaining_minutes, short_minutes, due_on, no_estimate, blocks: [titles]}]`, flagged first.
- [ ] **Step 1: Write failing checks:** `due during leave flagged`; `wont fit flagged` (estimate 960, 0 logged, due in 2 days, 16 h weekly → short > 0); `blocks flagged` (another open task depends on it); `no due date fine` (and `no_estimate` true when no estimate); `done task left out`; `notice once` (one `leave_impact` per PM and coordinator, none to the away person, none when the pref is off); `extend without change sends nothing` (extend by one day with the same flagged set → no new notice, row dates updated); `extend with change notifies`; `leave removed clears row`; `leave already started` (range from today → today counts, row first_day = today); `other space notified` (B's PM gets a notice for Ann's task in B's project); `review planners only` (member refused with the message); `review lists flagged first`.
- [ ] **Step 2: Run** the suite → fails.
- [ ] **Step 3: Implement.** Keep status rules in `work_leave_task_status` only; the review and the refresh both read it.
- [ ] **Step 4: Apply** with `anon-lockdown.sql`; run `work-leave`, `work-workload`, `project-notification-rules`, `anon-lockdown` suites → `PASS`.
- [ ] **Step 5: Commit** "Check and announce leave impact".

### Task 3: Cover and reminders (SQL)

**Files:** Modify `supabase/work-leave.sql`, `supabase/tests/work-leave.test.sql`, `docs/07-backup.md`.

**Interfaces:**
- Consumes: Task 2 `work_leave_runs`, notices; `set_general_task_holders(p_task, p_holders)` (Open flow); direct `general_task_assignees` writes (Planned flow, under the caller's RLS and guards).
- Produces:
  - Table `general_task_covers(id uuid pk, task_id, project_id, away_id, cover_id, until date not null, created_by, created_at, reminded_on date, closed_at timestamptz, closed_how text check in ('handed_back','kept','dropped'))`, FK `(task_id, project_id)` → tasks on delete cascade; unique partial index on `task_id` where `closed_at is null`; RLS select `can_read_general_project(project_id)`; no write grant.
  - `start_work_cover(p_task uuid, p_away uuid, p_cover uuid) returns uuid` — **security invoker**, granted: caller must be the project's `pm`/`coordinator` ("Only the project manager and coordinators can arrange cover."); `p_away` holds the task and `p_cover` does not; `until` = last day of `p_away`'s run that contains or follows today, else refuse "<Name> has no leave coming up."; holder swap: Open flow → `set_general_task_holders(task, holders − away + cover)`; Planned → delete away's row, insert cover's row (existing refusals surface unchanged); then `work_cover_record(...)` (definer, granted, re-checks caller, holders and no open cover) inserts the row and one `general_task_events` row (`kind 'updated'`, `detail {fields:['cover'], cover:'started', away_id, cover_id, until}`). Returns the cover id.
  - `hand_back_work_cover(p_cover uuid) returns void` (definer, granted): caller is the cover or the project's `pm`/`coordinator`; refuses "Reopen it before changing who holds it." when the task is Done or at/after an active QA stage; refuses "<Name> can't hold this task now." when the away person is no longer an active non-QA, non-stakeholder member; swaps cover → away with claims cleared (the Open writers' pattern), closes `handed_back`, history `cover:'handed_back'`.
  - `keep_work_cover(p_cover uuid) returns void` (definer, granted): same callers; closes `kept`, history `cover:'kept'`.
  - `send_leave_reminders() returns void` (internal) and cron `collabify-leave-reminders` at `'0 0 * * *'` (08:00 Manila): (1) close open covers silently (`dropped`) whose task is done, archived, trashed, or no longer held by the cover; (2) for open covers with `until < today` and `reminded_on is null`: one `cover_hand_back` notification each to the cover and the project's `pm` (title `"<Away> is back"`, preview `"Hand <task> back, or keep it with <Cover>."`, `general_task_id` set), set `reminded_on`; (3) for notice rows with `last_day = today`, `notified_at is not null` and `ended_reminded_on is distinct from last_day`: one `leave_ending` to the project's `pm` (title `"<Name>'s leave ends today"`, preview `"Extend it or confirm they're back."`, `general_space_id` set), set `ended_reminded_on`.
  - `work_leave_refresh` also moves `until` of the person's open covers to the new last day of the run that overlaps the old `until`, clearing `reminded_on` when it moves later; a vanished run leaves `until` as is.
- [ ] **Step 1: Write failing checks:** `cover swaps holders` (planned project: away off, cover on, row open, history row); `cover in open flow`; `member cannot cover`; `no leave refused`; `one open cover per task`; `hand back restores` (by the cover; away back on, cover off, closed `handed_back`); `keep closes`; `hand back refused in QA`; `reminder after leave` (until = yesterday → one notice each to cover and PM, second run sends none); `cancelled leave reminds hand back` (remove all days → until unchanged, reminder still fires after it); `extended leave moves until` (extend → until later, `reminded_on` cleared); `done closes cover` (task done → `dropped`, no notice); `one reminder per last day` (run twice on the last day → one `leave_ending`; extend → a new last day reminds again).
- [ ] **Step 2: Run** the suite → fails.
- [ ] **Step 3: Implement**; tests call `send_leave_reminders()` as service and set `until`/rows directly as service for past dates.
- [ ] **Step 4: Apply** with `anon-lockdown.sql`; run `work-leave`, `project-open-tasks`, `work-task-handoff`, `anon-lockdown` → `PASS`.
- [ ] **Step 5: Commit** "Cover tasks during leave and remind to hand back".

### Task 4: Recording leave in the app

**Files:** Modify `src/lib/api/workload.ts`, `src/components/settings/TimeOffSetting.tsx`, `src/pages/general/SpaceWorkload.tsx`, `src/pages/Settings.tsx` (preference row), `src/context/AuthProvider.tsx` (pref type, if typed there), `src/components/app/notificationDestination.ts` (+ test); create `src/components/general/MarkAwayDialog.tsx` (+ test).

**Interfaces:**
- Produces in `workload.ts`: `saveTimeOffRange(userId, from, to, minutes: number | null): Promise<number>`, `removeTimeOffRange(userId, from, to): Promise<number>`, `spaceAwayRanges(spaceId): Promise<AwayRange[]>` with `AwayRange = { user_id; first_day; last_day; part_day; added_by: string | null }`; `TimeOff` gains `added_by` and `added_by_name: string | null` (select `added_by, adder:profiles!user_time_off_added_by_fkey(first_name,last_name)`).
- Time off (Settings): a "To" date beside the date (optional; empty = one day) saving through `saveTimeOffRange(me, from, to ?? from, minutes)`; rows a planner added show "Added by <name>".
- Workload tab: each person row shows "Away 26–28 Nov" (from `spaceAwayRanges`) for everyone; the space's `pm`/`coordinator` see "Mark away" in the expanded row, opening `<MarkAwayDialog spaceId user name existing onSaved />` (From, To with "Best guess is fine. You can extend it.", Whole days / Hours a day); planner-added ranges list "Remove" → `removeTimeOffRange`. `?away=<userId>` opens the dialog for that person with the current run filled in.
- Settings notifications: row `leave_and_cover` "Leave and cover" — "When someone on your projects is away and their tasks need a look, when their leave ends, and when it is time to hand covered work back." (shown to members).
- Destinations: `leave_impact` → `${paths.project(p)}?leave=open`; `cover_hand_back` → `${paths.project(p)}?task=<t>`; `leave_ending` → `${paths.spaceWorkload(space)}` (no user id in the notice; the dialog opens from the row).
- [ ] **Step 1: Write failing tests:** `range saves through RPC` (Time off with From 2026-11-26, To 2026-11-28, whole days → `saveTimeOffRange('me','2026-11-26','2026-11-28',null)`); `added by shown`; `mark away planner only` (member sees no Mark away); `mark away saves` (→ `saveTimeOffRange('ivan', from, to, null)`, then reload); `away range shown on row`; `planner removes planner range`; `away param opens dialog`; destination tests for the three kinds.
- [ ] **Step 2: Run** `npx vitest run src/components/general/MarkAwayDialog.test.tsx src/pages/general/SpaceWorkload.test.tsx src/components/settings src/components/app` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Mark people away from Settings and the Workload tab".

### Task 5: Leave review on the project

**Files:** Create `src/components/general/LeaveReview.tsx` (+ test); modify `src/lib/api/workload.ts`, the project page that reads `?task=` (open on `?leave=open`), the Work tab banner (`src/components/general/WorkTab.tsx` or the Overview it renders).

**Interfaces:**
- Consumes: Task 2 `general_project_leaves`, Task 3 `start_work_cover`; existing `updateTask(taskId, { due_at })`, `setTaskHolders` (Open), `assignTask`/`unassignTask` (Planned), `useHolderHours` labels for pickers.
- Produces: `projectLeaves(projectId): Promise<ProjectLeave[]>` and `startCover(taskId, awayId, coverId): Promise<string>` in `workload.ts`; `<LeaveReview state onClose />`: one section per leave ("Ivan Cruz is away Wed 26 – Fri 28 Nov", "Added by <name>" when a planner added it), each task with title, "Due 26 Nov · 6 h left", a status chip (`Due during leave` warning, `Won't fit · 5 h short` danger, `Blocks <title>` warning, `Fine` muted, `No estimate` pending), and actions: Move due date (date input → `updateTask`), Reassign (picker → holder swap), Cover (picker → `startCover`, label "Cover until Fri 28 Nov"), Skip (local). Each action reloads the list; refusals show their message on that row.
- Banner for `pm`/`coordinator` on the project's Work tab when any leave has flagged tasks: "<Name> is away 26–28 Nov · 3 tasks need a look" + "Review".
- [ ] **Step 1: Write failing tests:** `lists flagged tasks first`; `move due date saves`; `cover calls startCover`; `reassign in open flow uses setTaskHolders`; `reassign in planned flow unassigns and assigns`; `refusal shows on the row`; `banner for planners only`; `leave param opens review`.
- [ ] **Step 2: Run** `npx vitest run src/components/general/LeaveReview.test.tsx` (+ the banner's test file) → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Review a leave's tasks on the project".

### Task 6: Cover in the task dialog, cards and history

**Files:** Modify `src/components/general/TaskDialog.tsx`, `src/components/general/TasksTab.tsx` (card marker), the history describer (`describeHistory`'s file), `src/lib/api/workload.ts`; tests.

**Interfaces:**
- Consumes: Task 3 `general_task_covers` (select), `hand_back_work_cover`, `keep_work_cover`.
- Produces: `taskCover(taskId): Promise<TaskCover | null>`, `handBackCover(coverId)`, `keepCover(coverId)` in `workload.ts`. In the task dialog on an open cover: "Covering for <Away> until Fri 28 Nov", and for the cover or a planner "Hand back to <Away>" and "Keep with <Cover>". Board cards with an open cover show a small "Cover" marker (one read for the board: covers by project through RLS). History lines: "<Actor> asked <Cover> to cover for <Away> until Fri 28 Nov", "<Actor> handed it back to <Away>", "<Actor> kept it with <Cover>".
- [ ] **Step 1: Write failing tests:** `cover box shown`; `hand back calls RPC and reloads`; `keep calls RPC`; `buttons hidden for others`; `card shows cover marker`; `history describes cover`.
- [ ] **Step 2: Run** the affected test files → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Show and hand back cover on tasks".

### Task 7: Live checks, walk and notes

- [ ] **Step 1:** `git fetch origin`, merge if it moved. Apply `supabase/work-leave.sql` then `supabase/anon-lockdown.sql`; run `work-leave`, `work-workload`, `project-open-tasks`, `work-task-handoff`, `project-notification-rules`, `anon-lockdown`; full `npx vitest run`; `npm run build`.
- [ ] **Step 2 (browser, as the Capstone 2 project manager):** Mark Wilson away on a throwaway range over the Login Module's dates from the Workload tab; see the Inbox notice, open the review, cover one task with Keneth and see "Covering for Wilson"; hand it back; remove the range. Desktop and 375 px. Restore the demo data exactly (Wilson's own 24–25 Nov rows stay).
- [ ] **Step 3:** `handoff.md` section, `CLAUDE.md` bullet "Leave and cover (`supabase/work-leave.sql` …)", `npm run build`, commit "Note leave-aware workload phase 1"; ask the user before merging and pushing.
