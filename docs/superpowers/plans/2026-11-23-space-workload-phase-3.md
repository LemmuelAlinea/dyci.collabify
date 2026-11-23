# Space workload balancing, phase 3 (daily) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People time their work on a task with Start and Stop, every task shows estimated against spent, people see how their estimates usually turn out, and Home shows each person's own load with quick ways to set hours and time off.

**Architecture:** `supabase/work-workload.sql` gains a one-row-per-person timer table written only through three RPCs that log into the existing `general_task_logs`, and one estimate-accuracy read that reuses the workload visibility rules. The frontend adds a timer and an estimated-against-spent line to the task dialog, a small line on board cards, and a `MyLoadCard` on the work Home (`WorkOverview`).

**Tech Stack:** React + TypeScript (Vite), Supabase PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-space-workload-balancing-design.md` — phase 3 = "Daily": sections "Task timer" and "My load on Home". Phases 1–2 shipped (`handoff.md`).

## Global Constraints

- Work projects and work spaces only.
- Minutes stored; hours shown with at most one decimal; spent time with `formatMinutes` ("7 h 20 m"). Dates are Asia/Manila; a timer's log is dated by the day it started.
- One running timer per person. Only someone who may log time on the task today may time it: its holder who passes `general_can_write` (the `general_task_logs_insert` policy's rule).
- A stopped timer writes one `general_task_logs` row (1–1440 minutes, note `''`). Logs stay deletable as today; nothing new edits them.
- Past 8 hours a timer is not logged as is: Stop asks the person to confirm or correct the time (default 8 h); starting another task logs the old one capped at 8 h.
- Estimate accuracy shows only after at least 5 Done tasks with both an estimate and the person's own logged time, only to the person and to those who may see their workload (`work_workload_people`), and never as a ranking or a list sorted by it.
- No existing guard, policy or function is redefined. Tokens and copy rules from `CLAUDE.md`.
- Fetch `origin/main` before deploying or merging; ask the user before pushing `main`.

## Review Focus

- A timer left running over a weekend or a week: Stop asks to confirm, offering 8 h, never logs 60 h (Task 1 `stop past 8 hours asks`; Task 2 `confirm long timer`).
- The holder is taken off the task while their timer runs: Stop refuses to log ("You no longer hold this task.") and the timer is cleared so it can't block the next start (Task 1 `stop after losing the task`).
- Two tabs: Start in one, Stop in the other, Stop again in the first: the second Stop says nothing is running and logs nothing (Task 1 `second stop logs nothing`; Task 2 shows the server state after a refusal).
- Spent passes the estimate: the dialog line turns warning; with no estimate it shows only spent (Task 2 `spent over estimate warns`, `no estimate shows spent only`).
- A person in no work space, or with no weekly hours: Home shows no card, or the card says "Not set" with a way to set it, never 0 / 0 h (Task 3 `no hours set card`).

---

### Task 1: Timer and estimate accuracy (SQL)

**Files:** Modify `supabase/work-workload.sql`, `supabase/tests/work-workload.test.sql`, `docs/07-backup.md` (Space workload section)

**Interfaces — Produces:**
- table `general_task_timers(user_id uuid primary key references profiles on delete cascade, task_id uuid not null, project_id uuid not null, started_at timestamptz not null default now())`, FK `(task_id, project_id)` → `general_tasks (id, project_id)` on delete cascade; RLS on, one policy: a person selects their own row; no write policies.
- `start_work_task_timer(p_task uuid) returns timestamptz` — work project, live task (`archived_at`, `trashed_at` null, project live), caller holds it and passes `general_can_write`; else "Only the task's holder can time it." If the caller's timer already runs on this task, returns its `started_at`. If it runs on another task, logs that one (capped at 480 minutes, at least 1) when the caller still may log there, then replaces it.
- `stop_work_task_timer(p_minutes int default null) returns int` (minutes logged) — no row: "No timer is running." Elapsed = whole minutes since `started_at`, at least 1. Elapsed > 480 and `p_minutes` null: raise "This timer ran past 8 hours. Confirm the time you worked." (keeps the row). `p_minutes` must be 1–1440. Caller no longer may log on the task: delete the row and raise "You no longer hold this task." Otherwise insert the log (`logged_on` = Manila date of `started_at`), delete the row, return the minutes.
- `cancel_work_task_timer() returns void` — deletes the caller's row, logs nothing.
- `general_space_estimate_accuracy(p_space uuid, p_users uuid[] default null) returns table(user_id uuid, ratio numeric, tasks int)` — for each person the caller may see (`work_workload_people`), over Done, live tasks in the space's live work projects that the person holds, with an estimate and with logs by that person: `ratio = sum(person's logged minutes) / sum(estimate ÷ holders)`, rounded to one decimal; a row only when `tasks >= 5`.
- All four functions granted to `authenticated`.

- [ ] **Step 1: Write failing checks** (section "phase 3"): `start and stop logs` (start, move `started_at` back 90 minutes as service, stop → returns 90, one log of 90 dated the start day, no timer row); `one timer per person` (start on A, start on B with A's start 30 minutes ago → A logged 30, row now B); `start again same task keeps start`; `non-holder refused`; `stop past 8 hours asks` (started 10 hours ago → refuse with "This timer ran past 8 hours.", row kept; then `stop(480)` logs 480); `switch caps at 8 hours` (A started 10 hours ago, start B → A logged 480); `stop after losing the task` (holder removed as service → refuse "You no longer hold this task.", row gone); `second stop logs nothing` (stop twice → second refuses "No timer is running."); `cancel logs nothing`; `timer row own only` (another member selects 0 rows); `accuracy needs five` (4 Done tasks → no row; 5 → ratio 1.2 for logs 6×1.2); `accuracy shared estimate` (a 2-holder task counts half its estimate); `accuracy hidden from others` (a plain member asking about someone else gets no row).
- [ ] **Step 2: Run, see the first check fail.** `node scripts/db.mjs supabase/tests/work-workload.test.sql`
- [ ] **Step 3: Implement.** Insert the log as the caller would (security definer, explicit checks that mirror `general_task_logs_insert`); read `general-tasks.sql`'s `general_task_logs_guard` first so the insert passes it.
- [ ] **Step 4: Apply the file and `anon-lockdown.sql`; run this suite, `anon-lockdown` and `work-task-handoff` → all `PASS`.**
- [ ] **Step 5: Commit** "Time task work and read estimate accuracy".

### Task 2: Timer and estimated against spent in the task dialog and on cards

**Files:** Create `src/components/general/TaskTimer.tsx` (+ test); modify `src/lib/api/workload.ts`, `src/components/general/TaskDialog.tsx` (Time logged area), `src/components/general/TasksTab.tsx` (board card), tests

**Interfaces:**
- Consumes: Task 1 RPCs; `formatMinutes` (`src/lib/types.ts`), `formatHours`.
- Produces in `workload.ts`: `myTimer(): Promise<{ task_id: string; project_id: string; started_at: string } | null>` (select own row), `startTimer(taskId)`, `stopTimer(minutes?: number): Promise<number>`, `cancelTimer()`; `isLongTimerError(err): boolean` (message starts "This timer ran past 8 hours").
- `<TaskTimer task state onLogged />`: shown on work tasks to their holders who may log (not read-only, not archived). Idle: "Start timer". Running here: elapsed as `h:mm` ticking each minute, "Stop" and "Discard". Running on another task: "Timer running on <title>" and "Start here" (switches). Stop past 8 h opens a small confirm with an hours field prefilled "8" and "Log it". Refusals show their message and reload the timer state.
- Estimated against spent: in the dialog, `Est. 6 h · Spent 7 h 20 m` (warning tokens when spent > estimate), `Spent 7 h 20 m` when no estimate; on board cards the same text in small mono only when the task has an estimate.
- [ ] **Step 1: Write failing tests** (`TaskTimer.test.tsx`, TaskDialog and card tests): `start shows running time`; `stop logs and calls onLogged`; `confirm long timer` (stopTimer rejects with the 8-hour message → confirm with "8" → `stopTimer(480)`); `switch from another task`; `discard`; `hidden for non-holders`; `spent over estimate warns`; `no estimate shows spent only`; `card shows est and spent`.
- [ ] **Step 2: Run** `npx vitest run src/components/general` → fail.
- [ ] **Step 3: Implement.** Use one interval per mounted timer (clear on unmount); respect reduced motion (no animated digits).
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Time work from the task dialog".

### Task 3: My load on Home, and accuracy where workload is read

**Files:** Create `src/components/general/MyLoadCard.tsx` (+ test); modify `src/components/general/WorkOverview.tsx`, `src/components/settings/TimeOffSetting.tsx` (`id="time-off"`), `src/pages/general/SpaceWorkload.tsx` (accuracy in the expanded row), `src/lib/api/workload.ts`, tests

**Interfaces:**
- Consumes: `spacePeopleLoad`, `spacePeopleHours`, `setSpaceWeeklyMinutes`, `myTimer`, `parseWeeklyHours`, `workWeek`; Task 1 accuracy.
- Produces: `estimateAccuracy(spaceId, users?)` in `workload.ts`; `<MyLoadCard />` on `WorkOverview` for a person in at least one work space: one block per work space with this week's `load / available` bar (phase-2 tones), the next three weeks as small bars, "N open tasks have no estimate" (from `unestimated`), a weekly-hours field when not set ("Set weekly hours", saves through `setSpaceWeeklyMinutes`), a link "Add time off" to `/settings#time-off`, the running timer if any ("Timer running on <title>", a link to the task), and the accuracy line "Your tasks usually take about 1.2× the estimate." when there is a row.
- In `SpaceWorkload`'s expanded row: "Usually takes about 1.2× the estimate." when the accuracy read returns a row for that person.
- [ ] **Step 1: Write failing tests:** `card per work space`; `no hours set card` ("Not set", a field, saving calls `setSpaceWeeklyMinutes(space, me, 960)`); `four weeks of bars`; `accuracy line shown`, `no accuracy below five` (no row → no line); `running timer link`; `no card without a work space`; Workload tab `expanded row shows accuracy`.
- [ ] **Step 2: Run** `npx vitest run src/components/general/MyLoadCard.test.tsx src/pages/general/SpaceWorkload.test.tsx` → fail.
- [ ] **Step 3: Implement.** One read per space per Home visit.
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Show my load on Home".

### Task 4: Live checks, walk and notes

- [ ] **Step 1:** `git fetch origin`, merge if it moved. Apply `supabase/work-workload.sql` then `supabase/anon-lockdown.sql`; run `work-workload`, `anon-lockdown`, `work-task-handoff` suites; full `npx vitest run`; `npm run build`.
- [ ] **Step 2 (browser, as the signed-in project manager):** Home shows My load for Capstone 2; set and clear nothing permanent beyond what is restored after. On a task the PM holds (or a throwaway one, deleted after): Start, wait, Stop, see the log and Spent; Discard on a second run. Workload tab still loads. Desktop and 375 px.
- [ ] **Step 3:** `handoff.md` section, `CLAUDE.md` Space workload bullet, `npm run build`, commit "Note workload phase 3"; ask the user before merging and pushing.
