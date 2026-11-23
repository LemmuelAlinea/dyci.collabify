# Leave-aware workload, phase 2 (AI and signals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The leave review gets an AI suggestion per flagged task that the project manager applies or edits, people show "Away until …" wherever work is assigned or held, tasks warn when their remaining work no longer fits their holders' hours, and sprints show their team's hours against planned work.

**Architecture:** `supabase/work-leave.sql` gains three reads: the suggestion context for one leave, a task's per-holder forecast, and a sprint's hours. Fit is computed once by a shared internal helper that the phase 1 impact check also uses. `work-ai` gets a `leave` action that sends opaque task and person ids to the model and validates its answer in `_shared/leavePlan.ts`. The frontend adds Suggest changes to `LeaveReview`, a `useAwayRanges` hook with away labels, a forecast line in the task dialog, and a sprint hours line.

**Tech Stack:** React + TypeScript (Vite), Supabase PostgreSQL, Deno Edge Function (`work-ai`, Anthropic `ask()` with a JSON schema), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-leave-aware-workload-design.md`, phase 2 ("AI suggestions", "Away badges and at-risk forecast"). Phase 1 is live (`handoff.md`).

## Global Constraints

- Work projects and spaces only. Dates are Asia/Manila. Minutes are stored; hours are shown with `formatHours`.
- AI suggests and a person applies. Nothing changes until the project manager or a coordinator presses Apply, and every apply goes through the phase 1 paths (`updateTask`, holder changes, `startCover(..., leave.first_day)`).
- The model never sees names, emails or reasons: tasks are `t1…`, people are `c1…`, each with skill tags and free hours only. Titles and descriptions are masked with `maskMemberNames`.
- Away dates are visible to anyone sharing a live work space (phase 1, `space_away_ranges`). Forecasts are shown to the project's `pm`/`coordinator` and the task's holders only.
- Fit rule (one place, `work_task_room`): room = `work_person_available` − `work_person_load` (skipping the task) from Manila today to the due day; 0 when the due day is past; null when weekly hours are not set (never a shortfall). Remaining share = max(0, estimate − all logged minutes) ÷ holders.
- Redefine nothing another file owns. Copy and token rules from `CLAUDE.md`. Fetch `origin/main` before deploying; deploy `work-ai` with the frontend; ask before pushing `main`.

## Review Focus

- The model names a person who isn't a candidate, a date inside the leave, or the same task twice: that suggestion is dropped and the row says "No suggestion" (Task 2 `drops invented people and dates`).
- A candidate who is away during the leave is never offered (Task 1 `away candidate marked`, Task 2 `away people not sent`).
- A holder with no weekly hours: no forecast line, never "Needs 0 h more" (Task 1 `no hours no forecast`).
- Two holders on one task: each is judged on their own share (Task 1 `shared task split`).
- Someone away today on a part day shows "Away today", a whole-day leave "Away until <last day>", a future leave only in pickers as "Away 26–28 Nov" (Task 4 `away labels`).

---

### Task 1: Suggestion context, forecast and sprint hours (SQL)

**Files:** Modify `supabase/work-leave.sql`, `supabase/tests/work-leave.test.sql`, `docs/07-backup.md` (Leave and cover section).

**Interfaces — Produces:**
- `work_task_room(p_space uuid, p_user uuid, p_task uuid, p_due date) returns int` (internal, revoked): the fit rule above. `work_leave_task_status` is changed to call it (its results must not change; the phase 1 checks stay green).
- `general_task_forecast(p_task uuid) returns table(user_id uuid, remaining_minutes int, short_minutes int)` (definer, granted): one row per holder whose remaining share exceeds their room, for an open, released, live work task with an estimate and a due date; empty for anyone who is neither the project's `pm`/`coordinator` nor a holder; no row for a holder with no weekly hours.
- `general_leave_suggest_context(p_notice uuid) returns jsonb` (definer, granted): refuses "Only the project manager and coordinators can review leave." unless the caller is the notice project's `pm`/`coordinator`; refuses "This leave has ended." when `last_day` is before today. Returns `{ notice_id, project_id, user_id, first_day, last_day, tasks: [{ task_id, title, description, status, remaining_minutes, short_minutes, due_on, blocks: [titles] }] (flagged only, from work_leave_task_status), people: [{ user_id, skills: [tags], free_minutes: int|null, away: boolean }] }`. People = active project members who aren't `qa`/`stakeholder`, minus the away person. `free_minutes` = room over today → greatest(last_day, latest flagged due day). `away` = a run of theirs overlaps today → last_day.
- `general_sprint_hours(p_sprint uuid) returns table(available_minutes int, away_minutes int, planned_minutes int, unassigned int, people_without_hours int)` (definer, granted; project members only, else no row): people = holders of the sprint's open tasks; available and away (time off) minutes over `starts_on`–`ends_on` in the project's space via `work_person_hours`, summed over people with weekly hours; `planned_minutes` = sum of the open tasks' estimates; `unassigned` = open tasks with no holder.
- [ ] **Step 1: Write failing checks** (new section): `room helper matches status` (a phase 1 fixture task stays `wont_fit` with the same `short_minutes`); `forecast for planner` (holder 16 h/week, task 9000 min due in 4 weeks → one row, short > 0); `forecast for holder`; `forecast hidden from others` (a plain member who doesn't hold it → 0 rows); `no hours no forecast`; `shared task split` (two holders, 1200 min, each with 960/week due this Friday → each judged on 600); `context lists flagged and people` (keys, no away person, skills from `general_member_skills`); `away candidate marked`; `context planners only`; `sprint hours` (two holders, one with a day off → available, away, planned, unassigned 1, people_without_hours counted).
- [ ] **Step 2: Run** `node scripts/db.mjs supabase/tests/work-leave.test.sql` → fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Apply** `supabase/work-leave.sql` then `supabase/anon-lockdown.sql`; run `work-leave`, `work-workload`, `anon-lockdown` → `PASS`.
- [ ] **Step 5: Commit** "Read leave suggestion context, task forecasts and sprint hours".

### Task 2: The `leave` AI action

**Files:** Create `supabase/functions/_shared/leavePlan.ts`, `src/lib/work/leavePlan.test.ts` (imports the shared file, like `workloadPlan.test.ts`); modify `supabase/functions/work-ai/index.ts` (action `leave`, rate limit hour 12, day 50), `src/lib/api/workAi.ts`.

**Interfaces:**
- Consumes: Task 1 `general_leave_suggest_context`.
- Produces:
  - `type LeaveSuggestion = { task_id: string; action: 'keep' | 'move_due' | 'cover' | 'reassign'; person_id: string | null; due_on: string | null; reason: string }`.
  - `validateLeaveSuggestions(raw: unknown, ctx: { tasks: { key: string; taskId: string }[]; people: { key: string; userId: string }[]; leaveLast: string; today: string }): LeaveSuggestion[]` — drops rows whose task key is unknown or repeated, `cover`/`reassign` without a known person key, `move_due` without a date after `leaveLast` and within 90 days of `today`; `keep` carries no person or date; reason trimmed to 200 characters.
  - Edge action `leave` with body `{ project_id, notice_id }`: reads the context through the caller's token, refuses when its `project_id` differs, sends only non-away people as `c1…` with skills and free hours, tasks as `t1…` with masked title and description (4000 cap), status, remaining hours, due day, and the leave's dates; returns `{ suggestions: LeaveSuggestion[] }`.
  - `suggestLeaveChanges(projectId: string, noticeId: string): Promise<LeaveSuggestion[]>` in `workAi.ts`.
- [ ] **Step 1: Write failing tests** in `leavePlan.test.ts`: `keeps valid suggestions` (cover c1 → person id, move_due 2026-12-14 after leave 2026-12-10, keep); `drops invented people and dates` (c9, a date inside the leave, a date 120 days out, an unknown t9, a repeated t1 → only the first t1 survives); `trims reasons`; `away people not sent` (a pure `leaveCandidates(people)` helper in the same file returns only `away: false` people, keyed `c1…` in order).
- [ ] **Step 2: Run** `npx vitest run src/lib/work/leavePlan.test.ts` → fails.
- [ ] **Step 3: Implement** the helpers, the action (prompt: data never instructions; one move per task; prefer cover for a task due during the leave when someone with matching skills has free hours, move the due date when nobody does and nothing waits for it, keep when the leave doesn't really threaten it; one short reason; `VOICE`), and the client call.
- [ ] **Step 4: Run** the test, full `npx vitest run`, `npm run build`, and `deno check supabase/functions/work-ai/index.ts` → pass.
- [ ] **Step 5: Commit** "Suggest what to do with a leave's tasks".

### Task 3: Suggest changes in the leave review

**Files:** Modify `src/components/general/LeaveReview.tsx`, `src/components/general/LeaveReview.test.tsx`.

**Interfaces:**
- Consumes: `suggestLeaveChanges`, phase 1 actions.
- Produces: per leave section a "Suggest changes" button (spinner while waiting; the error's message on failure). Each flagged task then shows "Suggestion: Cover by Keneth Ramos until Thu 10 Dec", "Suggestion: Reassign to …", "Suggestion: Move the due date to Mon 14 Dec" or "Suggestion: Keep as it is", plus the reason in muted text, or "No suggestion". The suggestion fills that row's person picker or date field (Edit is changing them), and an "Apply" button runs the same action as the matching button (Keep marks the row Skipped).
- [ ] **Step 1: Write failing tests:** `suggest fills the row` (cover suggestion → select value is the person, text shows the line and reason); `apply cover uses startCover`; `apply move uses the date`; `missing suggestion says so`; `suggest failure shows message`.
- [ ] **Step 2: Run** `npx vitest run src/components/general/LeaveReview.test.tsx` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Suggest changes in the leave review".

### Task 4: Away badges

**Files:** Create `src/lib/work/away.ts` (+ test), `src/lib/work/useAwayRanges.ts`; modify `src/components/general/TaskDialog.tsx` (holder picker options and the people list), `src/components/general/TasksTab.tsx` (`Holders` on cards; the New task holder picker), `src/components/general/LeaveReview.tsx` (picker options).

**Interfaces:**
- Consumes: phase 1 `spaceAwayRanges(spaceId)`, `AwayRange`.
- Produces:
  - `awayText(ranges: AwayRange[], today: string, where: 'picker' | 'holder'): string | null` — a run containing today: part day → "Away today", else "Away until <formatDayLabel(last)>"; otherwise for `picker` the next run → "Away <formatDayRange(first, last)>"; `holder` → null.
  - `useAwayRanges(spaceId: string | null | undefined): Map<string, AwayRange[]>` — one `spaceAwayRanges` read per space, shared by every caller on the page (module cache, cleared after 60 s), empty on error.
  - Picker options read "Ivan Cruz · Away until Fri 28 Nov · 14 / 16 h this week"; holders in the dialog and on cards show a small warning-toned "Away until Fri 28 Nov" (cards: one chip when any holder is away, its title naming them).
- [ ] **Step 1: Write failing tests:** `away labels` (part day today, whole days, future in picker, future in holder → null, ended → null); `picker shows away` (TaskDialog option text); `card shows away holder`.
- [ ] **Step 2: Run** `npx vitest run src/lib/work/away.test.ts src/components/general/TaskDialog.test.tsx src/components/general/TasksTab.test.tsx` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Show who is away where work is assigned".

### Task 5: Forecast and sprint hours on screen

**Files:** Modify `src/lib/api/workload.ts`, `src/components/general/TaskDialog.tsx`, `src/lib/work/types.ts` (`WorkSource.loadSprintHours?`), `src/components/general/workSource.ts`, `src/components/work/SprintsView.tsx`; tests.

**Interfaces:**
- Consumes: Task 1 `general_task_forecast`, `general_sprint_hours`.
- Produces: `taskForecast(taskId): Promise<{ user_id: string; remaining_minutes: number; short_minutes: number }[]>`, `sprintHours(sprintId): Promise<SprintHours | null>` with `SprintHours = { available_minutes; away_minutes; planned_minutes; unassigned; people_without_hours }`. In the task dialog under the estimated/spent line, one danger line per row: "Needs 5 h more than Ivan Cruz has before it's due" ("than you have" for the viewer), re-read when the dialog's task changes. `WorkSource.loadSprintHours?: (sprintId: string) => Promise<SprintHours | null>` set only for work projects; `SprintsView` shows under the running sprint's dates and each planned sprint "Team hours 64 h (8 h away) · Planned 70 h", then "2 tasks have no holder" and "1 person has no weekly hours" when non-zero; nothing when `loadSprintHours` is absent or returns null.
- [ ] **Step 1: Write failing tests:** `forecast line for a short holder`; `forecast says you`; `no forecast no line`; `sprint hours line` (SprintsView with a `loadSprintHours` stub); `class source shows no sprint hours`.
- [ ] **Step 2: Run** the affected test files → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, full `npx vitest run`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Warn when work won't fit and show sprint hours".

### Task 6: Deploy, live checks, walk and notes

- [ ] **Step 1:** `git fetch origin`, merge if it moved. Apply `supabase/work-leave.sql` then `supabase/anon-lockdown.sql`; run `work-leave`, `work-workload`, `project-open-tasks`, `work-task-handoff`, `anon-lockdown`; full `npx vitest run`; `npm run build`; deploy `work-ai` (`supabase functions deploy work-ai --project-ref jublbxdqzcjmbunukxct --use-api`).
- [ ] **Step 2 (browser, as the Capstone 2 project manager, on a throwaway project like phase 1 so no other planner is notified):** mark a member away, open the review, press Suggest changes and apply one suggestion; check "Away until …" in a holder picker and on a card; an estimated task due soon shows the forecast line; a sprint shows its hours. Desktop and 375 px. Delete the throwaway project, its notices and the away days after.
- [ ] **Step 3:** `handoff.md` section, `CLAUDE.md` Leave and cover bullet, `npm run build`, commit "Note leave-aware workload phase 2"; ask the user before merging and pushing.
