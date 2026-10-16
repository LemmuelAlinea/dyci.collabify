# Phase B4: Formal Term Record, Activity Log and Retiring the Old Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase B.
- Add the **Formal term record**: one class, or every class taught, for the course file and accreditation.
- Add the **Activity log**: every task event in a date range, for settling disputes.
- Retire the seven old print sheets. Their links open the replacement reports.

**Architecture:** Both reports reuse the B1–B3 engine: a pure builder returns a `ReportDoc`, and `ReportDocView` plus the four exporters draw it.
- **Data:** one new SQL file, `supabase/report-events.sql`, holding the staff-only view `report_task_events` and an index on `task_events (at)`. The term record reads only what exists: `report_class_summary`, `report_week_coverage`, `score_sheet`, `class_note_log`, `class_overview` and the class space's members.
- **Page:** the catalogue gains a "For the record" group. The class select gains **Every class** for the term record. Old `?report=` values redirect.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind tokens, Vitest, Supabase Postgres (one view, one index).

**Spec:** `docs/superpowers/specs/2026-10-13-phase-b-reports-design.md`. This plan covers "B4 reports", "Retiring the old sheets (B4)", "Shared rules" and "Testing".
- B1, B2 and B3 are live on main (`2147637`).
- Read the rulings in `docs/superpowers/plans/2026-10-14-phase-b3-progress-deliverables.md` and the "Phase B3" section at the end of `docs/handoff.md`.

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | `BoardSheet.tsx` and `ContributionSheet.tsx` stay. Only the other five old sheets and `components/reports/csv.ts` are deleted. | The spec deletes a sheet "once nothing imports it", and `StudentReports.tsx` (the students' page, which the spec leaves untouched) imports those two. | None. |
| 2 | `useReports.ts` stays. Only its old-sheet loads go: week coverage, board tasks, the verdict reason and reassignments. | It holds the picker state every new report uses. It is not an old-sheet file. | None. |
| 3 | **Every class** is a choice in the class select, kept as `rclass=all`. It is offered for the term record only, and never inside a class page. Any other report treats `all` as no choice. | The spec's "no class chosen" needs a value. Without one, the page falls back to the first class. | One more special value in the address. |
| 4 | **Hand-in rate** = boards handed in (or accepted) ÷ boards. **Accepted rate** = boards accepted ÷ boards. Both count only boards that `countableBoard` keeps, on projects that ran (archived, or released to students). The every-class version loads each class's boards, so both versions agree. | This is the B3 rule for empty groups and students who left. Using the same denominator for both rates reads as a funnel (accepted ≤ handed in). | A professor who wants accepted ÷ handed in divides the two. |
| 5 | Projects that have not been released yet (a future `release_at`, not archived) are left out of the term record, and a footer line says so. | They have not run. | None. |
| 6 | Course, section, term, status, the professor and co-teachers go in a two-column **Class** table, not the sheet header. | `ReportDoc.header` has three lines. A table also reaches Excel and Word. | None. |
| 7 | **Co-teachers** are the class space's faculty at Owner or Manager, minus the class's own professor. This is the `is_class_professor` rule (`supabase/one-workplace.sql`). | It is how the database decides who teaches. | None. |
| 8 | The term record keeps the old Class term report's task counts (a **Work** table) and adds **Syllabus weeks covered** and **Work finished** to its figures. | Retiring that sheet must not lose what it printed. Analytics drops ended classes, so this is the only place they remain. | Two more figures. |
| 9 | The Activity log lists **newest first**, adds a **Detail** column, and filters "who" by the student who acted (`actor_id`). | Capped at 500 on screen, oldest-first would hide the recent events a dispute is usually about. Detail carries what was assigned, logged or commented. | Print reads newest first. |
| 10 | Events on **archived** tasks are left out. | The `project_tasks` select policy hides archived tasks from everyone (`supabase/task-archive.sql`), and archived tasks stop counting in every report. | A dispute about an archived task needs the task restored first. The footer says so. |
| 11 | The Activity log's dates use the intervention log's choices: default **Last 30 days**, keys `rrange`, `rfrom`, `rto`. Event kinds are kept in `revents`. Project, group and who reuse `rproject`, `rgroup` and `rstudent`. | Same picker as the log beside it. | None. |
| 12 | `report-events.sql` adds `create index if not exists task_events_at_idx on public.task_events (at)`. | The log reads by class and date range. Today the only index is `(task_id, at desc)`. | One small index. |

## Global Constraints

- **Staff-only, archived kept.**
  - `report_task_events` is `security_invoker`, filtered by `public.is_class_professor(p.class_id)`, and returns nothing to students.
  - Archived projects and ended classes stay in.
- **New SQL.**
  - `supabase/report-events.sql` goes in the `scripts/schema-drift.mjs` ORDER after `report-deliverables`. It goes on both rebuild lines in `docs/07-backup.md` after `supabase/report-deliverables.sql`.
  - It revokes from `anon` inline. Re-run `supabase/anon-lockdown.sql` after applying it.
- **Live database.** It is the only database.
  - Apply only the new file and `anon-lockdown.sql`. Test files roll back.
  - Never re-run `results.sql`, `analytics.sql`, `admin-program.sql`, `task-archive.sql` or `automation.sql` as a whole.
- **Days are Manila days.**
  - Use `manilaDay` and `addDays` from `src/lib/analyticsMath.ts`.
  - Display with `dayText` or the column types (`date`, `datetime`) in `src/lib/reports/doc.ts`.
- **Colours** come only from tokens (`Tone`: `success`, `warning`, `danger`, `pending`). No raw hex.
- **Copy** uses sentence case. No "please", no "successfully", no exclamation marks. An empty result says why and what would fill it.
- **Exact strings:**
  - Catalogue group: "For the record".
  - Catalogue entries:
    - "Formal term record": "The term on one record for the course file or accreditation: enrolment, projects, hand-ins, syllabus coverage and interventions, with signature lines."
    - "Activity log": "Every change to every task in a date range: who did what, and when. The record for settling a dispute."
  - Class select choice: "Every class".
  - Term record titles: "Formal term record"; every-class subtitle "Every class you teach".
  - Signatures: "Prepared by" (the signed-in professor) and "Reviewed by (program chair)" (blank).
  - Term record footer lines:
    - "Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students."
    - "Averages count released finals only."
    - "Projects not yet released to students are left out." (only when one was)
  - Term record empty notes: "No projects were run in this class.", "This class has no syllabus weeks yet.", "No notes were written for this class.", "You have no classes yet."
  - Coverage note: "Coverage means a project was set against that syllabus week. It does not measure what was taught in the room."
  - Activity log footer lines: "Times are Manila time, to the minute." and "Archived and deleted tasks are left out, and so is their history."
  - Activity log empty: "No activity in these dates. Widen the dates or clear a filter."
  - Cap line (already drawn by `ReportDocView`): "Showing 500 of N. Excel and CSV include every row."
- **React rules.** A `.tsx` file exports components only. Pure helpers go in `.ts` files.
- **Before calling a task done,** run `npm run build`, `npx eslint src` and `npx vitest run`. `npm run lint` fails only on untracked `launch-video/` scripts; ignore that.
- **Staging, editing and hooks:**
  - Stage files by name. Never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`.
  - Use the Edit/Write tools, never PowerShell `Set-Content`.
  - Never bypass git hooks.
  - End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An old bookmarked link**, such as `?report=class_record&rclass=X`. It must open the grade book (`rproject=all`), not a grading sheet waiting for a project. Pinned in Task 5 (`legacyRedirect`, every one of the seven).
2. **Every class, then another report.** `rclass=all` must never reach a report that needs one class; that report falls back to the first class. Pinned in Task 4 (`chosenClass`).
3. **Activity filters left in the address from another class** (a group, project or student id not in this class) read as no filter, not as an empty log. Pinned in Task 2 (`activityFilters`).
4. **A project or class with no counted boards** shows "—" for its rates, never 0% or NaN. Pinned in Task 3.
5. **Events at Manila midnight.** An event at 23:59 Manila on the range's last day is in; 00:00 the next day is out. Pinned in Task 2.

---

### Task 1: The `report_task_events` view and its read

**Files:**
- Create: `supabase/report-events.sql`
- Create: `supabase/tests/report-events.test.sql`
- Modify: `src/lib/types.ts` (add `ReportEventRow` after `DeliverableRow`)
- Modify: `src/lib/api/reportReads.ts` (add `listTaskEvents`)
- Modify: `scripts/schema-drift.mjs:32` (ORDER)
- Modify: `docs/07-backup.md` (both rebuild lines, and one paragraph after the `report-deliverables.sql` paragraph near line 221)

**Interfaces:**
- Produces:
  - `type ReportEventRow = { id: string; at: string; kind: TaskEventKind; detail: string; actor_id: string | null; actor_name: string | null; task_id: string; task_title: string; board_id: string; board_name: string | null; project_id: string; project_title: string; project_archived_at: string | null; class_id: string }`
  - `listTaskEvents(classId: string, range: { from: string; to: string }): Promise<ReportEventRow[]>`. `from` and `to` are Manila days, both included. Rows come oldest first.

- [ ] **Step 1: Write the SQL test**

Create `supabase/tests/report-events.test.sql`:

```sql
-- report_task_events — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-events.test.sql

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

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_set uuid; v_g1 uuid;
  v_proj uuid; v_solo uuid; v_b1 uuid; v_sa uuid;
  v_t uuid; v_ts uuid; v_tx uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_ex uuid;
  v_a_name text;
  r record;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') into v_a_name
    from public.profiles where id = v_a;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-ev-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-ev-g1') returning id into v_g1;
  insert into public.group_members (group_id, set_id, student_id) values (v_g1, v_set, v_a);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-ev-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_b1 from public.project_boards where project_id = v_proj and group_id = v_g1;

  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-ev-solo', 'activity', 1, 2, 'individual', null)
  returning id into v_solo;
  perform public.ensure_project_boards(v_solo);
  select id into v_sa from public.project_boards where project_id = v_solo and student_id = v_a;

  insert into public.project_tasks (board_id, title, status) values (v_b1, 'zz ev task', 'todo') returning id into v_t;
  insert into public.project_tasks (board_id, title, status) values (v_sa, 'zz solo task', 'todo') returning id into v_ts;
  insert into public.project_tasks (board_id, title, status) values (v_b1, 'zz archived task', 'todo') returning id into v_tx;

  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_t, v_a, 'claimed', '', now() - interval '2 days') returning id into v_e1;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_t, v_prof, 'commented', 'zz looks fine', now() - interval '1 day') returning id into v_e2;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_ts, v_a, 'finished', '', now() - interval '3 hours') returning id into v_e3;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_tx, v_a, 'started', '', now() - interval '1 day') returning id into v_ex;

  -- The archive columns move only inside the archive functions; this opens them for one update.
  perform set_config('collabify.task_archive_op', 'on', true);
  update public.project_tasks set archived_at = now() where id = v_tx;
  perform set_config('collabify.task_archive_op', '', true);

  perform pg_temp.act_as(v_prof);

  select * into r from public.report_task_events where id = v_e1;
  perform pg_temp.must_be('a professor reads an event with its task, group, project and actor',
    r.task_title = 'zz ev task' and r.board_name = 'zz-ev-g1' and r.project_title = 'zz-ev-proj'
    and r.project_id = v_proj and r.class_id = v_class and r.kind = 'claimed'
    and r.actor_id = v_a and r.actor_name = v_a_name and r.board_id = v_b1 and r.task_id = v_t);
  select * into r from public.report_task_events where id = v_e2;
  perform pg_temp.must_be('the detail travels with the event', r.detail = 'zz looks fine' and r.actor_id = v_prof);
  select * into r from public.report_task_events where id = v_e3;
  perform pg_temp.must_be('an individual board is named for its student',
    r.board_name = v_a_name and r.project_id = v_solo and r.kind = 'finished');
  perform pg_temp.must_be('an archived task leaves the log with its history',
    not exists (select 1 from public.report_task_events where id = v_ex));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no events',
    (select count(*) from public.report_task_events where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an archived project in an ended class keeps its events',
    (select count(*) from public.report_task_events where id in (v_e1, v_e2)) = 2
    and (select project_archived_at is not null from public.report_task_events where id = v_e1));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('anon cannot read the view',
    not has_table_privilege('anon', 'public.report_task_events', 'select'));
