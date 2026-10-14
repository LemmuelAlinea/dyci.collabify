# Phase B3: Group Progress and Deliverables Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two reports to the class report engine.
- The **Group progress report**: one group, or every group, on a project. It shows how far along each group is, who did the work, milestones, sprints, and every answer the professor gave.
- **Deliverables & milestone compliance**: every milestone and hand-in, by group, marked on time, late, missing or not due yet.

**Architecture:** Both reports reuse the B1/B2 engine: a pure builder produces a `ReportDoc`, and `ReportDocView` and the exporters draw it.
- **Engine additions:**
  - a `burnup` chart;
  - a per-cell export value, so the compliance grid exports as numbers;
  - a `dayText` formatter.
- **Data:** one new SQL file holding two staff-only views that keep archived work:
  - `report_deliverables`: every milestone and hand-in per board, already judged;
  - `report_sprints`.
- **Other reads:** `task_state`, `class_member_load` and `board_results` with names. The page wires both reports into the B1/B2 catalogue.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind tokens, Vitest, Supabase Postgres (two views).

**Spec:** `docs/superpowers/specs/2026-10-13-phase-b-reports-design.md`. This plan covers "B3 reports", "Shared rules" and "Testing".
- B1 and B2 are live on main (`88c796e`).
- Read the rulings in `docs/superpowers/plans/2026-10-14-phase-b2-checkin-intervention-log.md`, including its final-review notes in `handoff.md` ("Phase B2").

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | Group progress reads milestones from the new `report_deliverables` and sprints from a new `report_sprints`, not from `analytics_milestones` / `analytics_sprints`. | The Phase A views drop archived projects and classes, and the spec's shared rule says reports keep them ("a term report is asked for after the term ends"). The spec's "No new SQL" for Group progress loses to that rule. Both views live in the one new file B3 already adds. | One more view to maintain. |
| 2 | A milestone with **no tasks** on a board counts as not done: **Missing** once past its due day, **Not due yet** before. | The spec's rule is "met when all its tasks are done". With nothing attached, the group has shown no work for it. | A group that tracks a milestone outside Collabify reads Missing. The table note says how a milestone is judged. |
| 3 | **Days late.** A milestone's days late are Manila days after its due day. A hand-in's days late are hours past the deadline divided by 24, rounded up, and at least 1. | A milestone is due on a day. A hand-in is due at a moment, so 2 hours late is "Late (1 day)", not "Late (0 days)". | None worth weighing. |
| 4 | Group progress shows a milestone's state with the compliance labels (On time, Late (N days), Missing, Not due yet), not "met / missed / upcoming". | The two B3 reports must never disagree about the same milestone. The labels say more than "missed". | None. |
| 5 | **"Late tasks"** means tasks finished after the deadline (`late`) plus open tasks whose due day is before today. | A professor reading "late" means both. Finished-late alone would call a group with overdue open work "0 late". | A finished-late and an overdue-open task read the same. |
| 6 | **All groups** gives an overview table "Groups", one burnup per group on a shared scale, then **combined** Members, Milestones, Sprints and Feedback history tables with a first Group column. Sections are not repeated per group. | Excel gets 5 sheets, not 5 × N. The overview replaces the old Project comparison sheet (B4 retires it there). | A professor wanting one group's full section picks that group. |
| 7 | **The compliance range is a due window**, kept in the URL as `rdue`: **Every date** (the default), **This term** (the class's term dates), or **Choose dates** (`rfrom` / `rto`). A deliverable is shown when its due day falls inside the window. A hand-in with no due date shows only under Every date. | Compliance is about due dates, and a term-long view is the usual question. The check-in's week choices do not fit. | One more small choice type. |
| 8 | The compliance grid exports as **numbers in Excel and CSV**: 0 for on time, N for late, empty for missing or not due. A **Legend** table (its own sheet) explains them. Each cell carries an `exportValue` and the shared `cellExport` uses it. | This is the spec's Excel rule. CSV shares `cellExport`, and the Legend travels with it. | A CSV reader sees numbers, and must read the Legend. |
| 9 | On an **individual** project, Group progress leaves out the Members table, and every row is named after the student. | `class_member_load` covers group boards only, and one person's share of their own board is always 100%. | None. |
| 10 | Live refresh listens to `project_tasks`, `board_results`, `project_milestones` and `board_sprints` (Group progress adds `task_assignees`), through the B2 throttle. Hand-ins arrive through the class loader's boards, which the rebuild signature covers. | Same pattern as B2. A table outside the realtime publication never fires, and focus and the poll still refresh the report. | A milestone renamed elsewhere shows on the next focus. |

## Global Constraints

- **Staff-only, archived kept.**
  - Both views are `security_invoker`, filtered by `public.is_class_professor(class_id)`, and return nothing to students.
  - Archived projects and classes stay in.
- **New SQL.**
  - `supabase/report-deliverables.sql` goes in the `scripts/schema-drift.mjs` ORDER after `report-notes`, and on both rebuild lines in `docs/07-backup.md` after `supabase/report-notes.sql`.
  - It revokes from `anon` inline. Re-run `supabase/anon-lockdown.sql` after applying it.
- **Live database.** It is the only database.
  - Apply only the new file and `anon-lockdown.sql`. Test files roll back.
  - Never re-run `results.sql`, `analytics.sql`, `admin-program.sql`, `task-archive.sql` or `automation.sql` as a whole.
- **Days are Manila days.**
  - Use `manilaDay`, `addDays` and `daysBetween` from `src/lib/analyticsMath.ts`. In SQL use `(x at time zone 'Asia/Manila')::date`.
  - Display with the `dayText` helper (Task 2) or the column types.
- **Colours** come only from tokens (`Tone`: `success`, `warning`, `danger`, `pending`). No raw hex.
- **Copy** uses sentence case. No "please", no "successfully", no exclamation marks. An empty result says why and what would fill it.
- **Exact strings:**
  - State labels: "On time", "Late (1 day)", "Late (N days)", "Missing", "Not due yet".
  - Compliance empty: "No milestones or hand-ins fall due in these dates. Widen the dates or pick another project."
  - Compliance, a project with nothing in the window (only when several projects are shown): "Nothing on {project} falls due in these dates."
  - No term dates: "This class has no term dates, so every date is shown."
  - Compliance footer lines:
    - "A milestone is met when all its tasks are done by the end of its due day, Manila time."
    - "A hand-in is on time when it arrives by the project's deadline. Collabify keeps the latest hand-in time only."
  - Group progress footer line: "Counts are tasks recorded in Collabify. A flag is a prompt for a conversation, not a verdict."
  - Archived project note: "This project is archived. The report shows it as it was left."
- **React rules.** A `.tsx` file exports components only. Pure helpers go in `.ts` files.
- **Before calling a task done,** run `npm run build`, `npx eslint src` and `npx vitest run`. `npm run lint` fails only on untracked `launch-video/` scripts; ignore that.
- **Staging, editing and hooks:**
  - Stage files by name. Never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`.
  - Use the Edit/Write tools, never PowerShell `Set-Content`.
  - Never bypass git hooks.

## Review Focus

1. **A milestone with no tasks on a board.** It is Missing once past due and Not due yet before (ruling 2). *Task 1 SQL test.*
2. **A project with no due date.**
   - Its hand-in is On time when handed in, and Not due yet otherwise.
   - The column reads "Hand-in (no due date)".
   - It is shown only under Every date.

   *Task 1 SQL test and Task 3 test.*
3. **A board that was returned and not handed in again, past due.** It reads Missing, never On time. *Task 1 SQL test.*
4. **An individual project in Group progress.** There is no Members table, rows are named after students, and the overview's first column says "Student". *Task 4 test.*
5. **A window or project with nothing due.**
   - The empty sentence shows, with no empty grid and no Legend.
   - The on-time rate reads "—", never `NaN`.

   *Task 3 test.*

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/report-deliverables.sql` + `supabase/tests/report-deliverables.test.sql` (new) | The `report_deliverables` and `report_sprints` views. |
| `src/lib/types.ts` (modify) | `DeliverableState`, `DeliverableRow`, `ReportSprint`, `BoardDecision`. |
| `src/lib/api/reportReads.ts` (new) | `listDeliverables`, `listReportSprints`, `classTaskStates`, `classMemberLoad`, `boardHistoryFor`. |
| `src/lib/reports/doc.ts`, `src/components/reports/ReportDocView.tsx` (modify) | `BurnupChart`, `RichCell.exportValue`, `dayText`. |
| `src/lib/reports/range.ts` (modify) | `DueChoice`, `DUE_CHOICES`, `parseDueChoice`, `resolveDueWindow`. |
| `src/lib/reports/deliverables.ts` + `.test.ts` (new) | `deliverableLabel`, `deliverableCell`, `deliverablesDoc`. |
| `src/lib/reports/groupProgress.ts` + `.test.ts` (new) | `groupProgressDoc`. |
| `src/pages/app/reports/reportKind.ts`, `useReports.ts`, `useReportDoc.ts`, `Reports.tsx` (modify) | New kinds, the `rdue` choice, loaders and picker controls. |

---

### Task 1: The deliverables and sprints views, and their reads

**Files:**
- Create: `supabase/report-deliverables.sql`, `supabase/tests/report-deliverables.test.sql`
- Create: `src/lib/api/reportReads.ts`
- Modify: `src/lib/types.ts`, `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Consumes: `pageAll`, `pageAllIn` (`src/lib/api/paging.ts`); `TaskState`, `MemberLoad`, `SprintProgress`, `ResultVerdict` (`src/lib/types.ts`).
- Produces:
  - `type DeliverableState = 'on_time' | 'late' | 'missing' | 'not_due'`
  - `type DeliverableRow` (the shape below)
  - `type ReportSprint = SprintProgress`
  - `type BoardDecision = { board_id: string; verdict: ResultVerdict; feedback: string; decided_at: string; decided_by_name: string | null }`
  - `listDeliverables(classId: string): Promise<DeliverableRow[]>`
  - `listReportSprints(classId: string): Promise<ReportSprint[]>`
  - `classTaskStates(classId: string): Promise<TaskState[]>`
  - `classMemberLoad(classId: string): Promise<MemberLoad[]>`
  - `boardHistoryFor(boardIds: string[]): Promise<BoardDecision[]>` (oldest first)

- [ ] **Step 1: Write the SQL test**

Create `supabase/tests/report-deliverables.test.sql`.
- Fixture timing:
  - Dates are relative to today in Manila, so the test holds whenever it runs.
  - Tasks are finished and boards handed in **before** the project's deadline is moved into the past, so no deadline guard blocks the fixture.
  - `done_at` is set with a second `update` that leaves `status` unchanged. `stamp_task_status` only rewrites `done_at` when the status changes.
- If a guard trigger still refuses a fixture write as the service role, change the order of the writes, not the view. Say so in the report.

```sql
-- report_deliverables and report_sprints — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-deliverables.test.sql

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.manila(p_day date, p_hour int default 10) returns timestamptz
language sql as $$ select (p_day::timestamp + make_interval(hours => p_hour)) at time zone 'Asia/Manila' $$;

do $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_set uuid; v_g1 uuid; v_g2 uuid; v_g3 uuid;
  v_proj uuid; v_solo uuid; v_b1 uuid; v_b2 uuid; v_b3 uuid; v_sa uuid;
  v_m_on uuid; v_m_late uuid; v_m_miss uuid; v_m_future uuid; v_m_empty uuid; v_sprint uuid; v_t uuid;
  r record;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-del-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g1') returning id into v_g1;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g2') returning id into v_g2;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g3') returning id into v_g3;
  insert into public.group_members (group_id, set_id, student_id) values (v_g1, v_set, v_a);
  insert into public.group_members (group_id, set_id, student_id) values (v_g2, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-del-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_b1 from public.project_boards where project_id = v_proj and group_id = v_g1;
  select id into v_b2 from public.project_boards where project_id = v_proj and group_id = v_g2;
  select id into v_b3 from public.project_boards where project_id = v_proj and group_id = v_g3;

  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-on', v_today - 10) returning id into v_m_on;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-late', v_today - 10) returning id into v_m_late;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-miss', v_today - 10) returning id into v_m_miss;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-future', v_today + 5) returning id into v_m_future;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-empty', v_today - 3) returning id into v_m_empty;

  -- zz-on: every task done two days before the due day.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz on', 'done', v_m_on) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 12) where id = v_t;
  -- zz-late: every task done, the last three days after the due day.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz late', 'done', v_m_late) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 7) where id = v_t;
  -- zz-miss: one of two done, and the due day has passed.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz miss a', 'done', v_m_miss);
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz miss b', 'todo', v_m_miss);
  -- zz-future: open, not yet due.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz future', 'todo', v_m_future);
  -- zz-empty: nothing attached on b1 (ruling 2).

  -- A sprint from 20 to 14 days ago: one task finished inside it, one after.
  insert into public.board_sprints (board_id, name, starts_on, ends_on) values (v_b1, 'zz sprint', v_today - 20, v_today - 14)
  returning id into v_sprint;
  insert into public.project_tasks (board_id, title, status, sprint_id) values (v_b1, 'zz sp in', 'done', v_sprint) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 15) where id = v_t;
  insert into public.project_tasks (board_id, title, status, sprint_id) values (v_b1, 'zz sp after', 'done', v_sprint) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 12) where id = v_t;

  -- Hand-ins: b1 three days ago, b2 one day ago; the deadline then moves to two days ago.
  -- b3 was returned and never handed in again.
  update public.project_boards set submitted_at = now() - interval '3 days' where id = v_b1;
  update public.project_boards set submitted_at = now() - interval '1 day' where id = v_b2;
  insert into public.board_results (board_id, verdict, feedback, decided_by, decided_at)
  values (v_b3, 'returned', 'zz fix the model', v_prof, now() - interval '4 days');
  update public.projects set due_at = now() - interval '2 days' where id = v_proj;

  -- An individual project with no due date: one student hands in, the other does not.
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-del-solo', 'activity', 1, 2, 'individual', null)
  returning id into v_solo;
  perform public.ensure_project_boards(v_solo);
  select id into v_sa from public.project_boards where project_id = v_solo and student_id = v_a;
  update public.project_boards set submitted_at = now() - interval '1 day' where id = v_sa;

  perform pg_temp.act_as(v_prof);

  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_on;
  perform pg_temp.must_be('a milestone done before its day is on time', r.state = 'on_time' and r.days_late = 0 and r.tasks = 1 and r.done = 1);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_late;
  perform pg_temp.must_be('a milestone done three days after is late by 3', r.state = 'late' and r.days_late = 3);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_miss;
  perform pg_temp.must_be('a past-due milestone with open work is missing', r.state = 'missing' and r.done_at is null and r.done = 1 and r.tasks = 2);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_future;
  perform pg_temp.must_be('a milestone due later is not due', r.state = 'not_due');
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_empty;
  perform pg_temp.must_be('a past-due milestone with no tasks is missing', r.state = 'missing' and r.tasks = 0);
  select * into r from public.report_deliverables where board_id = v_b2 and kind = 'milestone' and ref_id = v_m_future;
  perform pg_temp.must_be('every board carries every milestone, named for its group', r.state = 'not_due' and r.group_name = 'zz-del-g2');

  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'hand_in';
  perform pg_temp.must_be('a hand-in before the deadline is on time',
    r.state = 'on_time' and r.days_late = 0 and r.ref_id = v_proj and r.title = 'Hand-in' and r.due_day is not null);
  select * into r from public.report_deliverables where board_id = v_b2 and kind = 'hand_in';
  perform pg_temp.must_be('a hand-in a day after the deadline is late by 1', r.state = 'late' and r.days_late = 1);
  select * into r from public.report_deliverables where board_id = v_b3 and kind = 'hand_in';
  perform pg_temp.must_be('returned and not handed in again, past due, is missing', r.state = 'missing');

  select * into r from public.report_deliverables where board_id = v_sa and kind = 'hand_in';
  perform pg_temp.must_be('no deadline: handed in is on time, named for the student',
    r.state = 'on_time' and r.due_day is null and r.student_name is not null and r.group_name is null);
  perform pg_temp.must_be('no deadline: not handed in is not due',
    (select state from public.report_deliverables where project_id = v_solo and kind = 'hand_in' and board_id <> v_sa limit 1) = 'not_due');

  select * into r from public.report_sprints where sprint_id = v_sprint;
  perform pg_temp.must_be('a sprint counts work finished inside its dates', r.tasks = 2 and r.done = 2 and r.done_in_window = 1);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no deliverables',
    (select count(*) from public.report_deliverables where class_id = v_class) = 0);
  perform pg_temp.must_be('a student reads no sprints',
    (select count(*) from public.report_sprints where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an archived project in an ended class keeps its deliverables',
    (select count(*) from public.report_deliverables where project_id = v_proj) = 18
    and (select project_archived_at is not null from public.report_deliverables where project_id = v_proj limit 1));
  perform pg_temp.must_be('and its sprints',
    (select count(*) from public.report_sprints where sprint_id = v_sprint) = 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
```

The 18 is 3 boards × (5 milestones + 1 hand-in).

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/db.mjs supabase/tests/report-deliverables.test.sql`
Expected: an error that `public.report_deliverables` does not exist.

- [ ] **Step 3: Write the views**

Create `supabase/report-deliverables.sql`:

```sql
-- Collabify — deliverables and sprints for reports, ended work kept.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/report-deliverables.sql
-- Requires: class-milestones.sql, class-planning.sql. Re-run supabase/anon-lockdown.sql afterwards.

/**
 * Every milestone and hand-in on every board, already judged, so the two B3
 * reports can never disagree about one. The analytics views drop archived
 * projects and ended classes; a report is asked for after the term, so these
 * keep them.
 *
 * A milestone is met when all its tasks are done by the end of its Manila due
 * day; one with no tasks on a board has nothing done. A hand-in is the board's
 * current submitted_at against the project's deadline: Collabify keeps only
 * the latest hand-in, so a returned board not handed in again is missing once
 * the deadline passes.
 */

begin;

drop view if exists public.report_deliverables;
drop view if exists public.report_sprints;

create view public.report_deliverables
with (security_invoker = true) as
with base as (
  select b.id as board_id, p.id as project_id, p.class_id, p.title as project_title,
         p.due_at as project_due_at, p.archived_at as project_archived_at,
         g.name as group_name,
         case when b.student_id is null then null
              else nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '') end
           as student_name,
         b.submitted_at
    from public.project_boards b
    join public.projects p on p.id = b.project_id
    left join public.groups g on g.id = b.group_id
    left join public.profiles sp on sp.id = b.student_id
   where public.is_class_professor(p.class_id)
),
milestones as (
  select 'milestone'::text as kind, x.board_id, x.project_id, x.class_id, x.project_title,
         x.project_archived_at, x.group_name, x.student_name,
         ms.id as ref_id, ms.name as title, ms.due_on as due_day, null::timestamptz as due_at,
         count(t.id)::int as tasks,
         count(t.id) filter (where t.status = 'done')::int as done,
         case when count(t.id) > 0 and count(t.id) filter (where t.status = 'done') = count(t.id)
              then max(t.done_at) end as done_at
    from base x
    join public.project_milestones ms on ms.project_id = x.project_id
    left join public.project_tasks t
      on t.board_id = x.board_id and t.milestone_id = ms.id and t.archived_at is null
   group by x.board_id, x.project_id, x.class_id, x.project_title, x.project_archived_at,
            x.group_name, x.student_name, ms.id, ms.name, ms.due_on
),
hand_ins as (
  select 'hand_in'::text as kind, x.board_id, x.project_id, x.class_id, x.project_title,
         x.project_archived_at, x.group_name, x.student_name,
         x.project_id as ref_id, 'Hand-in'::text as title,
         (x.project_due_at at time zone 'Asia/Manila')::date as due_day, x.project_due_at as due_at,
         null::int as tasks, null::int as done, x.submitted_at as done_at
    from base x
),
everything as (
  select * from milestones
  union all
  select * from hand_ins
),
judged as (
  select e.*,
         case
           when e.done_at is null then null
           when e.kind = 'milestone' then
             greatest(0, (e.done_at at time zone 'Asia/Manila')::date - e.due_day)
           when e.due_at is not null and e.done_at > e.due_at then
             greatest(1, ceil(extract(epoch from e.done_at - e.due_at) / 86400)::int)
           else 0
         end as days_late
    from everything e
)
select j.*,
       case
         when j.done_at is not null then case when j.days_late > 0 then 'late' else 'on_time' end
         when j.kind = 'milestone' and (now() at time zone 'Asia/Manila')::date > j.due_day then 'missing'
         when j.kind = 'hand_in' and j.due_at is not null and now() > j.due_at then 'missing'
         else 'not_due'
       end as state
  from judged j;

create view public.report_sprints
with (security_invoker = true) as
select s.id as sprint_id, s.board_id, p.class_id, b.project_id, s.name, s.starts_on, s.ends_on, s.state,
       count(t.id)::int as tasks,
       count(t.id) filter (where t.status = 'done')::int as done,
       count(t.id) filter (
         where t.status = 'done'
           and (t.done_at at time zone 'Asia/Manila')::date between s.starts_on and s.ends_on
       )::int as done_in_window
  from public.board_sprints s
  join public.project_boards b on b.id = s.board_id
  join public.projects p on p.id = b.project_id
  left join public.project_tasks t on t.sprint_id = s.id and t.archived_at is null
 where public.is_class_professor(p.class_id)
 group by s.id, s.board_id, p.class_id, b.project_id, s.name, s.starts_on, s.ends_on, s.state;

revoke all on public.report_deliverables from anon;
revoke all on public.report_sprints from anon;
grant select on public.report_deliverables to authenticated;
grant select on public.report_sprints to authenticated;

commit;
```

- [ ] **Step 4: Apply it and run the test**

Run: `node scripts/db.mjs supabase/report-deliverables.sql supabase/anon-lockdown.sql`, then `node scripts/db.mjs supabase/tests/report-deliverables.test.sql`
Expected: 16 `PASS` lines and no `FAIL`.

- [ ] **Step 5: The rebuild order**

- In `scripts/schema-drift.mjs`, the ORDER list ends `... class-notes report-notes`. Append ` report-deliverables`.
- In `docs/07-backup.md`, both rebuild lines (26 and 53) end `supabase/report-notes.sql`. Append ` supabase/report-deliverables.sql` to each.
- After the `report-notes.sql` paragraph (line 215), add:

```markdown
`report-deliverables.sql` runs after `report-notes.sql`. It holds `report_deliverables` (every milestone and hand-in per board, judged on time, late, missing or not due) and `report_sprints`, both staff-only, with archived projects and ended classes kept for the B3 reports.
```

- [ ] **Step 6: Types**

Append to `src/lib/types.ts`, after `SprintProgress`:

```ts
/** report_deliverables: one milestone or hand-in on one board, already judged. */
export type DeliverableState = 'on_time' | 'late' | 'missing' | 'not_due'

export type DeliverableRow = {
  kind: 'milestone' | 'hand_in'
  board_id: string
  project_id: string
  class_id: string
  project_title: string
  project_archived_at: string | null
  group_name: string | null
  /** Set only on an individual project's board. */
  student_name: string | null
  /** The milestone's id, or the project's id for a hand-in. */
  ref_id: string
  title: string
  /** A Manila day. Null for a hand-in on a project with no deadline. */
  due_day: string | null
  /** The hand-in deadline as a moment; null for a milestone. */
  due_at: string | null
  /** Null for a hand-in. */
  tasks: number | null
  done: number | null
  /** When the last task finished (milestone, all done) or the board was handed in. */
  done_at: string | null
  days_late: number | null
  state: DeliverableState
}

/** report_sprints: the analytics sprint shape, with ended projects and classes kept. */
export type ReportSprint = SprintProgress

/** One answer to a hand-in, with who gave it. */
export type BoardDecision = {
  board_id: string
  verdict: ResultVerdict
  feedback: string
  decided_at: string
  decided_by_name: string | null
}
```

- [ ] **Step 7: The reads**

Create `src/lib/api/reportReads.ts`:

```ts
import { supabase } from '../supabase'
import type { BoardDecision, DeliverableRow, MemberLoad, ReportSprint, ResultVerdict, TaskState } from '../types'
import { pageAll, pageAllIn } from './paging'

/**
 * Reads for the B3 reports, each scoped to one class. The views are already
 * scoped to the class's own professor; the class filter keeps a professor with
 * many classes from loading all of them for one report.
 */

export async function listDeliverables(classId: string) {
  return pageAll<DeliverableRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('report_deliverables')
      .select('*')
      .eq('class_id', classId)
      .order('project_id')
      .order('board_id')
      .order('kind')
      .order('ref_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as DeliverableRow[]
  })
}

export async function listReportSprints(classId: string) {
  return pageAll<ReportSprint>(async (from, to) => {
    const { data, error } = await supabase
      .from('report_sprints')
      .select('*')
      .eq('class_id', classId)
      .order('starts_on')
      .order('sprint_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ReportSprint[]
  })
}

export async function classTaskStates(classId: string) {
  return pageAll<TaskState>(async (from, to) => {
    const { data, error } = await supabase
      .from('task_state')
      .select('*')
      .eq('class_id', classId)
      .order('task_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as TaskState[]
  })
}

export async function classMemberLoad(classId: string) {
  return pageAll<MemberLoad>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_member_load')
      .select('*')
      .eq('class_id', classId)
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as MemberLoad[]
  })
}

type DecisionRow = {
  id: string
  board_id: string
  verdict: ResultVerdict
  feedback: string
  decided_at: string
  decided_by: string | null
}

/** Every answer on these boards, oldest first, with who gave it. */
export async function boardHistoryFor(boardIds: string[]): Promise<BoardDecision[]> {
  const rows = await pageAllIn<DecisionRow>(boardIds, async (ids, from, to) => {
    const { data, error } = await supabase
      .from('board_results')
      .select('id, board_id, verdict, feedback, decided_at, decided_by')
      .in('board_id', ids)
      .order('decided_at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as DecisionRow[]
  })
  const people = [...new Set(rows.map((r) => r.decided_by).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  const found = await pageAllIn<{ id: string; first_name: string; last_name: string }>(people, async (ids, from, to) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', ids)
      .order('id')
      .range(from, to)
    if (error) throw error
    return data ?? []
  })
  for (const p of found) names.set(p.id, `${p.first_name} ${p.last_name}`.trim())
  return rows
    .sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      board_id: r.board_id,
      verdict: r.verdict,
      feedback: r.feedback,
      decided_at: r.decided_at,
      decided_by_name: r.decided_by ? names.get(r.decided_by) ?? null : null,
    }))
}
```

Then check in the live database, as a professor, that `profiles` returns a co-teacher's name. `board_result_overview` already joins `profiles` under `security_invoker` for the same people, so it should. If it does not, report it rather than widening any policy.

- [ ] **Step 8: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.
Expected: all clean.

```bash
git add supabase/report-deliverables.sql supabase/tests/report-deliverables.test.sql src/lib/api/reportReads.ts src/lib/types.ts scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add the judged deliverables and sprints views the B3 reports read"
```

---

### Task 2: Engine additions: a burnup chart, a per-cell export value, `dayText`

**Files:**
- Modify: `src/lib/reports/doc.ts`, `src/lib/reports/doc.test.ts`
- Modify: `src/lib/reports/export.test.ts`
- Modify: `src/components/reports/ReportDocView.tsx`

**Interfaces:**
- Consumes: `BurnupPoint` (`src/lib/analyticsMath.ts`); `Burnup` (`src/components/charts/Burnup.tsx`, props `points`, `endDay`, `title`, `yMax`).
- Produces:
  - `type BurnupChart = { kind: 'burnup'; points: BurnupPoint[]; endDay: string | null; yMax?: number }`, added to `ChartSpec`
  - `RichCell` gains `exportValue?: string | number | null`. When it is present (even `null`), `cellExport` returns it instead of the cell's value.
  - `dayText(v: string): string`: a Manila day or moment as "Oct 7, 2026". Invalid input comes back unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/reports/doc.test.ts` (it already imports `describe`, `expect` and `it`; add `dayText` to its import from `./doc`):

```ts
describe('export values and days', () => {
  const status = { key: 's', label: 'State', type: 'status' as const }
  it('exports a cell by its export value when it has one', () => {
    expect(cellExport({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 }, status)).toBe(3)
    expect(cellExport({ value: 'On time', tone: 'success', exportValue: 0 }, status)).toBe(0)
    expect(cellExport({ value: 'Missing', tone: 'danger', exportValue: null }, status)).toBeNull()
    expect(cellExport({ value: 'Accepted', tone: 'success' }, status)).toBe('Accepted')
  })
  it('writes a day or a moment as a Manila day', () => {
    expect(dayText('2026-10-07')).toBe('Oct 7, 2026')
    expect(dayText('2026-10-06T17:30:00Z')).toBe('Oct 7, 2026')
    expect(dayText('not a day')).toBe('not a day')
  })
})
```

Append to `src/lib/reports/export.test.ts` (use its existing imports of `docToWorkbook` and `docCsvFiles`):

```ts
describe('export values in the grid', () => {
  const doc: ReportDoc = {
    header: { title: 'Compliance', subtitle: 'Lab 6', classLine: 'QM', rangeLabel: null, madeAt: 'today' },
    blocks: [
      {
        kind: 'table', id: 'g', title: 'Compliance',
        columns: [{ key: 'g', label: 'Group', type: 'text' }, { key: 'm', label: 'Draft', type: 'status' }],
        rows: [
          ['Group 1', { value: 'Late (3 days)', tone: 'warning', exportValue: 3 }],
          ['Group 2', { value: 'Missing', tone: 'danger', exportValue: null }],
        ],
      },
      { kind: 'chart', id: 'b', title: 'Scope and done', chart: { kind: 'burnup', points: [{ day: '2026-10-01', scope: 2, done: 1 }], endDay: null }, summary: '1 of 2 tasks done by Oct 1, 2026.' },
    ],
    footer: { lines: [], signatures: [] },
  }
  it('writes days late as numbers and missing as empty, in Excel and CSV', () => {
    const wb = docToWorkbook(doc)
    expect(wb.sheets[1].rows.slice(1)).toEqual([['Group 1', '3'], ['Group 2', '']])
    expect(docCsvFiles(doc, 'x')[0].csv).toContain('Group 1,3')
  })
  it('puts the burnup summary on the cover', () => {
    expect(docToWorkbook(doc).sheets[0].rows.flat()).toContain('Scope and done: 1 of 2 tasks done by Oct 1, 2026.')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/reports/doc.test.ts src/lib/reports/export.test.ts`
Expected: FAIL. `dayText` is not exported, `exportValue` is not a known property, and `burnup` is not a `ChartSpec`.

- [ ] **Step 3: Implement**

In `src/lib/reports/doc.ts`:

```ts
import type { BurnupPoint, Tone, WeekRow } from '../analyticsMath'
// …
export type RichCell = {
  value: string | number | null
  tag?: string
  tone?: Tone
  /** What Excel and CSV get instead of `value`, when set (null writes an empty cell). */
  exportValue?: string | number | null
}
// …
export type BurnupChart = { kind: 'burnup'; points: BurnupPoint[]; endDay: string | null; yMax?: number }
export type ChartSpec = BarsChart | WeekBarsChart | BurnupChart
```

At the top of `cellExport`, before `const v = cellValue(c)`:

```ts
  if (c !== null && typeof c === 'object' && c.exportValue !== undefined) return c.exportValue
```

After `cellText`, add:

```ts
/** A Manila day ("Oct 7, 2026") from a bare day or a moment. */
export function dayText(v: string): string {
  const d = asDate(v)
  return invalid(d) ? v : DAY.format(d)
}
```

In `src/components/reports/ReportDocView.tsx`, import `Burnup` from `../charts/Burnup`. Where the chart is chosen (it now reads `weekBars ? <WeekBars …/> : <Bars …/>`), choose on all three kinds:

```tsx
{block.chart.kind === 'weekBars' ? (
  <WeekBars rows={block.chart.rows} title={block.title} />
) : block.chart.kind === 'burnup' ? (
  <Burnup points={block.chart.points} endDay={block.chart.endDay} yMax={block.chart.yMax} title={block.title} />
) : (
  <Bars rows={block.chart.rows} max={block.chart.max} unit={block.chart.unit} title={block.title} />
)}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/reports`
Expected: PASS. Any older test that switches on `ChartSpec` still compiles, because `tsc -b` runs in the build.

- [ ] **Step 5: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.

```bash
git add src/lib/reports/doc.ts src/lib/reports/doc.test.ts src/lib/reports/export.test.ts src/components/reports/ReportDocView.tsx
git commit -m "Add a burnup chart, per-cell export values and day text to the report engine"
```

---

### Task 3: Deliverables & milestone compliance

**Files:**
- Modify: `src/lib/reports/range.ts`, `src/lib/reports/range.test.ts`
- Create: `src/lib/reports/deliverables.ts`, `src/lib/reports/deliverables.test.ts`

**Interfaces:**
- Consumes:
  - `DeliverableRow`, `DeliverableState` (Task 1);
  - `RichCell`, `dayText`, `tableBlocks`, `docToWorkbook` (Task 2 and B1);
  - `ReportHead` (`./grading`), `DayRange`, `rangeText` (`./range`), `Tone`.
- Produces:
  - `type DueChoice = 'all' | 'term' | 'custom'`, `DUE_CHOICES`, `parseDueChoice(raw: string | null): DueChoice`
  - `resolveDueWindow(choice: DueChoice, term: { start: string | null; end: string | null }, custom: { from?: string; to?: string }): DayRange | null`
  - `deliverableLabel(r: Pick<DeliverableRow, 'state' | 'days_late'>): string`
  - `deliverableCell(r: Pick<DeliverableRow, 'state' | 'days_late'>): RichCell`
  - `type DeliverableProject = { id: string; title: string; audience: 'group' | 'individual' }`
  - `deliverablesDoc(input: ReportHead & { projects: DeliverableProject[]; rows: DeliverableRow[]; window: DayRange | null; notice?: string | null }): ReportDoc`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/reports/range.test.ts` (add `parseDueChoice` and `resolveDueWindow` to its import from `./range`):

```ts
describe('due windows', () => {
  const term = { start: '2026-08-03', end: '2026-12-12' }
  it('reads the choice from the address', () => {
    expect(parseDueChoice('term')).toBe('term')
    expect(parseDueChoice('custom')).toBe('custom')
    expect(parseDueChoice(null)).toBe('all')
    expect(parseDueChoice('toString')).toBe('all')
  })
  it('resolves every date, the term and chosen dates', () => {
    expect(resolveDueWindow('all', term, {})).toBeNull()
    expect(resolveDueWindow('term', term, {})).toEqual({ from: '2026-08-03', to: '2026-12-12' })
    expect(resolveDueWindow('term', { start: null, end: '2026-12-12' }, {})).toBeNull()
    expect(resolveDueWindow('custom', term, { from: '2026-10-31', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolveDueWindow('custom', term, { from: '2026-10-01' })).toBeNull()
  })
})
```

Create `src/lib/reports/deliverables.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deliverableCell, deliverableLabel, deliverablesDoc } from './deliverables'
import { docToWorkbook } from './export'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { DeliverableRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const row = (over: Partial<DeliverableRow>): DeliverableRow => ({
  kind: 'milestone', board_id: 'b1', project_id: 'p1', class_id: 'c', project_title: 'Lab 6', project_archived_at: null,
  group_name: 'Group 1', student_name: null, ref_id: 'm1', title: 'Draft', due_day: '2026-10-07', due_at: null,
  tasks: 2, done: 2, done_at: '2026-10-06T02:00:00Z', days_late: 0, state: 'on_time', ...over,
})
const handIn = (over: Partial<DeliverableRow>) =>
  row({ kind: 'hand_in', ref_id: 'p1', title: 'Hand-in', due_day: '2026-10-20', due_at: '2026-10-20T09:00:00Z', tasks: null, done: null, ...over })
const rows: DeliverableRow[] = [
  row({}),
  row({ board_id: 'b2', group_name: 'Group 2', done_at: '2026-10-10T02:00:00Z', days_late: 3, state: 'late' }),
  row({ board_id: 'b10', group_name: 'Group 10', done: 1, done_at: null, days_late: null, state: 'missing' }),
  handIn({ done_at: null, days_late: null, state: 'not_due' }),
  handIn({ board_id: 'b2', group_name: 'Group 2', done_at: '2026-10-21T01:00:00Z', days_late: 1, state: 'late' }),
  handIn({ board_id: 'b10', group_name: 'Group 10', done_at: null, days_late: null, state: 'missing' }),
]
const lab6 = { id: 'p1', title: 'Lab 6', audience: 'group' as const }
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value
const notes = (doc: ReportDoc) => doc.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))

describe('deliverable states', () => {
  it('labels each state, with days late spelled out', () => {
    expect(deliverableLabel({ state: 'on_time', days_late: 0 })).toBe('On time')
    expect(deliverableLabel({ state: 'late', days_late: 1 })).toBe('Late (1 day)')
    expect(deliverableLabel({ state: 'late', days_late: 3 })).toBe('Late (3 days)')
    expect(deliverableLabel({ state: 'missing', days_late: null })).toBe('Missing')
    expect(deliverableLabel({ state: 'not_due', days_late: null })).toBe('Not due yet')
  })
  it('gives each state its tone and its spreadsheet number', () => {
    expect(deliverableCell({ state: 'on_time', days_late: 0 })).toEqual({ value: 'On time', tone: 'success', exportValue: 0 })
    expect(deliverableCell({ state: 'late', days_late: 3 })).toEqual({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 })
    expect(deliverableCell({ state: 'missing', days_late: null })).toEqual({ value: 'Missing', tone: 'danger', exportValue: null })
    expect(deliverableCell({ state: 'not_due', days_late: null })).toEqual({ value: 'Not due yet', tone: 'pending', exportValue: null })
  })
})

describe('deliverablesDoc', () => {
  it('lays groups down and milestones then the hand-in across, in name order', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null })
    const [grid] = tableBlocks(doc)
    expect(grid.title).toBe('Compliance')
    expect(grid.columns.map((c) => c.label)).toEqual(['Group', 'Draft (due Oct 7, 2026)', 'Hand-in (due Oct 20, 2026)'])
    expect(grid.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2', 'Group 10'])
    expect(grid.rows[1][1]).toEqual({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 })
    expect(grid.rows[2][2]).toEqual({ value: 'Missing', tone: 'danger', exportValue: null })
  })
  it('counts the KPIs over what is due', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null })
    expect(kpi(doc, 'On-time rate')).toBe(20)
    expect(kpi(doc, 'On time')).toBe(1)
    expect(kpi(doc, 'Late')).toBe(2)
    expect(kpi(doc, 'Missing')).toBe(2)
    expect(kpi(doc, 'Not due yet')).toBe(1)
  })
  it('keeps only what falls due inside the window', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: { from: '2026-10-01', to: '2026-10-10' } })
    expect(tableBlocks(doc)[0].columns.map((c) => c.label)).toEqual(['Group', 'Draft (due Oct 7, 2026)'])
    expect(doc.header.rangeLabel).toBe('Oct 1 to Oct 10, 2026')
  })
  it('says so when nothing falls due, with no grid, no legend and no rate', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: { from: '2026-11-01', to: '2026-11-30' } })
    expect(tableBlocks(doc)).toHaveLength(0)
    expect(notes(doc)).toContain('No milestones or hand-ins fall due in these dates. Widen the dates or pick another project.')
    expect(kpi(doc, 'On-time rate')).toBe('—')
  })
  it('names a hand-in with no deadline, and shows it only under every date', () => {
    const open = [handIn({ due_day: null, due_at: null, done_at: '2026-10-21T01:00:00Z', days_late: 0, state: 'on_time' })]
    const all = deliverablesDoc({ ...head, projects: [lab6], rows: open, window: null })
    expect(tableBlocks(all)[0].columns.map((c) => c.label)).toEqual(['Group', 'Hand-in (no due date)'])
    const dated = deliverablesDoc({ ...head, projects: [lab6], rows: open, window: { from: '2026-10-01', to: '2026-10-31' } })
    expect(tableBlocks(dated)).toHaveLength(0)
  })
  it('puts students down the side of an individual project', () => {
    const solo = { id: 'p2', title: 'Essay', audience: 'individual' as const }
    const doc = deliverablesDoc({
      ...head, projects: [solo], window: null,
      rows: [handIn({ project_id: 'p2', ref_id: 'p2', group_name: null, student_name: 'Ana Cruz', state: 'not_due', done_at: null, days_late: null })],
    })
    const [grid] = tableBlocks(doc)
    expect(grid.columns[0].label).toBe('Student')
    expect(grid.rows[0][0]).toBe('Ana Cruz')
  })
  it('gives each project its own grid, says which have nothing due, and ends with the legend', () => {
    const essay = { id: 'p2', title: 'Essay', audience: 'individual' as const }
    const doc = deliverablesDoc({ ...head, projects: [lab6, essay], rows, window: null })
    expect(tableBlocks(doc).map((t) => t.title)).toEqual(['Lab 6', 'Legend'])
    expect(notes(doc)).toContain('Nothing on Essay falls due in these dates.')
    expect(doc.header.subtitle).toBe('All projects')
  })
  it('passes on a notice from the page', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null, notice: 'This class has no term dates, so every date is shown.' })
    expect(notes(doc)[0]).toBe('This class has no term dates, so every date is shown.')
  })
  it('writes the grid to Excel as days late, with a legend sheet', () => {
    const wb = docToWorkbook(deliverablesDoc({ ...head, projects: [lab6], rows, window: null }))
    expect(wb.sheets.map((s) => s.name)).toEqual(['Report', 'Compliance', 'Legend'])
    expect(wb.sheets[1].rows.slice(1)).toEqual([
      ['Group 1', '0', ''],
      ['Group 2', '3', '1'],
      ['Group 10', '', ''],
    ])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/reports/range.test.ts src/lib/reports/deliverables.test.ts`
Expected: FAIL. The functions are not defined.

- [ ] **Step 3: Implement the due window**

Append to `src/lib/reports/range.ts`:

```ts
/** Which deliverables a compliance report covers, by when they fall due. */
export type DueChoice = 'all' | 'term' | 'custom'

export const DUE_CHOICES: { value: DueChoice; label: string }[] = [
  { value: 'all', label: 'Every date' },
  { value: 'term', label: 'This term' },
  { value: 'custom', label: 'Choose dates' },
]

export function parseDueChoice(raw: string | null): DueChoice {
  return raw === 'term' || raw === 'custom' ? raw : 'all'
}

/** Null means every date: no window, or a term or choice that is not complete. */
export function resolveDueWindow(
  choice: DueChoice,
  term: { start: string | null; end: string | null },
  custom: { from?: string; to?: string },
): DayRange | null {
  if (choice === 'term') return isDay(term.start ?? undefined) && isDay(term.end ?? undefined) ? { from: term.start as string, to: term.end as string } : null
  if (choice === 'custom' && isDay(custom.from) && isDay(custom.to)) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }
  }
  return null
}
```

- [ ] **Step 4: Implement the builder**

Create `src/lib/reports/deliverables.ts`:

```ts
import type { Tone } from '../analyticsMath'
import type { DeliverableRow, DeliverableState } from '../types'
import { dayText } from './doc'
import type { Block, Cell, Column, ReportDoc, RichCell } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

export type DeliverableProject = { id: string; title: string; audience: 'group' | 'individual' }

const TONE: Record<DeliverableState, Tone> = { on_time: 'success', late: 'warning', missing: 'danger', not_due: 'pending' }

export function deliverableLabel(r: Pick<DeliverableRow, 'state' | 'days_late'>): string {
  switch (r.state) {
    case 'on_time':
      return 'On time'
    case 'late': {
      const n = r.days_late ?? 1
      return `Late (${n} ${n === 1 ? 'day' : 'days'})`
    }
    case 'missing':
      return 'Missing'
    default:
      return 'Not due yet'
  }
}

/** A grid cell: the label in its tone, and days late for a spreadsheet (0 on time, empty otherwise). */
export function deliverableCell(r: Pick<DeliverableRow, 'state' | 'days_late'>): RichCell {
  const exportValue = r.state === 'on_time' ? 0 : r.state === 'late' ? r.days_late ?? 1 : null
  return { value: deliverableLabel(r), tone: TONE[r.state], exportValue }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
const boardName = (r: DeliverableRow) => r.group_name ?? r.student_name ?? 'A board'
const columnLabel = (r: DeliverableRow) =>
  r.kind === 'hand_in'
    ? r.due_day ? `Hand-in (due ${dayText(r.due_day)})` : 'Hand-in (no due date)'
    : `${r.title} (due ${dayText(r.due_day as string)})`

const LEGEND: Block = {
  kind: 'table',
  id: 'legend',
  title: 'Legend',
  columns: [
    { key: 'state', label: 'State', type: 'status' },
    { key: 'meaning', label: 'Meaning', type: 'text' },
    { key: 'sheet', label: 'In Excel and CSV', type: 'text' },
  ],
  rows: [
    [{ value: 'On time', tone: 'success' }, 'Handed in, or every task done, by the end of the due day.', '0'],
    [{ value: 'Late (N days)', tone: 'warning' }, 'Done after the due day. N counts the days late.', 'N'],
    [{ value: 'Missing', tone: 'danger' }, 'Past due and not done.', 'Empty'],
    [{ value: 'Not due yet', tone: 'pending' }, 'Due later.', 'Empty'],
  ],
}

export function deliverablesDoc(input: ReportHead & {
  projects: DeliverableProject[]
  rows: DeliverableRow[]
  /** Null means every date. */
  window: DayRange | null
  notice?: string | null
}): ReportDoc {
  const { window } = input
  const wanted = new Set(input.projects.map((p) => p.id))
  const inWindow = (r: DeliverableRow) =>
    window === null || (r.due_day !== null && r.due_day >= window.from && r.due_day <= window.to)
  const shown = input.rows.filter((r) => wanted.has(r.project_id) && inWindow(r))

  const due = shown.filter((r) => r.state !== 'not_due')
  const count = (s: DeliverableState) => shown.filter((r) => r.state === s).length
  const rate = due.length ? Math.round((count('on_time') / due.length) * 1000) / 10 : null
  const blocks: Block[] = []
  if (input.notice) blocks.push({ kind: 'note', tone: 'info', text: input.notice })
  blocks.push({
    kind: 'kpis',
    items: [
      { label: 'On-time rate', value: rate ?? '—', unit: rate === null ? undefined : '%' },
      { label: 'On time', value: count('on_time') },
      { label: 'Late', value: count('late') },
      { label: 'Missing', value: count('missing') },
      { label: 'Not due yet', value: count('not_due') },
    ],
  })

  let grids = 0
  for (const p of input.projects) {
    const mine = shown.filter((r) => r.project_id === p.id)
    if (mine.length === 0) {
      if (input.projects.length > 1) blocks.push({ kind: 'note', tone: 'info', text: `Nothing on ${p.title} falls due in these dates.` })
      continue
    }
    // One column per deliverable: milestones by due day, then title; the hand-in last.
    const keyOf = (r: DeliverableRow) => `${r.kind}:${r.ref_id}`
    const firstOf = new Map<string, DeliverableRow>()
    for (const r of mine) if (!firstOf.has(keyOf(r))) firstOf.set(keyOf(r), r)
    const deliverables = [...firstOf.values()].sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'hand_in' ? 1 : -1
        : (a.due_day ?? '').localeCompare(b.due_day ?? '') || byName(a.title, b.title),
    )
    const boards = new Map<string, string>()
    for (const r of mine) boards.set(r.board_id, boardName(r))
    const cellAt = new Map(mine.map((r) => [`${r.board_id}|${keyOf(r)}`, r]))
    const columns: Column[] = [
      { key: 'who', label: p.audience === 'group' ? 'Group' : 'Student', type: 'text' },
      ...deliverables.map((d) => ({ key: keyOf(d), label: columnLabel(d), type: 'status' as const })),
    ]
    const rows = [...boards.entries()]
      .sort((a, b) => byName(a[1], b[1]))
      .map<Cell[]>(([id, name]) => [
        name,
        ...deliverables.map((d) => {
          const r = cellAt.get(`${id}|${keyOf(d)}`)
          return r ? deliverableCell(r) : null
        }),
      ])
    blocks.push({
      kind: 'table',
      id: `compliance-${p.id}`,
      title: input.projects.length > 1 ? p.title : 'Compliance',
      columns,
      rows,
    })
    grids++
  }

  if (grids === 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      text: 'No milestones or hand-ins fall due in these dates. Widen the dates or pick another project.',
    })
  } else {
    blocks.push(LEGEND)
  }

  return {
    header: {
      title: 'Deliverables & milestone compliance',
      subtitle: input.projects.length === 1 ? input.projects[0].title : 'All projects',
      classLine: input.classLine,
      rangeLabel: window ? rangeText(window) : 'Every date',
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [
        'A milestone is met when all its tasks are done by the end of its due day, Manila time.',
        "A hand-in is on time when it arrives by the project's deadline. Collabify keeps the latest hand-in time only.",
      ],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
```

`rangeText` gives "Oct 1 to Oct 10, 2026" (the B2 helper). If its real output differs, keep the helper and change the test's expected string to its output.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/reports`
Expected: PASS.

- [ ] **Step 6: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.

```bash
git add src/lib/reports/range.ts src/lib/reports/range.test.ts src/lib/reports/deliverables.ts src/lib/reports/deliverables.test.ts
git commit -m "Build the deliverables and milestone compliance report"
```

---

### Task 4: The Group progress report

**Files:**
- Create: `src/lib/reports/groupProgress.ts`, `src/lib/reports/groupProgress.test.ts`

**Interfaces:**
- Consumes:
  - `burnupSeries`, `manilaDay`, `BurnupPoint` (`src/lib/analyticsMath.ts`);
  - `TaskState`, `MemberLoad`, `ResultVerdict` (`src/lib/types.ts`);
  - `DeliverableRow`, `ReportSprint`, `BoardDecision` (Task 1);
  - `dayText`, `BurnupChart` (Task 2); `deliverableCell` (Task 3); `ReportHead`.
- Produces:
  - `type ProgressBoard = { board_id: string; name: string; submitted_at: string | null; submitted_by_name: string | null; result_verdict: ResultVerdict | null; task_count: number; done_pct: number }`
  - `type ProgressProject = { id: string; title: string; audience: 'group' | 'individual'; due_at: string | null; archived_at: string | null; created_at: string }`
  - `groupProgressDoc(input: ReportHead & { project: ProgressProject; boards: ProgressBoard[]; single: boolean; tasks: TaskState[]; members: MemberLoad[]; deliverables: DeliverableRow[]; sprints: ReportSprint[]; history: BoardDecision[]; today: string }): ReportDoc`
- **Inputs:**
  - `boards` holds only the boards being reported. `single` is true when one group was chosen.
  - The other arrays may hold rows for other boards; the builder keeps the boards' own.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/groupProgress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupProgressDoc } from './groupProgress'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { BoardDecision, DeliverableRow, MemberLoad, ReportSprint, TaskState } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const today = '2026-10-14'
const project = { id: 'p1', title: 'Lab 6', audience: 'group' as const, due_at: '2026-10-20T09:00:00Z', archived_at: null, created_at: '2026-09-01T00:00:00Z' }
const task = (over: Partial<TaskState>): TaskState => ({
  task_id: 't', title: 'T', status: 'todo', due_at: null, late: false, weight: 1, started_at: null, done_at: null,
  created_at: '2026-10-01T02:00:00Z', board_id: 'b1', class_id: 'c', project_id: 'p1', project_title: 'Lab 6',
  group_id: 'g1', group_name: 'Group 1', board_student_name: null, assignee_ids: ['s1'], assignee_names: 'Ana Cruz', ...over,
})
const tasks = [
  task({ task_id: 't1', status: 'done', done_at: '2026-10-05T02:00:00Z' }),
  task({ task_id: 't2', status: 'done', done_at: '2026-10-06T02:00:00Z', late: true, assignee_ids: ['s2'], assignee_names: 'Ben Diaz' }),
  task({ task_id: 't3', status: 'in_progress', due_at: '2026-10-10T09:00:00Z', assignee_ids: ['s2'] }),
  task({ task_id: 't4', status: 'todo', due_at: '2026-10-30T09:00:00Z', assignee_ids: [] }),
  task({ task_id: 'x1', board_id: 'b2', group_name: 'Group 2', status: 'done', done_at: '2026-10-07T02:00:00Z' }),
]
const member = (over: Partial<MemberLoad>): MemberLoad => ({
  class_id: 'c', project_id: 'p1', board_id: 'b1', group_name: 'Group 1', project_title: 'Lab 6', student_id: 's1',
  student_name: 'Ana Cruz', avatar_url: null, task_count: 1, done_count: 1, held_pct: 50, personal_pct: 50, group_size: 2,
  first_activity: null, last_finish: null, ...over,
})
const members = [
  member({}),
  member({ student_id: 's2', student_name: 'Ben Diaz', task_count: 2, done_count: 1, personal_pct: 50 }),
  member({ board_id: 'b2', group_name: 'Group 2', student_id: 's3', student_name: 'Cara Uy' }),
]
const milestone = (over: Partial<DeliverableRow>): DeliverableRow => ({
  kind: 'milestone', board_id: 'b1', project_id: 'p1', class_id: 'c', project_title: 'Lab 6', project_archived_at: null,
  group_name: 'Group 1', student_name: null, ref_id: 'm1', title: 'Draft', due_day: '2026-10-07', due_at: null,
  tasks: 2, done: 2, done_at: '2026-10-06T02:00:00Z', days_late: 0, state: 'on_time', ...over,
})
const deliverables = [
  milestone({}),
  milestone({ ref_id: 'm2', title: 'Model', due_day: '2026-10-21', tasks: 1, done: 0, done_at: null, days_late: null, state: 'not_due' }),
  milestone({ board_id: 'b2', group_name: 'Group 2', state: 'missing', done_at: null, days_late: null }),
]
const sprint = (over: Partial<ReportSprint>): ReportSprint => ({
  sprint_id: 'sp1', board_id: 'b1', class_id: 'c', project_id: 'p1', name: 'Sprint 1', starts_on: '2026-09-28',
  ends_on: '2026-10-04', state: 'completed', tasks: 3, done: 2, done_in_window: 1, ...over,
})
const sprints = [sprint({}), sprint({ sprint_id: 'sp2', name: 'Sprint 2', starts_on: '2026-10-12', ends_on: '2026-10-18', state: 'active', tasks: 2, done: 0, done_in_window: 0 })]
const history: BoardDecision[] = [
  { board_id: 'b1', verdict: 'returned', feedback: 'Add the model', decided_at: '2026-10-09T03:00:00Z', decided_by_name: 'Prof. Reyes' },
]
const b1 = { board_id: 'b1', name: 'Group 1', submitted_at: '2026-10-12T03:00:00Z', submitted_by_name: 'Ana Cruz', result_verdict: 'returned' as const, task_count: 4, done_pct: 50 }
const b2 = { board_id: 'b2', name: 'Group 2', submitted_at: null, submitted_by_name: null, result_verdict: null, task_count: 1, done_pct: 100 }
const base = { ...head, project, tasks, members, deliverables, sprints, history, today }
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value
const table = (doc: ReportDoc, title: string) => tableBlocks(doc).find((t) => t.title === title)

describe('groupProgressDoc, one group', () => {
  const doc = groupProgressDoc({ ...base, boards: [b1], single: true })
  it('heads the report with the group and project', () => {
    expect(doc.header.title).toBe('Group progress report')
    expect(doc.header.subtitle).toBe('Group 1 · Lab 6')
  })
  it('counts done, tasks, late tasks, the hand-in and the verdict', () => {
    expect(kpi(doc, 'Done')).toBe(50)
    expect(kpi(doc, 'Tasks')).toBe(4)
    expect(kpi(doc, 'Late tasks')).toBe(2) // t2 finished late, t3 open past its due day
    expect(kpi(doc, 'Hand-in')).toBe('Handed in Oct 12, 2026')
    expect(kpi(doc, 'Verdict')).toBe('Waiting for you') // handed in again after the return
  })
  it('charts scope against done over the project, to the due day', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart?.kind === 'chart' && chart.chart.kind === 'burnup' && chart.chart.endDay).toBe('2026-10-20')
    expect(chart?.kind === 'chart' && chart.summary).toBe('2 of 4 tasks done by Oct 14, 2026. The project is due Oct 20, 2026.')
  })
  it('lists members with share, finished, held and late', () => {
    expect(table(doc, 'Members')?.rows).toEqual([
      ['Ana Cruz', 50, 1, 1, 0],
      ['Ben Diaz', 50, 1, 2, 2],
    ])
  })
  it('lists milestones with the compliance state', () => {
    const t = table(doc, 'Milestones')!
    expect(t.rows.map((r) => [r[0], r[2], r[3]])).toEqual([['Draft', 2, 2], ['Model', 0, 1]])
    expect(t.rows[0][4]).toEqual({ value: 'On time', tone: 'success', exportValue: 0 })
  })
  it('lists sprints, with carried over only once a sprint has ended', () => {
    expect(table(doc, 'Sprints')?.rows).toEqual([
      ['Sprint 1', '2026-09-28', '2026-10-04', 3, 1, 2],
      ['Sprint 2', '2026-10-12', '2026-10-18', 2, 0, null],
    ])
  })
  it('lists every answer and the current hand-in, oldest first', () => {
    const t = table(doc, 'Feedback history')!
    expect(t.rows.map((r) => [r[0], typeof r[1] === 'object' && r[1] ? r[1].value : r[1], r[2], r[3]])).toEqual([
      ['2026-10-09T03:00:00Z', 'Returned', 'Add the model', 'Prof. Reyes'],
      ['2026-10-12T03:00:00Z', 'Handed in', null, 'Ana Cruz'],
    ])
  })
})

describe('groupProgressDoc, every group', () => {
  const doc = groupProgressDoc({ ...base, boards: [b2, b1], single: false })
  it('overviews every group in name order', () => {
    expect(doc.header.subtitle).toBe('Lab 6 · every group')
    const t = table(doc, 'Groups')!
    expect(t.columns[0].label).toBe('Group')
    expect(t.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2'])
    expect(kpi(doc, 'Handed in')).toBe('1 of 2')
  })
  it('draws one burnup per group on one scale', () => {
    const charts = doc.blocks.filter((b) => b.kind === 'chart')
    expect(charts).toHaveLength(2)
    const maxes = charts.map((c) => (c.kind === 'chart' && c.chart.kind === 'burnup' ? c.chart.yMax : 0))
    expect(maxes).toEqual([4, 4])
  })
  it('combines the tables with a group column', () => {
    expect(table(doc, 'Members')?.columns[0].label).toBe('Group')
    expect(table(doc, 'Milestones')?.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 1', 'Group 2'])
  })
})

describe('groupProgressDoc, edges', () => {
  it('leaves out members on an individual project and names the student', () => {
    const solo = { ...project, audience: 'individual' as const }
    const doc = groupProgressDoc({ ...base, project: solo, boards: [{ ...b2, name: 'Ana Cruz' }], single: false, members: [] })
    expect(table(doc, 'Members')).toBeUndefined()
    expect(table(doc, 'Students')?.columns[0].label).toBe('Student')
    expect(doc.header.subtitle).toBe('Lab 6 · every student')
  })
  it('says what is empty instead of drawing empty tables', () => {
    const doc = groupProgressDoc({ ...base, boards: [b2], single: true, tasks: [], members: [], deliverables: [], sprints: [], history: [] })
    const texts = doc.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))
    expect(texts).toEqual(expect.arrayContaining([
      'No tasks on this board yet, so there is nothing to chart.',
      'This project has no milestones.',
      'No sprints planned yet.',
      'Nothing handed in or answered yet.',
    ]))
    expect(tableBlocks(doc).map((t) => t.title)).toEqual([])
  })
  it('marks an archived project', () => {
    const doc = groupProgressDoc({ ...base, project: { ...project, archived_at: '2026-10-13T00:00:00Z' }, boards: [b1], single: true })
    expect(doc.blocks.some((b) => b.kind === 'note' && b.text === 'This project is archived. The report shows it as it was left.')).toBe(true)
  })
})
```

`b2` in the edge test has no members, so the Members table is absent there too. On a group project with no members, the builder adds the note "No members on this board." The edge test does not assert that note.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/reports/groupProgress.test.ts`
Expected: FAIL. `./groupProgress` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/reports/groupProgress.ts`:

```ts
import { burnupSeries, manilaDay } from '../analyticsMath'
import type { BurnupPoint } from '../analyticsMath'
import type { BoardDecision, DeliverableRow, MemberLoad, ReportSprint, ResultVerdict, TaskState } from '../types'
import { deliverableCell } from './deliverables'
import { dayText } from './doc'
import type { Block, Cell, Column, ReportDoc } from './doc'
import type { ReportHead } from './grading'

export type ProgressBoard = {
  board_id: string
  /** The group's name, or the student's on an individual project. */
  name: string
  submitted_at: string | null
  submitted_by_name: string | null
  result_verdict: ResultVerdict | null
  task_count: number
  done_pct: number
}

export type ProgressProject = {
  id: string
  title: string
  audience: 'group' | 'individual'
  due_at: string | null
  archived_at: string | null
  created_at: string
}

type Input = ReportHead & {
  project: ProgressProject
  boards: ProgressBoard[]
  single: boolean
  tasks: TaskState[]
  members: MemberLoad[]
  deliverables: DeliverableRow[]
  sprints: ReportSprint[]
  history: BoardDecision[]
  /** A Manila day. */
  today: string
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Finished after the deadline, or still open past its due day. */
const isLate = (t: TaskState, today: string) =>
  t.late || (t.status !== 'done' && t.due_at !== null && manilaDay(t.due_at) < today)

function handInText(b: ProgressBoard) {
  if (b.submitted_at) return `Handed in ${dayText(b.submitted_at)}`
  return b.result_verdict === 'returned' ? 'Returned, not handed in again' : 'Not handed in'
}

/** The standing answer. A hand-in after the last answer is waiting for one. */
function verdictCell(b: ProgressBoard, history: BoardDecision[]): Cell {
  const last = history.filter((h) => h.board_id === b.board_id).at(-1)
  if (b.submitted_at && (!last || Date.parse(last.decided_at) < Date.parse(b.submitted_at))) {
    return { value: 'Waiting for you', tone: 'pending' }
  }
  if (b.result_verdict === 'accepted') return { value: 'Accepted', tone: 'success' }
  if (b.result_verdict === 'returned') return { value: 'Returned', tone: 'warning' }
  return null
}

const cellValueText = (c: Cell) => (c !== null && typeof c === 'object' ? String(c.value) : c === null ? '—' : String(c))

function burnup(project: ProgressProject, tasks: TaskState[], today: string): BurnupPoint[] {
  if (tasks.length === 0) return []
  const from = tasks.reduce((min, t) => {
    const d = manilaDay(t.created_at)
    return d < min ? d : min
  }, manilaDay(project.created_at))
  let to = today
  if (project.archived_at) {
    const lastDone = tasks.reduce<string>((max, t) => (t.done_at && manilaDay(t.done_at) > max ? manilaDay(t.done_at) : max), from)
    const due = project.due_at ? manilaDay(project.due_at) : from
    to = [lastDone, due].reduce((a, b) => (b > a ? b : a))
    if (to > today) to = today
  }
  return burnupSeries(tasks, from, to)
}

function burnupSummary(points: BurnupPoint[], project: ProgressProject) {
  const last = points[points.length - 1]
  const due = project.due_at ? ` The project is due ${dayText(project.due_at)}.` : ''
  return `${last.done} of ${last.scope} tasks done by ${dayText(last.day)}.${due}`
}

export function groupProgressDoc(input: Input): ReportDoc {
  const { project, today } = input
  const group = project.audience === 'group'
  const who = group ? 'Group' : 'Student'
  const boards = [...input.boards].sort((a, b) => byName(a.name, b.name))
  const ids = new Set(boards.map((b) => b.board_id))
  const nameOf = new Map(boards.map((b) => [b.board_id, b.name]))
  const tasks = input.tasks.filter((t) => ids.has(t.board_id))
  const tasksOf = (id: string) => tasks.filter((t) => t.board_id === id)
  const history = input.history.filter((h) => ids.has(h.board_id))
  const single = input.single && boards.length === 1
  const lead = (id: string): Cell[] => (single ? [] : [nameOf.get(id) ?? null])
  const leadCol: Column[] = single ? [] : [{ key: 'who', label: who, type: 'text' }]

  const blocks: Block[] = []
  if (project.archived_at) blocks.push({ kind: 'note', tone: 'info', text: 'This project is archived. The report shows it as it was left.' })

  if (single) {
    const b = boards[0]
    blocks.push({
      kind: 'kpis',
      items: [
        { label: 'Done', value: b.done_pct, unit: '%' },
        { label: 'Tasks', value: b.task_count },
        { label: 'Late tasks', value: tasksOf(b.board_id).filter((t) => isLate(t, today)).length },
        { label: 'Hand-in', value: handInText(b) },
        { label: 'Verdict', value: cellValueText(verdictCell(b, history)) },
      ],
    })
  } else {
    const handedIn = boards.filter((b) => b.submitted_at).length
    blocks.push({
      kind: 'kpis',
      items: [
        { label: group ? 'Groups' : 'Students', value: boards.length },
        {
          label: 'Average done',
          value: boards.length ? Math.round((boards.reduce((s, b) => s + b.done_pct, 0) / boards.length) * 10) / 10 : 0,
          unit: '%',
        },
        { label: 'Handed in', value: `${handedIn} of ${boards.length}` },
        { label: 'Accepted', value: boards.filter((b) => b.result_verdict === 'accepted').length },
        { label: 'Late tasks', value: tasks.filter((t) => isLate(t, today)).length },
      ],
    })
    blocks.push({
      kind: 'table',
      id: 'groups',
      title: group ? 'Groups' : 'Students',
      columns: [
        { key: 'who', label: who, type: 'text' },
        { key: 'done', label: 'Done', type: 'percent' },
        { key: 'tasks', label: 'Tasks', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'handIn', label: 'Hand-in', type: 'text' },
        { key: 'verdict', label: 'Verdict', type: 'status' },
        { key: 'returns', label: 'Returns', type: 'number' },
      ],
      rows: boards.map<Cell[]>((b) => [
        b.name,
        b.done_pct,
        b.task_count,
        tasksOf(b.board_id).filter((t) => isLate(t, today)).length,
        handInText(b),
        verdictCell(b, history),
        history.filter((h) => h.board_id === b.board_id && h.verdict === 'returned').length,
      ]),
    })
  }

  // Burnups: one per board, on one scale when there are several.
  const series = boards.map((b) => ({ b, points: burnup(project, tasksOf(b.board_id), today) }))
  const yMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.scope)))
  for (const { b, points } of series) {
    if (points.length === 0) {
      if (single) blocks.push({ kind: 'note', tone: 'info', text: 'No tasks on this board yet, so there is nothing to chart.' })
      continue
    }
    blocks.push({
      kind: 'chart',
      id: `burnup-${b.board_id}`,
      title: single ? 'Scope and done' : `${b.name}: scope and done`,
      chart: { kind: 'burnup', points, endDay: project.due_at ? manilaDay(project.due_at) : null, ...(single ? {} : { yMax }) },
      summary: burnupSummary(points, project),
    })
  }

  if (group) {
    const people = input.members
      .filter((m) => ids.has(m.board_id))
      .sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || byName(a.student_name, b.student_name))
    if (people.length === 0) {
      blocks.push({ kind: 'note', tone: 'info', text: 'No members on this board.' })
    } else {
      blocks.push({
        kind: 'table',
        id: 'members',
        title: 'Members',
        columns: [
          ...leadCol,
          { key: 'member', label: 'Member', type: 'text' },
          { key: 'share', label: 'Share', type: 'percent' },
          { key: 'finished', label: 'Finished', type: 'number' },
          { key: 'held', label: 'Held', type: 'number' },
          { key: 'late', label: 'Late', type: 'number' },
        ],
        rows: people.map<Cell[]>((m) => [
          ...lead(m.board_id),
          m.student_name,
          m.personal_pct,
          m.done_count,
          m.task_count,
          tasksOf(m.board_id).filter((t) => t.assignee_ids.includes(m.student_id) && isLate(t, today)).length,
        ]),
      })
    }
  }

  const milestones = input.deliverables
    .filter((d) => d.kind === 'milestone' && ids.has(d.board_id))
    .sort((a, b) =>
      byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') ||
      (a.due_day ?? '').localeCompare(b.due_day ?? '') || byName(a.title, b.title))
  if (milestones.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'This project has no milestones.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'milestones',
      title: 'Milestones',
      columns: [
        ...leadCol,
        { key: 'milestone', label: 'Milestone', type: 'text' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'done', label: 'Done', type: 'number' },
        { key: 'tasks', label: 'Tasks', type: 'number' },
        { key: 'state', label: 'State', type: 'status' },
      ],
      rows: milestones.map<Cell[]>((d) => [...lead(d.board_id), d.title, d.due_day, d.done, d.tasks, deliverableCell(d)]),
      note: 'A milestone is met when all its tasks are done by the end of its due day.',
    })
  }

  const sprints = input.sprints
    .filter((s) => ids.has(s.board_id))
    .sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || a.starts_on.localeCompare(b.starts_on))
  if (sprints.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No sprints planned yet.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'sprints',
      title: 'Sprints',
      columns: [
        ...leadCol,
        { key: 'sprint', label: 'Sprint', type: 'text' },
        { key: 'starts', label: 'Starts', type: 'date' },
        { key: 'ends', label: 'Ends', type: 'date' },
        { key: 'committed', label: 'Committed', type: 'number' },
        { key: 'done', label: 'Done in sprint', type: 'number' },
        { key: 'carried', label: 'Carried over', type: 'number' },
      ],
      rows: sprints.map<Cell[]>((s) => {
        const ended = s.state === 'completed' || s.ends_on < today
        return [...lead(s.board_id), s.name, s.starts_on, s.ends_on, s.tasks, s.done_in_window, ended ? s.tasks - s.done_in_window : null]
      }),
      note: "Done in sprint counts work finished inside the sprint's dates. Carried over is the rest, counted once the sprint has ended.",
    })
  }

  type Event = { board_id: string; at: string; cell: Cell; feedback: string | null; by: string | null }
  const events: Event[] = [
    ...history.map((h) => ({
      board_id: h.board_id,
      at: h.decided_at,
      cell: h.verdict === 'accepted' ? { value: 'Accepted', tone: 'success' as const } : { value: 'Returned', tone: 'warning' as const },
      feedback: h.feedback || null,
      by: h.decided_by_name,
    })),
    ...boards
      .filter((b) => b.submitted_at)
      .map((b) => ({ board_id: b.board_id, at: b.submitted_at as string, cell: { value: 'Handed in', tone: 'pending' as const }, feedback: null, by: b.submitted_by_name })),
  ].sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || Date.parse(a.at) - Date.parse(b.at))
  if (events.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing handed in or answered yet.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'history',
      title: 'Feedback history',
      columns: [
        ...leadCol,
        { key: 'at', label: 'When', type: 'datetime' },
        { key: 'event', label: 'Event', type: 'status' },
        { key: 'feedback', label: 'Feedback', type: 'text' },
        { key: 'by', label: 'By', type: 'text' },
      ],
      rows: events.map<Cell[]>((e) => [...lead(e.board_id), e.at, e.cell, e.feedback, e.by]),
      note: 'Every answer is kept. Collabify keeps the latest hand-in time only.',
    })
  }

  return {
    header: {
      title: 'Group progress report',
      subtitle: single ? `${boards[0].name} · ${project.title}` : `${project.title} · every ${group ? 'group' : 'student'}`,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: ['Counts are tasks recorded in Collabify. A flag is a prompt for a conversation, not a verdict.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
```

**Notes on the code:**
- The test's "Waiting for you" case is b1: returned on Oct 9, then handed in again on Oct 12.
- In a single-group report, `lead` and `leadCol` are empty. A single report's Feedback history therefore has four columns, and its first cell is the time. That is what the one-group test reads (`r[0]` is the time).

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/reports`
Expected: PASS.
- If a hand-computed expectation is off by a fixture detail (for example, how `burnupSeries` carries work from before `from`), fix the **fixture or the expectation**, not the rule.
- Explain any such change in the report.

- [ ] **Step 5: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.

```bash
git add src/lib/reports/groupProgress.ts src/lib/reports/groupProgress.test.ts
git commit -m "Build the group progress report"
```

---

### Task 5: The two reports on the Reports page

**Files:**
- Modify: `src/pages/app/reports/reportKind.ts` (+ `reportKind.test.ts`)
- Modify: `src/pages/app/reports/useReports.ts`, `src/pages/app/reports/useReportDoc.ts`, `src/pages/app/reports/Reports.tsx`

**Interfaces:**
- Consumes:
  - Tasks 1–4;
  - B2's `resolveRange` pattern, the `paced` live throttle, and `checkInSig` in `useReportDoc.ts`;
  - `customFrom` / `customTo` / `setCustomRange` (`rfrom` / `rto`) in `useReports.ts`.
- Produces:
  - `ReportKind` gains `'progress' | 'deliverables'`, with `NEEDS` set to `['class', 'project']` for both.
  - `useReports` gains `dueChoice` / `setDueChoice`, held in the URL under `rdue`.

- [ ] **Step 1: The kinds**

In `reportKind.ts`:
- Add `'progress' | 'deliverables'` to `ReportKind`.
- Add `progress: ['class', 'project']` and `deliverables: ['class', 'project']` to `NEEDS`.

In `reportKind.test.ts`, add a case: `parseReportKind('progress')` returns `'progress'`, and `parseReportKind('deliverables')` returns `'deliverables'`.

- [ ] **Step 2: Choices in `useReports.ts`**

- **Project:** `projectFits` allows `'all'` for `grading` **and** `deliverables`.
- **Due window:**
  - Read: `const dueChoice = parseDueChoice(params.get('rdue'))`.
  - `setDueChoice(v)` patches `rdue`: `''` for `'all'`, otherwise `v`. It also clears `rfrom` and `rto` unless `v === 'custom'`.
  - Return `dueChoice` and `setDueChoice`.
- **`choose(next)`:**
  - Clears `rdue` when leaving `deliverables`.
  - Treats `deliverables` as a dated kind when deciding whether to clear `rfrom` / `rto`. Leaving `checkin`, `notes` or `deliverables` for a kind that is none of them clears both.
- **Group (`rgroup` / `boardId`):** optional for `progress`. A `boardId` that is not on the chosen project means "every group". The build decides that (Step 3); the URL is left alone.

- [ ] **Step 3: Loading in `useReportDoc.ts`**

- **The key:**
  - Extend `currentKey` with `dueChoice`, and the resolved due window's `from` / `to` (or `'all'`), for `deliverables`.
  - `progress` already keys on `projectId` and `boardId`.
- **Live tables (per kind, as B2 does):**
  - progress: `['project_tasks', 'task_assignees', 'board_results', 'project_milestones', 'board_sprints']`
  - deliverables: `['project_tasks', 'board_results', 'project_milestones']`
  - `enabled` covers both new kinds. They use the 1.5 s pace.
- **Signature:**
  - Extend the B2 `checkInSig` so that, for `progress` and `deliverables`, it also covers the class's boards (`id`, `submitted_at`, `result_verdict`, `result_at`, `done_pct`, `task_count`) and projects (`title`, `due_at`, `archived_at`).
  - Hand-ins and verdicts arrive through the class loader.
- **The `progress` branch:**

```ts
} else if (kind === 'progress') {
  const p = projects.find((x) => x.id === projectId)
  if (!p) throw new Error('Pick a project to see its groups.')
  const onProject = allBoards.filter((b) => b.project_id === p.id)
  const chosen = onProject.find((b) => b.id === boardId)
  const shown = chosen ? [chosen] : onProject
  const [tasks, members, deliverables, sprints, history] = await Promise.all([
    classTaskStates(cls.class_id), classMemberLoad(cls.class_id), listDeliverables(cls.class_id),
    listReportSprints(cls.class_id), boardHistoryFor(shown.map((b) => b.id)),
  ])
  next = groupProgressDoc({
    ...head, today, single: Boolean(chosen),
    project: { id: p.id, title: p.title, audience: p.audience, due_at: p.due_at, archived_at: p.archived_at, created_at: p.created_at },
    boards: shown.map((b) => ({
      board_id: b.id, name: b.group_name ?? b.student_name ?? 'A board', submitted_at: b.submitted_at,
      submitted_by_name: b.submitted_by_name, result_verdict: b.result_verdict, task_count: b.task_count, done_pct: b.done_pct,
    })),
    tasks, members, deliverables, sprints, history,
  })
}
```

- **The `deliverables` branch:**

```ts
} else if (kind === 'deliverables') {
  const chosen = projectId === 'all' ? projects : projects.filter((x) => x.id === projectId)
  const rows = await listDeliverables(cls.class_id)
  const window = resolveDueWindow(dueChoice, { start: cls.term_start, end: cls.term_end }, { from: customFrom, to: customTo })
  next = deliverablesDoc({
    ...head, rows, window,
    projects: chosen.map((x) => ({ id: x.id, title: x.title, audience: x.audience })),
    notice: dueChoice === 'term' && window === null ? 'This class has no term dates, so every date is shown.' : null,
  })
}
```

- **Data:**
  - `projects` and `allBoards` are the class's full, unnarrowed lists from `useReports`, as in B2.
  - Check that the class row (`cls`) carries `term_end` as well as `term_start`. `ClassReport` does. If the field name differs, use the real one.

- [ ] **Step 4: Picker controls (`Reports.tsx`)**

- **`projectOptions`:**
  - For `deliverables`: `[{ value: 'all', label: 'All projects' }, ...every project]`.
  - For `progress`: every project.
- **`extras` for `progress`:** a group select over `r.boards` (the chosen project's boards).
  - The option labels are `group_name ?? student_name`.
  - The first option is `''`, labelled "Every group", or "Every student" when the project is individual.
  - It is bound to `r.boardId` / `r.setBoardId`.
  - Use the B2 group select's field classes and `aria-label="Group"`.
- **`extras` for `deliverables`:** a "Dates" select over `DUE_CHOICES`, bound to `r.dueChoice` / `r.setDueChoice`.
  - When it is `custom`, show the B2 From/To date inputs (bound to `r.customFrom` / `r.customTo` through `r.setCustomRange`).
  - Show the hint "Set both dates. Until then every date is shown." while either is empty.

- [ ] **Step 5: The catalogue and previews (`Reports.tsx`)**

Add a group between "For check-ins" and "Older reports":

```ts
{
  group: 'For tracking projects',
  items: [
    { kind: 'progress', label: 'Group progress report', body: 'One group, or every group, on a project: how far along, who did the work, milestones, sprints and every answer you gave.' },
    { kind: 'deliverables', label: 'Deliverables & milestone compliance', body: 'Every milestone and hand-in, group by group: on time, late, missing or not due yet.' },
  ],
},
```

- **Preview path:** the new kinds use the same path as `grading`, `peer`, `checkin` and `notes`: spinner, error with Retry, `ReportDocView`, and the Export menu. Add them to the "new-style kind" list.
- **Export base names:** `group-progress` and `deliverables`, through the existing `reportBase(kind, subtitle, classLine)` mapping.

- [ ] **Step 6: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.
Expected: all clean.

```bash
git add src/pages/app/reports/reportKind.ts src/pages/app/reports/reportKind.test.ts src/pages/app/reports/useReports.ts src/pages/app/reports/useReportDoc.ts src/pages/app/reports/Reports.tsx
git commit -m "Add group progress and deliverables compliance to Reports"
```

---

## After the tasks (controller)

1. **Browser check, as faculty.** It only reads, so it needs no approval.
   - **Group progress:**
     - Lab 6 with Group 1, then every group;
     - Midterm Exam (individual), every student;
     - an archived project if the class has one;
     - check the burnups, the four tables, and the empty notes.
   - **Compliance:**
     - QM with all projects and Every date, then This term, then a custom range that holds nothing (the empty sentence shows);
     - check the chips and the Legend.
   - **Both reports:**
     - run the Excel and Word writers in the page (as in B1/B2), without downloading. The compliance grid reads as numbers, with a Legend sheet;
     - check light and dark, and widths of 375, 768 and 1440.
2. **Ship:**
   - fast-forward to `main` and push;
   - add a "Phase B3" section to `handoff.md`;
   - update the memory with B3 live, next B4.

---

## Self-review

- **Spec coverage (B3):**

  | Spec item | Where |
  |---|---|
  | Group progress options (class, project, one or all groups) | Task 5 |
  | Group progress KPIs: % done, tasks, late, hand-in state, verdict | Task 4 |
  | Burnup over the project's span | Tasks 2 and 4 |
  | Members, Milestones (met / missed / upcoming), Sprints, Feedback history (every decision, plus the current hand-in, oldest first) | Task 4 (ruling 4 for the state labels) |
  | Compliance options (class, project or all, range) | Tasks 3 and 5 (ruling 7) |
  | Compliance grid: groups or students × milestones then the hand-in; four states as chips | Task 3 |
  | Compliance KPIs: on-time rate, late, missing | Task 3 |
  | Excel: numbers plus a Legend sheet | Tasks 2 and 3 (ruling 8) |
  | Rules: milestone met by the end of the Manila due day; hand-in uses the current `submitted_at`; returned and not resubmitted is missing past due | Task 1 |
  | New view `report_deliverables` (staff-only, archived kept, states tested) | Task 1 |
  | Archived data kept | Task 1 views, ruling 1 |
- **Placeholders:** none.
  - Task 5 names every key, branch and table list.
  - Its picker JSX follows the B2 extras, which the implementer reads in `Reports.tsx`.
- **Type consistency:**
  - `DeliverableRow` comes from Task 1 and is used by Tasks 3 and 4.
  - `deliverableCell` comes from Task 3 and is used by Task 4.
  - `BurnupChart`, `exportValue` and `dayText` come from Task 2 and are used by Tasks 3 and 4.
  - `DueChoice` comes from Task 3 and is used by Task 5.
  - `ProgressBoard` is built in Task 5 from `BoardSummary` fields that exist: `group_name`, `student_name`, `submitted_at`, `submitted_by_name`, `result_verdict`, `task_count`, `done_pct`.
- **Review Focus:** each of the five items has its test in the task noted beside it.