end $$;

rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/db.mjs supabase/tests/report-events.test.sql`
Expected: FAIL with `relation "public.report_task_events" does not exist`.

- [ ] **Step 3: Write the view**

Create `supabase/report-events.sql`:

```sql
-- Collabify — every task event, with names, for the activity log.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/report-events.sql
-- Requires: tasks.sql, task-detail.sql, task-archive.sql. Re-run supabase/anon-lockdown.sql afterwards.

/**
 * task_events holds ids. A log printed to settle a dispute needs the task, the
 * group or student the board belongs to, the project, and who acted. Staff
 * only (task_events' own policy still applies through security_invoker), and
 * ended classes stay in: a dispute is often raised after the term.
 *
 * An archived task is hidden by project_tasks' select policy, so its events
 * leave with it, as archived work leaves every report.
 */

begin;

-- The log reads one class over a date range.
create index if not exists task_events_at_idx on public.task_events (at);

drop view if exists public.report_task_events;

create view public.report_task_events
with (security_invoker = true) as
select e.id, e.at, e.kind::text as kind, e.detail, e.actor_id,
       nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '') as actor_name,
       t.id as task_id, t.title as task_title,
       b.id as board_id,
       coalesce(g.name, nullif(btrim(coalesce(bs.first_name, '') || ' ' || coalesce(bs.last_name, '')), '')) as board_name,
       p.id as project_id, p.title as project_title, p.archived_at as project_archived_at,
       p.class_id
  from public.task_events e
  join public.project_tasks t on t.id = e.task_id
  join public.project_boards b on b.id = t.board_id
  join public.projects p on p.id = b.project_id
  left join public.groups g on g.id = b.group_id
  left join public.profiles bs on bs.id = b.student_id
  left join public.profiles a on a.id = e.actor_id
 where public.is_class_professor(p.class_id);

revoke all on public.report_task_events from anon;
grant select on public.report_task_events to authenticated;

commit;
```

- [ ] **Step 4: Apply it to the live database and run the test**

Run: `node scripts/db.mjs supabase/report-events.sql supabase/anon-lockdown.sql`
Expected: `Done.` with no error.

Run: `node scripts/db.mjs supabase/tests/report-events.test.sql`
Expected: 7 `PASS` lines and no `FAIL`.

- [ ] **Step 5: Add the row type and the read**

In `src/lib/types.ts`, add after the `DeliverableRow` type:

```ts
/** report_task_events: one task event with the names an audit log prints. Staff only. */
export type ReportEventRow = {
  id: string
  at: string
  kind: TaskEventKind
  detail: string
  actor_id: string | null
  /** Null when the account is gone. */
  actor_name: string | null
  task_id: string
  task_title: string
  board_id: string
  /** The group, or the student on an individual board. */
  board_name: string | null
  project_id: string
  project_title: string
  project_archived_at: string | null
  class_id: string
}
```

In `src/lib/api/reportReads.ts`, add `ReportEventRow` to the type import, add `import { addDays } from '../analyticsMath'`, and append:

```ts
/** Every task event in the class between two Manila days, both included, oldest first. */
export async function listTaskEvents(classId: string, range: { from: string; to: string }) {
  const start = new Date(`${range.from}T00:00:00+08:00`).toISOString()
  const end = new Date(`${addDays(range.to, 1)}T00:00:00+08:00`).toISOString()
  return pageAll<ReportEventRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('report_task_events')
      .select('*')
      .eq('class_id', classId)
      .gte('at', start)
      .lt('at', end)
      .order('at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ReportEventRow[]
  })
}
```

- [ ] **Step 6: Record the file in the rebuild order**

In `scripts/schema-drift.mjs`, change `report-notes report-deliverables task-stages` to `report-notes report-deliverables report-events task-stages`.

In `docs/07-backup.md`, on both rebuild lines (26 and 53), change `supabase/report-deliverables.sql supabase/task-stages.sql` to `supabase/report-deliverables.sql supabase/report-events.sql supabase/task-stages.sql`. After the paragraph that starts "`report-deliverables.sql` runs after `report-notes.sql`.", add:

```markdown
`report-events.sql` runs after `report-deliverables.sql`. It holds `report_task_events` (every task event with its task, group or student, project and actor; staff-only, ended classes kept) for the Activity log, and an index on `task_events (at)`.
```

- [ ] **Step 7: Build and commit**

Run: `npm run build` and `npx eslint src`
Expected: both clean.

```bash
git add supabase/report-events.sql supabase/tests/report-events.test.sql src/lib/types.ts src/lib/api/reportReads.ts scripts/schema-drift.mjs docs/07-backup.md
git commit -m "$(cat <<'EOF'
Add the staff-only task event view the activity log reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The Activity log builder

**Files:**
- Create: `src/lib/reports/activityLog.ts`
- Test: `src/lib/reports/activityLog.test.ts`

**Interfaces:**
- Consumes: `ReportEventRow` (Task 1); `ReportHead` from `./grading`; `DayRange`, `rangeText` from `./range`; `manilaDay` from `../analyticsMath`.
- Produces:
  - `EVENT_CAP = 500`
  - `EVENT_META: Record<TaskEventKind, { label: string; tone: Tone }>`
  - `type ActivityFilters = { kinds: TaskEventKind[]; projectId: string; boardId: string; actorId: string }`
  - `activityFilters(raw: ActivityFilters, known: { projects: ReadonlySet<string>; boards: ReadonlySet<string>; actors: ReadonlySet<string> }): ActivityFilters`
  - `activityLogDoc(input: ReportHead & { range: DayRange; events: ReportEventRow[]; filters: ActivityFilters; labels: { project: string | null; board: string | null; actor: string | null } }): ReportDoc`

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/activityLog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EVENT_CAP, activityFilters, activityLogDoc } from './activityLog'
import type { ActivityFilters } from './activityLog'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { ReportEventRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 16, 2026' }
const range = { from: '2026-10-01', to: '2026-10-15' }
const none: ActivityFilters = { kinds: [], projectId: '', boardId: '', actorId: '' }
const labels = { project: null, board: null, actor: null }

const ev = (over: Partial<ReportEventRow>): ReportEventRow => ({
  id: 'e', at: '2026-10-10T02:00:00Z', kind: 'claimed', detail: '', actor_id: 's1', actor_name: 'Ana Cruz',
  task_id: 't1', task_title: 'Write the model', board_id: 'b1', board_name: 'Group 1',
  project_id: 'p1', project_title: 'Lab 6', project_archived_at: null, class_id: 'c', ...over,
})
const events = [
  ev({ id: 'a', at: '2026-10-02T01:00:00Z', kind: 'created', actor_id: 'prof', actor_name: 'Prof. Reyes' }),
  ev({ id: 'b', at: '2026-10-05T01:00:00Z', kind: 'claimed' }),
  ev({ id: 'c', at: '2026-10-09T01:00:00Z', kind: 'finished', board_id: 'b2', board_name: 'Group 2', actor_id: 's2', actor_name: 'Ben Lim' }),
  ev({ id: 'd', at: '2026-10-11T01:00:00Z', kind: 'commented', detail: 'Looks fine', project_id: 'p2', project_title: 'Midterm', board_id: 'b3', board_name: 'Ana Cruz' }),
]
const doc = (over: Partial<Parameters<typeof activityLogDoc>[0]> = {}): ReportDoc =>
  activityLogDoc({ ...head, range, events, filters: none, labels, ...over })
const table = (d: ReportDoc) => tableBlocks(d)[0]

describe('activityLogDoc', () => {
  it('lists every event in the range, newest first', () => {
    expect(table(doc()).rows.map((r) => r[3])).toEqual(['Write the model', 'Write the model', 'Write the model', 'Write the model'])
    expect(table(doc()).rows.map((r) => r[0])).toEqual([
      '2026-10-11T01:00:00Z', '2026-10-09T01:00:00Z', '2026-10-05T01:00:00Z', '2026-10-02T01:00:00Z',
    ])
  })
  it('prints time, who, event, task, group, project and detail', () => {
    const t = table(doc())
    expect(t.columns.map((c) => c.label)).toEqual(['Time', 'Who', 'Event', 'Task', 'Group or student', 'Project', 'Detail'])
    expect(t.columns[0].type).toBe('datetime')
    expect(t.rows[0]).toEqual([
      '2026-10-11T01:00:00Z', 'Ana Cruz', { value: 'Commented', tone: 'pending' }, 'Write the model', 'Ana Cruz', 'Midterm', 'Looks fine',
    ])
    expect(t.rows[1][2]).toEqual({ value: 'Finished', tone: 'success' })
    expect(t.rows[3][6]).toBeNull()
  })
  it('says when the account behind an event is gone', () => {
    const t = table(doc({ events: [ev({ actor_id: null, actor_name: null })] }))
    expect(t.rows[0][1]).toBe('Not recorded')
  })
  it('tags a project that has been archived', () => {
    const t = table(doc({ events: [ev({ project_archived_at: '2026-10-12T00:00:00Z' })] }))
    expect(t.rows[0][5]).toEqual({ value: 'Lab 6', tag: 'Archived', tone: 'pending' })
  })
  it('filters by kind, project, group and who', () => {
    expect(table(doc({ filters: { ...none, kinds: ['finished', 'created'] } })).rows).toHaveLength(2)
    expect(table(doc({ filters: { ...none, projectId: 'p2' } })).rows).toHaveLength(1)
    expect(table(doc({ filters: { ...none, boardId: 'b2' } })).rows.map((r) => r[1])).toEqual(['Ben Lim'])
    expect(table(doc({ filters: { ...none, actorId: 'prof' } })).rows.map((r) => r[1])).toEqual(['Prof. Reyes'])
  })
  it('keeps an event at 23:59 Manila on the last day and drops one at midnight after it', () => {
    const edge = [
      ev({ id: 'in', at: '2026-10-15T15:59:00Z' }),
      ev({ id: 'out', at: '2026-10-15T16:00:00Z' }),
      ev({ id: 'first', at: '2026-09-30T16:00:00Z' }),
      ev({ id: 'before', at: '2026-09-30T15:59:00Z' }),
    ]
    expect(table(doc({ events: edge })).rows.map((r) => r[0])).toEqual(['2026-10-15T15:59:00Z', '2026-09-30T16:00:00Z'])
  })
  it('caps the screen at 500 rows and keeps every row for the exports', () => {
    const many = Array.from({ length: 600 }, (_, i) => ev({ id: `x${String(i).padStart(3, '0')}` }))
    const t = table(doc({ events: many }))
    expect(EVENT_CAP).toBe(500)
    expect(t.cap).toBe(500)
    expect(t.rows).toHaveLength(600)
  })
  it('says what to do when nothing matches', () => {
    const d = doc({ filters: { ...none, kinds: ['file_removed'] } })
    expect(tableBlocks(d)).toHaveLength(0)
    expect(d.blocks).toContainEqual({ kind: 'note', tone: 'info', text: 'No activity in these dates. Widen the dates or clear a filter.' })
  })
  it('heads the sheet with the dates and the filters', () => {
    const d = doc({
      filters: { kinds: ['claimed', 'finished'], projectId: 'p1', boardId: 'b1', actorId: 's1' },
      labels: { project: 'Lab 6', board: 'Group 1 · Lab 6', actor: 'Cruz, Ana' },
    })
    expect(d.header.title).toBe('Activity log')
    expect(d.header.subtitle).toBe('Oct 1 to Oct 15, 2026')
    expect(d.header.rangeLabel).toBe('Claimed, Finished · Project: Lab 6 · Group: Group 1 · Lab 6 · Who: Cruz, Ana')
    expect(doc().header.rangeLabel).toBeNull()
  })
  it('signs and explains the record', () => {
    const d = doc()
    expect(d.footer.lines).toEqual([
      'Times are Manila time, to the minute.',
      'Archived and deleted tasks are left out, and so is their history.',
    ])
    expect(d.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }])
  })
})

describe('activityFilters', () => {
  const known = { projects: new Set(['p1']), boards: new Set(['b1']), actors: new Set(['s1']) }
  it('keeps ids this class has', () => {
    const f = { kinds: ['claimed' as const], projectId: 'p1', boardId: 'b1', actorId: 's1' }
    expect(activityFilters(f, known)).toEqual(f)
  })
  it('reads an id from another class, or an unknown kind, as no filter', () => {
    const raw = { kinds: ['claimed', 'toString'] as never[], projectId: 'px', boardId: 'bx', actorId: 'sx' }
    expect(activityFilters(raw, known)).toEqual({ kinds: ['claimed'], projectId: '', boardId: '', actorId: '' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reports/activityLog.test.ts`
Expected: FAIL, `Cannot find module './activityLog'`.

- [ ] **Step 3: Write the builder**

Create `src/lib/reports/activityLog.ts`:

```ts
import type { Tone } from '../analyticsMath'
import { manilaDay } from '../analyticsMath'
import type { ReportEventRow, TaskEventKind } from '../types'
import type { Block, Cell, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

/** Rows drawn on screen and in print. Excel and CSV carry every row. */
export const EVENT_CAP = 500

export const EVENT_META: Record<TaskEventKind, { label: string; tone: Tone }> = {
  created: { label: 'Created', tone: 'pending' },
  edited: { label: 'Edited', tone: 'pending' },
  claimed: { label: 'Claimed', tone: 'pending' },
  unclaimed: { label: 'Handed back', tone: 'warning' },
  assigned: { label: 'Assigned', tone: 'pending' },
  started: { label: 'Started', tone: 'pending' },
  finished: { label: 'Finished', tone: 'success' },
  reopened: { label: 'Reopened', tone: 'warning' },
  commented: { label: 'Commented', tone: 'pending' },
  logged: { label: 'Logged time', tone: 'pending' },
  file_added: { label: 'Added a file', tone: 'pending' },
  file_removed: { label: 'Removed a file', tone: 'warning' },
}

export type ActivityFilters = { kinds: TaskEventKind[]; projectId: string; boardId: string; actorId: string }

/** An id the address carries that this class does not have reads as no filter, not as an empty log. */
export function activityFilters(
  raw: ActivityFilters,
  known: { projects: ReadonlySet<string>; boards: ReadonlySet<string>; actors: ReadonlySet<string> },
): ActivityFilters {
  return {
    kinds: raw.kinds.filter((k) => Object.hasOwn(EVENT_META, k)),
    projectId: known.projects.has(raw.projectId) ? raw.projectId : '',
    boardId: known.boards.has(raw.boardId) ? raw.boardId : '',
    actorId: known.actors.has(raw.actorId) ? raw.actorId : '',
  }
}

export function activityLogDoc(input: ReportHead & {
  range: DayRange
  events: ReportEventRow[]
  filters: ActivityFilters
  /** What the page calls the chosen project, group and person, for the header. */
  labels: { project: string | null; board: string | null; actor: string | null }
}): ReportDoc {
  const { range, filters } = input
  const shown = input.events
    .filter((e) => {
      const day = manilaDay(e.at)
      return day >= range.from && day <= range.to
    })
    .filter((e) => filters.kinds.length === 0 || filters.kinds.includes(e.kind))
    .filter((e) => !filters.projectId || e.project_id === filters.projectId)
    .filter((e) => !filters.boardId || e.board_id === filters.boardId)
    .filter((e) => !filters.actorId || e.actor_id === filters.actorId)
    // Newest first: capped on screen, the recent events are the ones a dispute is about.
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))

  const blocks: Block[] = []
  if (shown.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No activity in these dates. Widen the dates or clear a filter.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'events',
      title: 'Events',
      cap: EVENT_CAP,
      columns: [
        { key: 'time', label: 'Time', type: 'datetime' },
        { key: 'who', label: 'Who', type: 'text' },
        { key: 'event', label: 'Event', type: 'status' },
        { key: 'task', label: 'Task', type: 'text' },
        { key: 'board', label: 'Group or student', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'detail', label: 'Detail', type: 'text' },
      ],
      rows: shown.map<Cell[]>((e) => {
        const meta = EVENT_META[e.kind] ?? { label: e.kind, tone: 'pending' as const }
        return [
          e.at,
          e.actor_name ?? 'Not recorded',
          { value: meta.label, tone: meta.tone },
          e.task_title,
          e.board_name ?? 'A board',
          e.project_archived_at ? { value: e.project_title, tag: 'Archived', tone: 'pending' } : e.project_title,
          e.detail || null,
        ]
      }),
    })
  }

  const parts = [
    filters.kinds.length ? filters.kinds.map((k) => EVENT_META[k].label).join(', ') : null,
    filters.projectId ? `Project: ${input.labels.project ?? 'one project'}` : null,
    filters.boardId ? `Group: ${input.labels.board ?? 'one group'}` : null,
    filters.actorId ? `Who: ${input.labels.actor ?? 'one person'}` : null,
  ].filter(Boolean)

  return {
    header: {
      title: 'Activity log',
      subtitle: rangeText(range),
      classLine: input.classLine,
      rangeLabel: parts.length ? parts.join(' · ') : null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: ['Times are Manila time, to the minute.', 'Archived and deleted tasks are left out, and so is their history.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reports/activityLog.test.ts`
Expected: PASS, 12 tests.

If "heads the sheet" fails only on the subtitle text, read `rangeText` in `range.ts` and match the test to what it prints for a range inside one year. Do not change `rangeText`.

- [ ] **Step 5: Build and commit**

Run: `npm run build`, `npx eslint src`, `npx vitest run`
Expected: all clean.

```bash
git add src/lib/reports/activityLog.ts src/lib/reports/activityLog.test.ts
git commit -m "$(cat <<'EOF'
Build the activity log report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The Formal term record builder

**Files:**
- Create: `src/lib/reports/formalRecord.ts`
- Test: `src/lib/reports/formalRecord.test.ts`
- Modify: `src/lib/reports/interventionLog.ts:10` (export `KIND_ORDER`)

**Interfaces:**
- Consumes: `countableBoard`, `CLASS_ENDED_NOTE` from `./deliverables`; `KIND_ORDER` from `./interventionLog`; `NOTE_KIND_META` from `../notes`; `dayText` from `./doc`; `ReportHead` from `./grading`; `ClassReport`, `WeekCoverage` from `../report`; `projectTypeLabel`, `weekSpanLabel` and the types `NoteLogRow`, `ProjectRow`, `ResultVerdict`, `ScoreSheetRow` from `../types`; `SpacePerson` from `../general/types`.
- Produces:
  - `type FormalProject = Pick<ProjectRow, 'id' | 'class_id' | 'title' | 'type' | 'type_label' | 'start_week' | 'end_week' | 'due_at' | 'release_at' | 'archived_at' | 'total_points'>`
  - `type FormalBoard = { id: string; project_id: string; group_id: string | null; student_id: string | null; member_count: number; submitted_at: string | null; result_verdict: ResultVerdict | null }`
  - `projectRan(p: Pick<ProjectRow, 'release_at' | 'archived_at'>, now: number): boolean`
  - `coTeacherNames(people: Pick<SpacePerson, 'user_id' | 'first_name' | 'last_name' | 'level' | 'is_student'>[], professorId: string): string[]`
  - `formalRecordDoc(input: ReportHead & { cls: ClassReport; professorName: string; coTeachers: string[]; now: number; projects: FormalProject[]; boards: FormalBoard[]; active: ReadonlySet<string>; scores: Record<string, Pick<ScoreSheetRow, 'final' | 'released'>[]>; weeks: WeekCoverage[]; notes: Pick<NoteLogRow, 'kind' | 'follow_up_on' | 'resolved_at'>[] }): ReportDoc`
  - `termRecordAllDoc(input: ReportHead & { classes: ClassReport[]; now: number; projects: FormalProject[]; boards: FormalBoard[]; active: ReadonlyMap<string, ReadonlySet<string>> }): ReportDoc`

- [ ] **Step 1: Export the note kind order**

In `src/lib/reports/interventionLog.ts`, change `const KIND_ORDER: ClassNoteKind[]` to `export const KIND_ORDER: ClassNoteKind[]`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/reports/formalRecord.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { coTeacherNames, formalRecordDoc, projectRan, termRecordAllDoc } from './formalRecord'
import type { FormalBoard, FormalProject } from './formalRecord'
import { tableBlocks } from './doc'
import type { ReportDoc, TableBlock } from './doc'
import type { ClassReport, WeekCoverage } from '../report'

const NOW = Date.parse('2026-10-16T04:00:00Z')
const head = { classLine: 'QM · Quantitative Methods · 3A', professor: 'Prof. Reyes', madeAt: 'October 16, 2026' }

const cls = (over: Partial<ClassReport> = {}): ClassReport => ({
  class_id: 'c1', class_initial: 'QM', class_name: 'Quantitative Methods', code: 'IT 311', section: '3A',
  school_year: '2026-2027', semester: '1st', year_level: '3rd', term_start: '2026-08-10', term_end: '2026-12-12',
  archived_at: null, students: 30, students_removed: 2, projects: 3, projects_archived: 0, boards: 12,
  boards_submitted: 8, boards_accepted: 5, boards_returned: 1, tasks: 80, tasks_done: 60, tasks_late: 4,
  tasks_unclaimed: 3, weeks_total: 18, weeks_covered: 10, ...over,
} as ClassReport)

const project = (over: Partial<FormalProject>): FormalProject => ({
  id: 'p1', class_id: 'c1', title: 'Lab 6', type: 'laboratory', type_label: null, start_week: 3, end_week: 4,
  due_at: '2026-09-19T00:00:00Z', release_at: null, archived_at: null, total_points: 100, ...over,
})
const board = (over: Partial<FormalBoard>): FormalBoard => ({
  id: 'b', project_id: 'p1', group_id: 'g', student_id: null, member_count: 3, submitted_at: null, result_verdict: null, ...over,
})

const projects = [
  project({ id: 'p1', title: 'Lab 6', start_week: 3 }),
  project({ id: 'p2', title: 'Midterm', type: 'exam', start_week: 9, end_week: 9, archived_at: '2026-10-01T00:00:00Z', total_points: 50 }),
  project({ id: 'p3', title: 'Final paper', start_week: 15, release_at: '2026-11-01T00:00:00Z' }),
]
const active = new Set(['s1', 's2'])
const boards = [
  board({ id: 'b1', project_id: 'p1', submitted_at: '2026-09-18T00:00:00Z', result_verdict: 'accepted' }),
  board({ id: 'b2', project_id: 'p1', submitted_at: '2026-09-18T00:00:00Z' }),
  board({ id: 'b3', project_id: 'p1', result_verdict: 'returned' }),
  board({ id: 'b4', project_id: 'p1', member_count: 0 }),
  board({ id: 'b5', project_id: 'p2', group_id: null, student_id: 's1', member_count: 0, submitted_at: '2026-09-30T00:00:00Z', result_verdict: 'accepted' }),
  board({ id: 'b6', project_id: 'p2', group_id: null, student_id: 'gone', member_count: 0 }),
  board({ id: 'b7', project_id: 'p3', submitted_at: '2026-10-10T00:00:00Z' }),
]
const weeks: WeekCoverage[] = [
  { class_id: 'c1', week_no: 1, title: 'Intro', topics: '', outcomes: '', assessments: '', week_start: '2026-08-10', week_end: '2026-08-16', phase: 'regular', project_titles: '', project_count: 0 } as WeekCoverage,
  { class_id: 'c1', week_no: 3, title: 'Queues', topics: '', outcomes: '', assessments: 'Lab', week_start: '2026-08-24', week_end: '2026-08-30', phase: 'regular', project_titles: 'Lab 6', project_count: 1 } as WeekCoverage,
  { class_id: 'c1', week_no: 5, title: 'Markov', topics: '', outcomes: '', assessments: 'Quiz', week_start: null, week_end: null, phase: 'regular', project_titles: '', project_count: 0 } as WeekCoverage,
]
const notes = [
  { kind: 'note' as const, follow_up_on: null, resolved_at: null },
  { kind: 'follow_up' as const, follow_up_on: '2026-10-01', resolved_at: '2026-10-02T00:00:00Z' },
  { kind: 'follow_up' as const, follow_up_on: '2026-10-05', resolved_at: null },
  { kind: 'nudge' as const, follow_up_on: null, resolved_at: null },
]
const scores = {
  p1: [{ final: 80, released: true }, { final: 91, released: true }, { final: null, released: true }],
  p2: [{ final: 40, released: false }],
}

const build = (over: Partial<Parameters<typeof formalRecordDoc>[0]> = {}) =>
  formalRecordDoc({
    ...head, cls: cls(), professorName: 'Maria Reyes', coTeachers: ['Jose Santos'], now: NOW,
    projects, boards, active, scores, weeks, notes, ...over,
  })
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)
const table = (doc: ReportDoc, id: string) => tableBlocks(doc).find((t) => t.id === id) as TableBlock

describe('projectRan', () => {
  it('counts archived, unscheduled and released projects, not ones waiting for release', () => {
    expect(projectRan({ release_at: null, archived_at: null }, NOW)).toBe(true)
    expect(projectRan({ release_at: '2026-10-01T00:00:00Z', archived_at: null }, NOW)).toBe(true)
    expect(projectRan({ release_at: '2026-11-01T00:00:00Z', archived_at: null }, NOW)).toBe(false)
    expect(projectRan({ release_at: '2026-11-01T00:00:00Z', archived_at: '2026-10-02T00:00:00Z' }, NOW)).toBe(true)
  })
})

describe('coTeacherNames', () => {
  it('names faculty at Owner or Manager, not the professor, members or students', () => {
    const people = [
      { user_id: 'prof', first_name: 'Maria', last_name: 'Reyes', level: 'owner', is_student: false },
      { user_id: 'f2', first_name: 'Jose', last_name: 'Santos', level: 'manager', is_student: false },
      { user_id: 'f1', first_name: 'Ana', last_name: 'Bautista', level: 'owner', is_student: false },
      { user_id: 'f3', first_name: 'Leo', last_name: 'Cruz', level: 'member', is_student: false },
      { user_id: 's1', first_name: 'Ben', last_name: 'Lim', level: 'manager', is_student: true },
    ] as Parameters<typeof coTeacherNames>[0]
    expect(coTeacherNames(people, 'prof')).toEqual(['Ana Bautista', 'Jose Santos'])
  })
})

describe('formalRecordDoc', () => {
  const doc = build()

  it('heads the record with the class and its term', () => {
    expect(doc.header.title).toBe('Formal term record')
    expect(doc.header.subtitle).toBe('QM · Quantitative Methods')
    expect(doc.header.rangeLabel).toBe('Aug 10, 2026 to Dec 12, 2026')
    expect(table(doc, 'class').rows).toEqual([
      ['Course', 'QM · Quantitative Methods'],
      ['Code and section', 'IT 311 3A'],
      ['Year and semester', '3rd year · 1st semester · 2026-2027'],
      ['Term', 'Aug 10, 2026 to Dec 12, 2026'],
      ['Status', 'Running'],
      ['Professor', 'Maria Reyes'],
      ['Co-teachers', 'Jose Santos'],
    ])
  })
  it('says None when nobody co-teaches, and when the class ended', () => {
    const ended = build({ coTeachers: [], cls: cls({ archived_at: '2026-12-15T02:00:00Z' }) })
    expect(table(ended, 'class').rows[4]).toEqual(['Status', 'Ended Dec 15, 2026'])
    expect(table(ended, 'class').rows[6]).toEqual(['Co-teachers', 'None'])
    expect(ended.blocks[0]).toEqual({ kind: 'note', tone: 'info', text: 'This class has ended. The report shows it as it was left.' })
  })
  it('counts enrolment, projects run and the two rates over boards that count', () => {
    // Ran: p1 and p2. Counted boards: b1, b2, b3 (b4 is empty) and b5 (b6's student left). Handed in: b1, b2, b5. Accepted: b1, b5.
    expect(kpi(doc, 'Students enrolled')?.value).toBe(30)
    expect(kpi(doc, 'Students removed')?.value).toBe(2)
    expect(kpi(doc, 'Projects run')?.value).toBe(2)
    expect(kpi(doc, 'Hand-in rate')).toEqual({ label: 'Hand-in rate', value: 75, unit: '%' })
    expect(kpi(doc, 'Accepted rate')).toEqual({ label: 'Accepted rate', value: 50, unit: '%' })
    expect(kpi(doc, 'Syllabus weeks covered')?.value).toBe('10/18')
    expect(kpi(doc, 'Work finished')).toEqual({ label: 'Work finished', value: 75, unit: '%' })
  })
  it('lists the projects that ran, with rates and released finals', () => {
    const t = table(doc, 'projects')
    expect(t.columns.map((c) => c.label)).toEqual([
      'Project', 'Type', 'Weeks', 'Due', 'Groups or students', 'Handed in', 'Accepted', 'Points', 'Average released final', 'Finals released',
    ])
    expect(t.rows).toEqual([
      ['Lab 6', 'Laboratory', 'Weeks 3–4', '2026-09-19T00:00:00Z', 3, 66.7, 33.3, 100, 85.5, 2],
      [{ value: 'Midterm', tag: 'Archived', tone: 'pending' }, 'Exam', 'Week 9', '2026-09-19T00:00:00Z', 1, 100, 100, 50, null, 0],
    ])
  })
  it('shows a dash, never 0% or NaN, when nothing counts', () => {
    const empty = build({ boards: [board({ id: 'x', project_id: 'p1', member_count: 0 })], cls: cls({ tasks: 0, tasks_done: 0 }) })
    expect(kpi(empty, 'Hand-in rate')).toEqual({ label: 'Hand-in rate', value: '—', unit: undefined })
    expect(kpi(empty, 'Accepted rate')?.value).toBe('—')
    expect(kpi(empty, 'Work finished')?.value).toBe('—')
    expect(table(empty, 'projects').rows[0].slice(4, 7)).toEqual([0, null, null])
  })
  it('lists every syllabus week and what was set against it', () => {
    const t = table(doc, 'coverage')
    expect(t.title).toBe('Syllabus coverage')
    expect(t.rows).toEqual([
      [1, 'Aug 10, 2026 to Aug 16, 2026', 'Intro', null, null],
      [3, 'Aug 24, 2026 to Aug 30, 2026', 'Queues', 'Lab', 'Lab 6'],
      [5, null, 'Markov', 'Quiz', 'Nothing set'],
    ])
    expect(t.note).toBe(
      'Coverage means a project was set against that syllabus week. It does not measure what was taught in the room. 1 week names an assessment with nothing set against it.',
    )
  })
  it('counts notes by kind with follow-ups resolved, and a total', () => {
    expect(table(doc, 'interventions').rows).toEqual([
      ['Note', 1, 0, 0],
      ['Follow-up', 2, 2, 1],
      ['Reminder', 1, 0, 0],
      ['Total', 4, 2, 1],
    ])
  })
  it('keeps the old term report counts', () => {
    expect(table(doc, 'work').rows).toEqual([
      ['Tasks set', 80],
      ['Tasks finished', 60],
      ['Finished after the deadline', 4],
      ['Never claimed by anybody', 3],
    ])
  })
  it('says what is empty', () => {
    const bare = build({ projects: [], boards: [], weeks: [], notes: [] })
    const texts = bare.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))
    expect(texts).toEqual([
      'No projects were run in this class.',
      'This class has no syllabus weeks yet.',
      'No notes were written for this class.',
    ])
  })
  it('explains the rates, leaves out unreleased projects, and has two signature lines', () => {
    expect(doc.footer.lines).toEqual([
      'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.',
      'Averages count released finals only.',
      'Projects not yet released to students are left out.',
    ])
    expect(build({ projects: projects.slice(0, 2) }).footer.lines).toHaveLength(2)
    expect(doc.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }, { role: 'Reviewed by (program chair)' }])
  })
})

describe('termRecordAllDoc', () => {
  const c2 = cls({ class_id: 'c2', class_initial: 'DS', class_name: 'Data Structures', section: '2B', students: 20, students_removed: 0,
    archived_at: '2026-06-01T00:00:00Z', term_start: null, term_end: null, weeks_total: 0, weeks_covered: 0, tasks: 0, tasks_done: 0 })
  const all = termRecordAllDoc({
    ...head,
    classLine: '2 classes',
    classes: [cls(), c2],
    now: NOW,
    projects: [...projects, project({ id: 'q1', class_id: 'c2', title: 'Stack lab' })],
    boards: [...boards, board({ id: 'q', project_id: 'q1', submitted_at: '2026-05-01T00:00:00Z' })],
    active: new Map([['c1', active], ['c2', new Set<string>()]]),
  })

  it('heads the record for every class', () => {
    expect(all.header.subtitle).toBe('Every class you teach')
    expect(all.header.rangeLabel).toBeNull()
  })
  it('totals across classes', () => {
    expect(kpi(all, 'Classes')?.value).toBe(2)
    expect(kpi(all, 'Students enrolled')?.value).toBe(50)
    expect(kpi(all, 'Projects run')?.value).toBe(3)
    // Counted: b1, b2, b3, b5, q. Handed in: b1, b2, b5, q. Accepted: b1, b5.
    expect(kpi(all, 'Hand-in rate')?.value).toBe(80)
    expect(kpi(all, 'Accepted rate')?.value).toBe(40)
  })
  it('gives one row per class, the same figures as its own record', () => {
    const t = table(all, 'classes')
    expect(t.columns.map((c) => c.label)).toEqual([
      'Class', 'Section', 'Term', 'Students', 'Removed', 'Projects run', 'Groups or students', 'Handed in', 'Accepted',
      'Syllabus weeks covered', 'Syllabus weeks', 'Work finished',
    ])
    expect(t.rows[0]).toEqual(['QM · Quantitative Methods', '3A', 'Aug 10, 2026 to Dec 12, 2026', 30, 2, 2, 4, 75, 50, 10, 18, 75])
    expect(t.rows[1]).toEqual([
      { value: 'DS · Data Structures', tag: 'Ended', tone: 'pending' }, '2B', 'No term dates set', 20, 0, 1, 1, 100, 0, 0, 0, null,
    ])
  })
  it('says so when there are no classes', () => {
    const none = termRecordAllDoc({ ...head, classes: [], now: NOW, projects: [], boards: [], active: new Map() })
    expect(none.blocks).toContainEqual({ kind: 'note', tone: 'info', text: 'You have no classes yet.' })
  })
  it('has the same footer and signatures', () => {
    expect(all.footer.lines[0]).toBe(
      'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.',
    )
    expect(all.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }, { role: 'Reviewed by (program chair)' }])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/reports/formalRecord.test.ts`
Expected: FAIL, `Cannot find module './formalRecord'`.

- [ ] **Step 4: Write the builder**

Create `src/lib/reports/formalRecord.ts`:

```ts
import type { SpacePerson } from '../general/types'
import { NOTE_KIND_META } from '../notes'
import type { ClassReport, WeekCoverage } from '../report'
import { projectTypeLabel, weekSpanLabel } from '../types'
import type { NoteLogRow, ProjectRow, ResultVerdict, ScoreSheetRow } from '../types'
import { CLASS_ENDED_NOTE, countableBoard } from './deliverables'
import { dayText } from './doc'
import type { Block, Cell, Kpi, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { KIND_ORDER } from './interventionLog'

export type FormalProject = Pick<
  ProjectRow,
  'id' | 'class_id' | 'title' | 'type' | 'type_label' | 'start_week' | 'end_week' | 'due_at' | 'release_at' | 'archived_at' | 'total_points'
>

export type FormalBoard = {
  id: string
  project_id: string
  group_id: string | null
  student_id: string | null
  member_count: number
  submitted_at: string | null
  result_verdict: ResultVerdict | null
}

const RATES_LINE =
  'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.'
const RELEASED_ONLY_LINE = 'Averages count released finals only.'
const UNRELEASED_LINE = 'Projects not yet released to students are left out.'

const signatures = (professor: string) => [{ role: 'Prepared by', name: professor }, { role: 'Reviewed by (program chair)' }]

/** A project that ran: archived, or released to students by `now`. */
export function projectRan(p: Pick<ProjectRow, 'release_at' | 'archived_at'>, now: number) {
  return Boolean(p.archived_at) || !p.release_at || Date.parse(p.release_at) <= now
}

const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null)
const pctKpi = (label: string, v: number | null): Kpi => ({ label, value: v ?? '—', unit: v === null ? undefined : '%' })

/** The boards that count, and how many of them were handed in and accepted. */
function boardFigures(boards: FormalBoard[], active: ReadonlySet<string>) {
  const counted = boards.filter((b) => countableBoard(b, active))
  return {
    boards: counted.length,
    handedIn: counted.filter((b) => b.submitted_at !== null || b.result_verdict === 'accepted').length,
    accepted: counted.filter((b) => b.result_verdict === 'accepted').length,
  }
}

/** Everyone else who teaches the class: faculty its space holds at Owner or Manager, by name. */
export function coTeacherNames(
  people: Pick<SpacePerson, 'user_id' | 'first_name' | 'last_name' | 'level' | 'is_student'>[],
  professorId: string,
) {
  return people
    .filter((p) => !p.is_student && (p.level === 'owner' || p.level === 'manager') && p.user_id !== professorId)
    .map((p) => `${p.first_name} ${p.last_name}`.trim())
    .sort((a, b) => a.localeCompare(b))
}

const termText = (start: string | null, end: string | null) =>
  start && end ? `${dayText(start)} to ${dayText(end)}` : 'No term dates set'

const byWeek = (a: FormalProject, b: FormalProject) =>
  a.start_week - b.start_week || a.title.localeCompare(b.title, undefined, { numeric: true })

const note = (text: string): Block => ({ kind: 'note', tone: 'info', text })

export function formalRecordDoc(input: ReportHead & {
  cls: ClassReport
  /** The class's own professor, as the class records them. */
  professorName: string
  coTeachers: string[]
  now: number
  projects: FormalProject[]
  boards: FormalBoard[]
  /** The class's active student ids. */
  active: ReadonlySet<string>
  /** score_sheet rows by project id. */
  scores: Record<string, Pick<ScoreSheetRow, 'final' | 'released'>[]>
  weeks: WeekCoverage[]
  notes: Pick<NoteLogRow, 'kind' | 'follow_up_on' | 'resolved_at'>[]
}): ReportDoc {
  const { cls } = input
  const ran = input.projects.filter((p) => projectRan(p, input.now)).sort(byWeek)
  const ranIds = new Set(ran.map((p) => p.id))
  const all = boardFigures(input.boards.filter((b) => ranIds.has(b.project_id)), input.active)
  const term = termText(cls.term_start, cls.term_end)

  const blocks: Block[] = []
  if (cls.archived_at) blocks.push(note(CLASS_ENDED_NOTE))
  blocks.push({
    kind: 'kpis',
    items: [
      { label: 'Students enrolled', value: cls.students },
      { label: 'Students removed', value: cls.students_removed },
      { label: 'Projects run', value: ran.length },
      pctKpi('Hand-in rate', rate(all.handedIn, all.boards)),
      pctKpi('Accepted rate', rate(all.accepted, all.boards)),
      { label: 'Syllabus weeks covered', value: `${cls.weeks_covered}/${cls.weeks_total}` },
      pctKpi('Work finished', rate(cls.tasks_done, cls.tasks)),
    ],
  })

  blocks.push({
    kind: 'table',
    id: 'class',
    title: 'Class',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
    ],
    rows: [
      ['Course', `${cls.class_initial} · ${cls.class_name}`],
      ['Code and section', `${cls.code} ${cls.section}`],
      ['Year and semester', `${cls.year_level} year · ${cls.semester} semester · ${cls.school_year}`],
      ['Term', term],
      ['Status', cls.archived_at ? `Ended ${dayText(cls.archived_at)}` : 'Running'],
      ['Professor', input.professorName],
      ['Co-teachers', input.coTeachers.length ? input.coTeachers.join(', ') : 'None'],
    ],
  })

  if (ran.length === 0) {
    blocks.push(note('No projects were run in this class.'))
  } else {
    blocks.push({
      kind: 'table',
      id: 'projects',
      title: 'Projects',
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'weeks', label: 'Weeks', type: 'text' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'boards', label: 'Groups or students', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'percent' },
        { key: 'accepted', label: 'Accepted', type: 'percent' },
        { key: 'points', label: 'Points', type: 'number' },
        { key: 'average', label: 'Average released final', type: 'number', decimals: 1 },
        { key: 'released', label: 'Finals released', type: 'number' },
      ],
      rows: ran.map<Cell[]>((p) => {
        const f = boardFigures(input.boards.filter((b) => b.project_id === p.id), input.active)
        const finals = (input.scores[p.id] ?? [])
          .filter((s) => s.released && s.final !== null)
          .map((s) => Number(s.final))
        const average = finals.length ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10 : null
        return [
          p.archived_at ? { value: p.title, tag: 'Archived', tone: 'pending' } : p.title,
          projectTypeLabel(p),
          weekSpanLabel(p),
          p.due_at,
          f.boards,
          rate(f.handedIn, f.boards),
          rate(f.accepted, f.boards),
          p.total_points,
          average,
          finals.length,
        ]
      }),
    })
  }

  if (input.weeks.length === 0) {
    blocks.push(note('This class has no syllabus weeks yet.'))
  } else {
    const gaps = input.weeks.filter((w) => w.project_count === 0 && w.assessments.trim() !== '').length
    blocks.push({
      kind: 'table',
      id: 'coverage',
      title: 'Syllabus coverage',
      columns: [
        { key: 'week', label: 'Week', type: 'number' },
        { key: 'dates', label: 'Dates', type: 'text' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'asks', label: 'What the syllabus asks for', type: 'text' },
        { key: 'set', label: 'What was set against it', type: 'text' },
      ],
      rows: input.weeks.map<Cell[]>((w) => [
        w.week_no,
        w.week_start && w.week_end ? `${dayText(w.week_start)} to ${dayText(w.week_end)}` : null,
        w.title,
        w.assessments.trim() || null,
        w.project_titles || (w.assessments.trim() ? 'Nothing set' : null),
      ]),
      note:
        'Coverage means a project was set against that syllabus week. It does not measure what was taught in the room.' +
        (gaps ? ` ${gaps} ${gaps === 1 ? 'week names' : 'weeks name'} an assessment with nothing set against it.` : ''),
    })
  }

  const kinds = KIND_ORDER.map((k) => {
    const of = input.notes.filter((n) => n.kind === k)
    const followUps = of.filter((n) => n.follow_up_on !== null)
    return { k, notes: of.length, followUps: followUps.length, resolved: followUps.filter((n) => n.resolved_at !== null).length }
  }).filter((x) => x.notes > 0)
  if (kinds.length === 0) {
    blocks.push(note('No notes were written for this class.'))
  } else {
    const sum = (f: (x: (typeof kinds)[number]) => number) => kinds.reduce((a, x) => a + f(x), 0)
    blocks.push({
      kind: 'table',
      id: 'interventions',
      title: 'Interventions',
      columns: [
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'number' },
        { key: 'followUps', label: 'Follow-ups', type: 'number' },
        { key: 'resolved', label: 'Follow-ups resolved', type: 'number' },
      ],
      rows: [
        ...kinds.map<Cell[]>((x) => [NOTE_KIND_META[x.k].label, x.notes, x.followUps, x.resolved]),
        ['Total', sum((x) => x.notes), sum((x) => x.followUps), sum((x) => x.resolved)],
      ],
    })
  }

  blocks.push({
    kind: 'table',
    id: 'work',
    title: 'Work',
    columns: [
      { key: 'measure', label: 'Measure', type: 'text' },
      { key: 'count', label: 'Count', type: 'number' },
    ],
    rows: [
      ['Tasks set', cls.tasks],
      ['Tasks finished', cls.tasks_done],
      ['Finished after the deadline', cls.tasks_late],
      ['Never claimed by anybody', cls.tasks_unclaimed],
    ],
  })

  return {
    header: {
      title: 'Formal term record',
      subtitle: `${cls.class_initial} · ${cls.class_name}`,
      classLine: input.classLine,
      rangeLabel: term,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [RATES_LINE, RELEASED_ONLY_LINE, ...(ran.length < input.projects.length ? [UNRELEASED_LINE] : [])],
      signatures: signatures(input.professor),
    },
  }
}

/** The every-class version: one row per class, with the same figures each class's own record gives. */
export function termRecordAllDoc(input: ReportHead & {
  classes: ClassReport[]
  now: number
  projects: FormalProject[]
  boards: FormalBoard[]
  /** Each class's active student ids. */
  active: ReadonlyMap<string, ReadonlySet<string>>
}): ReportDoc {
  const ran = input.projects.filter((p) => projectRan(p, input.now))
  const classOf = new Map(ran.map((p) => [p.id, p.class_id]))
  const rows = input.classes.map((c) => ({
    c,
    projects: ran.filter((p) => p.class_id === c.class_id).length,
    f: boardFigures(
      input.boards.filter((b) => classOf.get(b.project_id) === c.class_id),
      input.active.get(c.class_id) ?? new Set<string>(),
    ),
  }))
  const total = (g: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + g(x), 0)
  const boards = total((x) => x.f.boards)

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Classes', value: input.classes.length },
        { label: 'Students enrolled', value: total((x) => x.c.students) },
        { label: 'Projects run', value: total((x) => x.projects) },
        pctKpi('Hand-in rate', rate(total((x) => x.f.handedIn), boards)),
        pctKpi('Accepted rate', rate(total((x) => x.f.accepted), boards)),
      ],
    },
  ]
  if (rows.length === 0) {
    blocks.push(note('You have no classes yet.'))
  } else {
    blocks.push({
      kind: 'table',
      id: 'classes',
      title: 'Classes',
      columns: [
        { key: 'class', label: 'Class', type: 'text' },
        { key: 'section', label: 'Section', type: 'text' },
        { key: 'term', label: 'Term', type: 'text' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'removed', label: 'Removed', type: 'number' },
        { key: 'projects', label: 'Projects run', type: 'number' },
        { key: 'boards', label: 'Groups or students', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'percent' },
        { key: 'accepted', label: 'Accepted', type: 'percent' },
        { key: 'covered', label: 'Syllabus weeks covered', type: 'number' },
        { key: 'weeks', label: 'Syllabus weeks', type: 'number' },
        { key: 'finished', label: 'Work finished', type: 'percent' },
      ],
      rows: rows.map<Cell[]>(({ c, projects, f }) => {
        const name = `${c.class_initial} · ${c.class_name}`
        return [
          c.archived_at ? { value: name, tag: 'Ended', tone: 'pending' } : name,
          c.section,
          termText(c.term_start, c.term_end),
          c.students,
          c.students_removed,
          projects,
          f.boards,
          rate(f.handedIn, f.boards),
          rate(f.accepted, f.boards),
          c.weeks_covered,
          c.weeks_total,
          rate(c.tasks_done, c.tasks),
        ]
      }),
    })
  }

  return {
    header: {
      title: 'Formal term record',
      subtitle: 'Every class you teach',
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [RATES_LINE, ...(ran.length < input.projects.length ? [UNRELEASED_LINE] : [])],
      signatures: signatures(input.professor),
    },
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/lib/reports/formalRecord.test.ts`
Expected: PASS, 17 tests.

Two values depend on helpers outside this task. If a test fails only on one of them, read the helper and fix the **test** to match. Do not change the helper.
- The `Type` label for `'laboratory'` and `'exam'` comes from `PROJECT_TYPES` in `src/lib/types.ts`.
- The day text ("Aug 10, 2026") comes from `dayText` in `doc.ts`.

- [ ] **Step 6: Build and commit**

Run: `npm run build`, `npx eslint src`, `npx vitest run`
Expected: all clean.

```bash
git add src/lib/reports/formalRecord.ts src/lib/reports/formalRecord.test.ts src/lib/reports/interventionLog.ts
git commit -m "$(cat <<'EOF'
Build the formal term record, for one class or every class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The two reports on the Reports page

**Files:**
- Modify: `src/pages/app/reports/reportKind.ts` (two kinds, `chosenClass`)
- Modify: `src/pages/app/reports/reportKind.test.ts`
- Modify: `src/pages/app/reports/useReports.ts`
- Modify: `src/pages/app/reports/useReportDoc.ts`
- Modify: `src/pages/app/reports/Reports.tsx`
- Modify: `src/components/reports/ReportPicker.tsx` (`classOptions`, `classValue`)

**Interfaces:**
- Consumes:
  - `listTaskEvents` (Task 1).
  - `activityLogDoc`, `activityFilters`, `EVENT_META` (Task 2).
  - `formalRecordDoc`, `termRecordAllDoc`, `projectRan`, `coTeacherNames` (Task 3).
  - Existing: `getClass`, `listMembers` (`lib/api/classes`); `listSpaceMembers` (`lib/api/spaces`); `weekCoverage` (`lib/api/reports`); `listClassNoteLog` (`lib/api/notes`); `scoreSheet` (`lib/api/scores`); `listProjectsForClasses` (`lib/api/projects`); `boardsFor` (`lib/api/dashboard`); `fullName` (`lib/types`).
- Produces:
  - `ReportKind` gains `'formal' | 'activity'`.
  - `chosenClass(kind: ReportKind, raw: string | null, locked: string | undefined, first: string | undefined): { classId: string; allClasses: boolean }`
  - `useReports` returns, in addition: `allClasses: boolean`, `eventKinds: TaskEventKind[]`, `setEventKinds(list: TaskEventKind[])`.
  - `PickerState` gains `classOptions?: { value: string; label: string }[]` and `classValue?: string`.

- [ ] **Step 1: Write the failing kind test**

Replace `src/pages/app/reports/reportKind.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { chosenClass, parseReportKind } from './reportKind'

describe('parseReportKind', () => {
  it('reads a known report', () => {
    for (const k of ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables', 'formal', 'activity']) {
      expect(parseReportKind(k)).toBe(k)
    }
  })
  it('falls back to the grading sheet for anything else', () => {
    expect(parseReportKind(null)).toBe('grading')
    expect(parseReportKind('toString')).toBe('grading')
    expect(parseReportKind('__proto__')).toBe('grading')
  })
})

describe('chosenClass', () => {
  it('takes the locked class over the address', () => {
    expect(chosenClass('formal', 'all', 'c-locked', 'c1')).toEqual({ classId: 'c-locked', allClasses: false })
  })
  it('reads all as every class on the term record only', () => {
    expect(chosenClass('formal', 'all', undefined, 'c1')).toEqual({ classId: '', allClasses: true })
  })
  it('never lets all reach a report about one class', () => {
    expect(chosenClass('grading', 'all', undefined, 'c1')).toEqual({ classId: 'c1', allClasses: false })
    expect(chosenClass('activity', 'all', undefined, undefined)).toEqual({ classId: '', allClasses: false })
  })
  it('takes the class in the address, or the first', () => {
    expect(chosenClass('notes', 'c2', undefined, 'c1')).toEqual({ classId: 'c2', allClasses: false })
    expect(chosenClass('notes', null, undefined, 'c1')).toEqual({ classId: 'c1', allClasses: false })
  })
})
```

Run: `npx vitest run src/pages/app/reports/reportKind.test.ts`
Expected: FAIL, `chosenClass` is not exported.

- [ ] **Step 2: Add the kinds and `chosenClass`**

In `src/pages/app/reports/reportKind.ts`:
- add `| 'formal' | 'activity'` to `ReportKind`;
- append `'formal', 'activity'` to `DOC_KINDS`;
- add `formal: ['class'],` and `activity: ['class'],` to `NEEDS`;
- append:

```ts
/**
 * The class a report is about: the class page's own, the one in the address,
 * or the first. `all` is the term record's every-class choice; any other
 * report reads it as no choice, so it never reaches one that needs a class.
 */
export function chosenClass(
  kind: ReportKind,
  raw: string | null,
  locked: string | undefined,
  first: string | undefined,
): { classId: string; allClasses: boolean } {
  if (locked) return { classId: locked, allClasses: false }
  if (raw === 'all') return kind === 'formal' ? { classId: '', allClasses: true } : { classId: first ?? '', allClasses: false }
  return { classId: raw || first || '', allClasses: false }
}
```

Run: `npx vitest run src/pages/app/reports/reportKind.test.ts`
Expected: PASS.

- [ ] **Step 3: Teach `useReports` the two reports**

In `src/pages/app/reports/useReports.ts`:

1. Imports: add `chosenClass` to the `./reportKind` import; add `import { EVENT_META } from '../../../lib/reports/activityLog'`; add `TaskEventKind` to the `../../../lib/types` type import.
2. `export const OPTIONAL_STUDENT: ReportKind[] = ['grading', 'notes', 'activity']`. Update its comment to "Reports that take a student but do not need one. On the activity log the student is who acted."
3. Range fallback: `parseRangeChoice(params.get('rrange'), kind === 'notes' || kind === 'activity' ? 'last30' : 'thisWeek')`.
4. After the `noteStatus` lines, add:

```ts
  const rawEvents = params.get('revents') ?? ''
  const eventKinds = useMemo(
    () => rawEvents.split(',').filter((k) => Object.hasOwn(EVENT_META, k)) as TaskEventKind[],
    [rawEvents],
  )
```

5. Replace the `classId` line with:

```ts
  const { classId, allClasses } = chosenClass(kind, params.get('rclass'), lockedClassId, classes?.[0]?.class_id)
```

6. Add the setter beside `setNoteStatus`:

```ts
  const setEventKinds = useCallback((list: TaskEventKind[]) => patch({ revents: list.join(',') }), [patch])
```

7. In `choose`, replace the project, group, student, range and date lines with the block below. Add `params` to its dependency list.

```ts
      const keepsProject = NEEDS[next].includes('project') || next === 'activity'
      if (
        !keepsProject ||
        (NEEDS[next].includes('project') && !settling && !projectFits(next, projectId, projects)) ||
        (next === 'activity' && projectId === 'all')
      ) out.rproject = ''
      // The intervention log and the activity log filter by group without needing one.
      if (!NEEDS[next].includes('board') && next !== 'notes' && next !== 'activity') out.rgroup = ''
      if (!NEEDS[next].includes('student') && !OPTIONAL_STUDENT.includes(next)) out.rstudent = ''
      // Dates and filters belong to the reports that use them. The compliance report
      // takes its dates from `rdue`, but shares the custom From and To.
      const dated = next === 'checkin' || next === 'notes' || next === 'activity'
      if (!dated) out.rrange = ''
      if (!dated && next !== 'deliverables') {
        out.rfrom = ''
        out.rto = ''
      }
      if (next !== 'deliverables') out.rdue = ''
      if (next !== 'activity') out.revents = ''
      // Every class is the term record's alone.
      if (next !== 'formal' && params.get('rclass') === 'all') out.rclass = ''
```

8. In `ready`, change the class clause to `(!NEEDS[kind].includes('class') || Boolean(cls) || allClasses) &&`.
9. Return `allClasses`, `eventKinds` and `setEventKinds`.

- [ ] **Step 4: Build both reports in `useReportDoc`**

In `src/pages/app/reports/useReportDoc.ts`:

1. Imports to add:

```ts
import { getClass, listMembers } from '../../../lib/api/classes'
import { boardsFor } from '../../../lib/api/dashboard'
import { listProjectsForClasses } from '../../../lib/api/projects'
import { weekCoverage } from '../../../lib/api/reports'
import { listSpaceMembers } from '../../../lib/api/spaces'
import { activityFilters, activityLogDoc } from '../../../lib/reports/activityLog'
import { coTeacherNames, formalRecordDoc, projectRan, termRecordAllDoc } from '../../../lib/reports/formalRecord'
import { fullName } from '../../../lib/types'
import type { TaskEventKind } from '../../../lib/types'
```

and add `listTaskEvents` to the `reportReads` import.

2. Destructure `classes`, `allClasses` and `eventKinds` from `r`. Add `const eventKindsKey = eventKinds.join(',')`.
3. `const byDates = kind === 'checkin' || kind === 'notes' || kind === 'activity'`.
4. Append `allClasses ? 'all' : ''` and `eventKindsKey` to `currentKey`'s array.
5. Replace `classLine` with:

```ts
  const classLine = allClasses
    ? `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`
    : cls
      ? `${cls.class_initial} · ${cls.class_name} · ${cls.section}`
      : ''
```

6. `liveTables`: before the final fallback, add these two branches:

```ts
          : kind === 'formal'
            ? ['projects', 'project_boards', 'board_results', 'class_members', 'group_members', 'member_scores',
               'score_releases', 'class_notes', 'general_space_members', 'syllabus_weeks']
            : kind === 'activity'
              ? ['task_events']
```

7. Signatures. Add a `classesSig`:

```ts
  // The term record reads its figures off the class list, which the page loads live.
  const classesSig = useMemo(
    () =>
      kind === 'formal'
        ? classes
            .map((c) => `${c.class_id}:${c.students}:${c.students_removed}:${c.weeks_covered}:${c.weeks_total}:${c.tasks}:${c.tasks_done}:${c.tasks_late}:${c.tasks_unclaimed}:${c.archived_at ?? ''}:${c.term_start ?? ''}:${c.term_end ?? ''}`)
            .join('|')
        : '',
    [kind, classes],
  )
```

In `checkInSig`, before its final `: ''`, add:

```ts
          : kind === 'formal' && !allClasses
            ? [
                ...allBoards.map((b) => `${b.id}:${b.project_id}:${b.submitted_at ?? ''}:${b.result_verdict ?? ''}:${countableBoard(b, active) ? 1 : 0}`),
                ...projects.map((p) => `${p.id}:${p.title}:${p.type}:${p.start_week}:${p.end_week}:${p.due_at ?? ''}:${p.release_at ?? ''}:${p.archived_at ?? ''}:${p.total_points}`),
              ].join('|')
            : kind === 'activity'
              ? [
                  ...allBoards.map((b) => `${b.id}:${b.group_name ?? b.student_name ?? ''}:${b.project_title}`),
                  ...projects.map((p) => `${p.id}:${p.title}`),
                ].join('|')
```

Add `allClasses` to `checkInSig`'s dependencies. Add `classesSig` to the build effect's dependency list.

8. Add `cls` and `classes` to the `data` ref, both where it is created and where the effect refreshes it. Read them inside the build from `data.current`.
9. In the build, before the closing `}` of the `deliverables` branch's chain, add:

```ts
        } else if (kind === 'formal' && allClasses) {
          const ids = classes.map((c) => c.class_id)
          const everyProject = await listProjectsForClasses(ids)
          const [everyBoard, rosters] = await Promise.all([
            boardsFor(everyProject.map((p) => p.id)),
            Promise.all(ids.map((id) => listMembers(id))),
          ])
          const activeBy = new Map(
            ids.map((id, i) => [id, new Set(rosters[i].filter((m) => m.status === 'active').map((m) => m.student_id))]),
          )
          next = termRecordAllDoc({ ...head, classes, now: Date.now(), projects: everyProject, boards: everyBoard, active: activeBy })
        } else if (kind === 'formal' && cls) {
          const now = Date.now()
          const [weeks, notes, overview, sheets] = await Promise.all([
            weekCoverage(classId),
            listClassNoteLog(classId),
            getClass(classId),
            // Released finals only matter on projects that ran.
            Promise.all(projects.filter((p) => projectRan(p, now)).map(async (p) => [p.id, await scoreSheet(p.id)] as const)),
          ])
          const people = overview ? await listSpaceMembers(overview.space_id) : []
          next = formalRecordDoc({
            ...head,
            cls,
            now,
            professorName: overview?.professor ? fullName(overview.professor) : professor,
            coTeachers: overview ? coTeacherNames(people, overview.professor_id) : [],
            projects,
            boards: allBoards,
            active,
            scores: Object.fromEntries(sheets),
            weeks,
            notes,
          })
        } else if (kind === 'activity') {
          const events = await listTaskEvents(classId, range)
          const filters = activityFilters(
            {
              kinds: eventKindsKey ? (eventKindsKey.split(',') as TaskEventKind[]) : [],
              projectId,
              boardId,
              actorId: studentId,
            },
            {
              projects: new Set(projects.map((p) => p.id)),
              boards: new Set(allBoards.map((b) => b.id)),
              actors: new Set(students.map((s) => s.value)),
            },
          )
          const p = projects.find((x) => x.id === filters.projectId)
          const b = allBoards.find((x) => x.id === filters.boardId)
          next = activityLogDoc({
            ...head,
            range,
            events,
            filters,
            labels: {
              project: p?.title ?? null,
              board: b ? `${b.group_name ?? b.student_name ?? 'A board'} · ${b.project_title}` : null,
              actor: students.find((s) => s.value === filters.actorId)?.label ?? null,
            },
          })
```

Add `allClasses` and `eventKindsKey` to the build effect's dependency list.

- [ ] **Step 5: Offer Every class in the picker**

In `src/components/reports/ReportPicker.tsx`, add to `PickerState`:

```ts
  /** Replaces the class list, for a report with an extra choice such as every class. */
  classOptions?: { value: string; label: string }[]
  /** The class select's value when it differs from `classId`, such as `all`. */
  classValue?: string
```

In `About`, replace the class `Select` block with:

```tsx
      {needs.includes('class') && (r.classOptions !== undefined || r.classes.length > 1) && (
        <Select
          aria-label="Class"
          value={r.classValue ?? r.classId}
          onChange={(e) => r.setClassId(e.target.value)}
          options={
            r.classOptions ??
            r.classes.map((c) => ({
              value: c.class_id,
              label: `${c.class_initial} · ${c.class_name}${c.archived_at ? ' (ended)' : ''}`,
            }))
          }
          className={size}
        />
      )}
```

- [ ] **Step 6: Put both reports on the page**

In `src/pages/app/reports/Reports.tsx`:

1. Imports: add `EVENT_META` from `../../../lib/reports/activityLog`, and `TaskEventKind` to the `../../../lib/types` type import.
2. Insert this catalogue group after "For tracking projects" and before "Older reports":

```ts
  {
    group: 'For the record',
    items: [
      {
        kind: 'formal',
        label: 'Formal term record',
        body: 'The term on one record for the course file or accreditation: enrolment, projects, hand-ins, syllabus coverage and interventions, with signature lines.',
      },
      {
        kind: 'activity',
        label: 'Activity log',
        body: 'Every change to every task in a date range: who did what, and when. The record for settling a dispute.',
      },
    ],
  },
```

3. `EXPORT_BASE`: add `formal: 'term-record',` and `activity: 'activity-log',`.
4. In `picker`, add:

```ts
    // Every class is offered only on the term record, and never inside one class.
    classOptions:
      r.kind === 'formal' && !classId
        ? [
            { value: 'all', label: 'Every class' },
            ...r.classes.map((c) => ({
              value: c.class_id,
              label: `${c.class_initial} · ${c.class_name}${c.archived_at ? ' (ended)' : ''}`,
            })),
          ]
        : undefined,
    classValue: r.allClasses ? 'all' : undefined,
```

and in `extras`, add an `r.kind === 'activity' ? <ActivityExtras r={r} /> :` branch before the `peer` branch.

5. Lift the dates out of `CheckInExtras` into a `RangeFields` component, and the note-kind chips into a `ChipToggles` component. Then rewrite `CheckInExtras` with them and add `ActivityExtras`. Keep `FIELD_SIZE` and the existing markup:

```tsx
/** A preset range, or two dates. Until both dates are set the range reads as the last 7 days. */
function RangeFields({ r, choices }: { r: ReturnType<typeof useReports>; choices: { value: RangeChoice; label: string }[] }) {
  return (
    <>
      <Select
        aria-label="Dates"
        value={r.rangeChoice}
        onChange={(e) => r.setRangeChoice(e.target.value as RangeChoice)}
        options={choices}
        className={FIELD_SIZE}
      />
      {r.rangeChoice === 'custom' && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">From</span>
              <Input
                type="date"
                value={r.customFrom}
                onChange={(e) => r.setCustomRange(e.target.value, r.customTo)}
                className={FIELD_SIZE}
              />
            </label>
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">To</span>
              <Input
                type="date"
                value={r.customTo}
                onChange={(e) => r.setCustomRange(r.customFrom, e.target.value)}
                className={FIELD_SIZE}
              />
            </label>
          </div>
          {(!r.customFrom || !r.customTo) && (
            <p className="px-1 text-[12px] text-muted">Set both dates. Until then the report covers the last 7 days.</p>
          )}
        </div>
      )}
    </>
  )
}

/** Pill checkboxes for narrowing by kind. None picked means every kind. */
function ChipToggles<K extends string>({
  legend,
  options,
  chosen,
  onChange,
}: {
  legend: string
  options: { value: K; label: string }[]
  chosen: K[]
  onChange: (next: K[]) => void
}) {
  const toggle = (k: K) =>
    onChange(options.map((o) => o.value).filter((x) => (x === k ? !chosen.includes(x) : chosen.includes(x))))
  return (
    <fieldset className="space-y-1.5">
      <legend className="px-1 pb-1 text-[12px] text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label
            key={o.value}
            className="surface inline-flex min-h-9 cursor-pointer items-center rounded-full border border-line px-3 text-[13px] text-ink transition-colors hover:border-line-strong has-[:checked]:border-navy-400 has-[:checked]:bg-navy-500/8 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-navy-500/12"
          >
            <input type="checkbox" className="sr-only" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
```

In `CheckInExtras`, replace the dates markup with `<RangeFields r={r} choices={choices} />`, and the kinds fieldset with:

```tsx
          <ChipToggles
            legend="Kinds. None picked shows every kind."
            options={(Object.entries(NOTE_KIND_META) as [ClassNoteKind, { label: string }][]).map(([value, m]) => ({ value, label: m.label }))}
            chosen={r.noteKinds}
            onChange={r.setNoteKinds}
          />
```

Delete its now-unused `toggle`. Then add:

```tsx
/** The activity log's dates and filters: project, group, who acted, and kinds of event. */
function ActivityExtras({ r }: { r: ReturnType<typeof useReports> }) {
  const projectChosen = r.projects.some((p) => p.id === r.projectId)
  const groups = r.allBoards
    .filter((b) => !projectChosen || b.project_id === r.projectId)
    .map((b) => {
      const name = b.group_name ?? b.student_name ?? 'A board'
      return { value: b.id, label: projectChosen ? name : `${name} · ${b.project_title}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  return (
    <div className="space-y-3">
      <RangeFields r={r} choices={RANGE_CHOICES} />
      <Select
        aria-label="Project"
        value={projectChosen ? r.projectId : ''}
        onChange={(e) => {
          r.setProjectId(e.target.value)
          // A group belongs to one project, so a new project starts from every group.
          r.setBoardId('')
        }}
        options={[{ value: '', label: 'All projects' }, ...r.projects.map((p) => ({ value: p.id, label: p.title }))]}
        className={FIELD_SIZE}
      />
      <Select
        aria-label="Group"
        value={groups.some((g) => g.value === r.boardId) ? r.boardId : ''}
        onChange={(e) => r.setBoardId(e.target.value)}
        options={[{ value: '', label: 'Every group' }, ...groups]}
        className={FIELD_SIZE}
      />
      <Select
        aria-label="Who"
        value={r.students.some((s) => s.value === r.studentId) ? r.studentId : ''}
        onChange={(e) => r.setStudentId(e.target.value)}
        options={[{ value: '', label: 'Everyone' }, ...r.students]}
        className={FIELD_SIZE}
      />
      <ChipToggles
        legend="Events. None picked shows every kind."
        options={(Object.entries(EVENT_META) as [TaskEventKind, { label: string }][]).map(([value, m]) => ({ value, label: m.label }))}
        chosen={r.eventKinds}
        onChange={r.setEventKinds}
      />
    </div>
  )
}
```

6. In `Preview`, add `case 'formal':` and `case 'activity':` to the cases that draw a `ReportDoc`.

- [ ] **Step 7: Build, lint, test**

Run: `npm run build`, `npx eslint src`, `npx vitest run`
Expected: all clean. The old sheets still work beside the new reports.

- [ ] **Step 8: Check it in the browser**

Start the dev server with `preview_start` (`collabify` in `.claude/launch.json`). If no faculty session is signed in, ask the user to sign in and wait.
- Open Reports → Formal term record:
  - A class: check the Class, Projects, Syllabus coverage, Interventions and Work tables, the two signature lines, and an ended class.
  - Every class: check one row per class.
- Switch to the grading sheet with Every class chosen: it opens on the first class.
- Activity log:
  - Last 30 days, then each filter, then a kind chip.
  - A project change resets the group.
- No console errors after a reload.

- [ ] **Step 9: Commit**

```bash
git add src/pages/app/reports/reportKind.ts src/pages/app/reports/reportKind.test.ts src/pages/app/reports/useReports.ts src/pages/app/reports/useReportDoc.ts src/pages/app/reports/Reports.tsx src/components/reports/ReportPicker.tsx
git commit -m "$(cat <<'EOF'
Add the formal term record and the activity log to Reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Retire the seven old sheets

**Files:**
- Modify: `src/pages/app/reports/reportKind.ts`
- Modify: `src/pages/app/reports/reportKind.test.ts`
- Modify: `src/pages/app/reports/useReports.ts`
- Modify: `src/pages/app/reports/Reports.tsx`
- Modify: `src/components/reports/ReportPicker.tsx`
- Modify: `src/lib/api/reports.ts` (delete `boardTasks`)
- Delete: `src/components/reports/ClassTermSheet.tsx`, `TermSummarySheet.tsx`, `CoverageSheet.tsx`, `ClassRecordSheet.tsx`, `ComparisonSheet.tsx`, `src/components/reports/csv.ts`
- Keep: `BoardSheet.tsx`, `ContributionSheet.tsx`, `Sheet.tsx` (`StudentReports.tsx` and `ReportDocView.tsx` use them)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces:
  - `ReportKind = 'grading' | 'peer' | 'checkin' | 'notes' | 'progress' | 'deliverables' | 'formal' | 'activity'`
  - `NEEDS: Record<ReportKind, ('class' | 'project')[]>`
  - `LEGACY_REPORTS: Record<string, { kind: ReportKind; set: Record<string, string> }>`
  - `legacyRedirect(raw: string | null): Record<string, string> | null`

- [ ] **Step 1: Write the failing redirect test**

Append to `src/pages/app/reports/reportKind.test.ts` (and add `legacyRedirect` to its import):

```ts
describe('legacyRedirect', () => {
  it('opens each retired sheet as its replacement, with the address it needs', () => {
    expect(legacyRedirect('class_term')).toEqual({ report: 'formal' })
    expect(legacyRedirect('term_summary')).toEqual({ report: 'formal', rclass: 'all' })
    expect(legacyRedirect('coverage')).toEqual({ report: 'formal' })
    expect(legacyRedirect('contribution')).toEqual({ report: 'grading', rproject: '' })
    expect(legacyRedirect('class_record')).toEqual({ report: 'grading', rproject: 'all', rstudent: '' })
    expect(legacyRedirect('comparison')).toEqual({ report: 'progress', rgroup: '' })
    expect(legacyRedirect('board')).toEqual({ report: 'progress' })
  })
  it('leaves current and unknown reports alone', () => {
    expect(legacyRedirect('grading')).toBeNull()
    expect(legacyRedirect('toString')).toBeNull()
    expect(legacyRedirect(null)).toBeNull()
  })
  it('reads a retired name as its replacement until the address changes', () => {
    expect(parseReportKind('class_record')).toBe('grading')
    expect(parseReportKind('board')).toBe('progress')
    expect(parseReportKind('term_summary')).toBe('formal')
  })
})
```

Run: `npx vitest run src/pages/app/reports/reportKind.test.ts`
Expected: FAIL, `legacyRedirect` is not exported.

- [ ] **Step 2: Drop the old kinds and add the redirects**

Rewrite `src/pages/app/reports/reportKind.ts`, keeping `chosenClass` from Task 4 unchanged:

```ts
export type ReportKind = 'grading' | 'peer' | 'checkin' | 'notes' | 'progress' | 'deliverables' | 'formal' | 'activity'

/** Every report is built as a ReportDoc and shares the preview, the live refresh and the export menu. */
export const DOC_KINDS: ReportKind[] = ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables', 'formal', 'activity']

/** Which pickers a report needs before it can be drawn. */
export const NEEDS: Record<ReportKind, ('class' | 'project')[]> = {
  grading: ['class', 'project'],
  peer: ['class', 'project'],
  checkin: ['class'],
  notes: ['class'],
  progress: ['class', 'project'],
  deliverables: ['class', 'project'],
  formal: ['class'],
  activity: ['class'],
}

/** The seven sheets B4 retired, the report each now opens, and the address it needs there. */
export const LEGACY_REPORTS: Record<string, { kind: ReportKind; set: Record<string, string> }> = {
  class_term: { kind: 'formal', set: {} },
  term_summary: { kind: 'formal', set: { rclass: 'all' } },
  coverage: { kind: 'formal', set: {} },
  contribution: { kind: 'grading', set: { rproject: '' } },
  class_record: { kind: 'grading', set: { rproject: 'all', rstudent: '' } },
  comparison: { kind: 'progress', set: { rgroup: '' } },
  board: { kind: 'progress', set: {} },
}

/**
 * The report named in the address, or the grading sheet. A retired name reads
 * as its replacement. An own-key check, so `?report=toString` and the other
 * names every object inherits never pass for a report.
 */
export function parseReportKind(raw: string | null): ReportKind {
  if (raw && Object.hasOwn(LEGACY_REPORTS, raw)) return LEGACY_REPORTS[raw].kind
  return raw && Object.hasOwn(NEEDS, raw) ? (raw as ReportKind) : 'grading'
}

/** The address change that turns a retired sheet's link into its replacement, or null. */
export function legacyRedirect(raw: string | null): Record<string, string> | null {
  if (!raw || !Object.hasOwn(LEGACY_REPORTS, raw)) return null
  const { kind, set } = LEGACY_REPORTS[raw]
  return { report: kind, ...set }
}
```

Run: `npx vitest run src/pages/app/reports/reportKind.test.ts`
Expected: PASS.

- [ ] **Step 3: Strip the old loads from `useReports`**

In `src/pages/app/reports/useReports.ts`:

1. Remove these imports: `listReassignments`, `boardResult`, `boardTasks`, `weekCoverage`, and the types `BoardTask`, `WeekCoverage`, `ReassignmentRow`. Add `legacyRedirect` to the `./reportKind` import.
2. Remove the `weeks`, `tasks`, `feedback` and `reassignments` state, the `boardBusy` flag (`busy` becomes `classBusy`), the whole `boardSeq` effect, and the `board` memo.
3. In `loadClass`, load only `studentWork(classId)`, `listMembers(classId)` and `listProjectsForClasses([classId])`. Drop `setWeeks` and `setReassignments`. Remove `'task_reassignments'` and `'syllabus_weeks'` from its `useLive` list.
4. After `patch`, add:

```ts
  // A link to a retired sheet opens its replacement.
  const rawReport = params.get('report')
  useEffect(() => {
    const next = legacyRedirect(rawReport)
    if (next) patch(next)
  }, [rawReport, patch])
```

5. In `choose`, `NEEDS[next]` can no longer hold `'board'` or `'student'`. Make the two lines:

```ts
      if (next !== 'notes' && next !== 'activity') out.rgroup = ''
      if (!OPTIONAL_STUDENT.includes(next)) out.rstudent = ''
```

6. Replace `ready` with:

```ts
  const ready =
    !settling &&
    (!NEEDS[kind].includes('class') || Boolean(cls) || allClasses) &&
    (!NEEDS[kind].includes('project') ||
      projectFits(kind, projectId, projects) ||
      (OPTIONAL_STUDENT.includes(kind) && Boolean(studentId)))
```

7. Drop `weeks`, `tasks`, `feedback`, `reassignments` and `board` from the return value.

- [ ] **Step 4: Remove the old sheets from the page and picker**

In `src/pages/app/reports/Reports.tsx`:
1. Remove the imports of the five deleted sheets, `BoardSheet`, `ContributionSheet`, the `./csv` helpers, `downloadCsv`, `reportFilename` and `toCsv`.
2. Delete the "Older reports" catalogue group.
3. Make the class-page filter `const catalogue = CATALOGUE`, and drop its comment.
4. Delete `csvFor` and `csv`. `exports` becomes:

```ts
  const printReady = Boolean(d.doc && d.current)
  const exports: ActionMenuItem[] =
    d.doc && d.current
      ? exportItems(d.doc, EXPORT_BASE[r.kind] ?? '', (m) => show(m, 'error'))
      : [{ label: 'Nothing to export yet', onSelect: () => {}, disabled: true }]
```

5. `EXPORT_BASE` becomes `Record<ReportKind, string>`.
6. Pass `exports` and `printReady` to `ReportBar` and `ReportSidebar`, without `csv` or `onCsv`.
7. In `Preview`, drop the `cls` constant and every old case. The doc branch becomes the whole switch body (the empty state for `peer` stays). Remove the `professor` prop from `Preview` if nothing reads it.
8. Rewrite the page comment's sentence about the older reports' footer to: "Every report ends with its own footer lines and a Prepared by signature."

In `src/components/reports/ReportPicker.tsx`:
1. Remove `csv` from `ReportItem`.
2. Remove the `board` and `student` select blocks from `About`.
3. Remove `csv` and `onCsv` from `Actions`, `ReportSidebar` and `ReportBar`, and make `exports: ActionMenuItem[]` required. `Actions` always renders the `ActionMenu`, with no CSV button branch.
4. Delete the `csv` pill in `Catalogue`.
5. In the comments, change "nine reports in two groups" to "eight reports in four groups", and "seven" to "eight" where they count reports.

In `src/lib/api/reports.ts`, delete `boardTasks` and remove `BoardTask` from its type import.

- [ ] **Step 5: Delete the old files**

```bash
git rm src/components/reports/ClassTermSheet.tsx src/components/reports/TermSummarySheet.tsx src/components/reports/CoverageSheet.tsx src/components/reports/ClassRecordSheet.tsx src/components/reports/ComparisonSheet.tsx src/components/reports/csv.ts
```

Then check that nothing still names them:

Run (Grep tool): `ClassTermSheet|TermSummarySheet|CoverageSheet|ClassRecordSheet|ComparisonSheet|reports/csv|boardTasks\(` in `src/`
Expected: no matches.

Run (Grep tool): `'class_term'|'term_summary'|'class_record'|'comparison'|'contribution'|'coverage'` in `src/pages/app/reports` and `src/components/reports`
Expected: matches only in `reportKind.ts` and `reportKind.test.ts`.

- [ ] **Step 6: Build, lint, test**

Run: `npm run build`, `npx eslint src`, `npx vitest run`
Expected: all clean.

- [ ] **Step 7: Check the redirects in the browser**

With the dev server and a faculty session:
- Open each of these. Each should land on its replacement with the address rewritten, and log no console error.
  - `/teaching/reports?report=class_record`: grade book.
  - `?report=term_summary`: term record, Every class.
  - `?report=board&rproject=<id>&rgroup=<id>`: group progress, that group.
  - `?report=contribution&rstudent=<id>`: grading sheet for that student.
- Inside a class's Reports tab, `?tab=reports&report=term_summary` opens that class's term record.
- The catalogue shows four groups and no CSV pill.
- The students' own Reports page (`StudentReports`) still draws its two sheets.

- [ ] **Step 8: Commit**

```bash
git add src/pages/app/reports/reportKind.ts src/pages/app/reports/reportKind.test.ts src/pages/app/reports/useReports.ts src/pages/app/reports/Reports.tsx src/components/reports/ReportPicker.tsx src/lib/api/reports.ts
git commit -m "$(cat <<'EOF'
Retire the seven old report sheets and send their links to the new reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## After the tasks (controller)

1. Final whole-branch review on the most capable model.
2. Browser check, as faculty on live data:
   - both new reports and the redirects;
   - all four exports of each new report (Excel and Word read back in the page, as B3 did);
   - light and dark;
   - widths 375, 768 and 1440.
3. Merge to main and push, then confirm on dyci-collabify.vercel.app.
4. Append a "Phase B4" section to `docs/handoff.md`: the rulings above, anything parked, and that Phase B is complete.
5. Update the memory files.
