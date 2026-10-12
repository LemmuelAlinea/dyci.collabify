# Class Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four abstract Analytics bands with four question-led sub-views — Class, Groups, Students, Projects — built on real charts and trends from data Collabify already records.

**Architecture:**
- **Database.** Five new security-invoker Postgres views in `supabase/analytics-trends.sql` aggregate the history that already exists: task events, work log, comments, board results, milestones, sprints. `task_state` gains three columns.
- **Client.** `useAnalytics` loads the five new views next to the eleven existing reads and narrows them with the same `Scope`.
- **Math.** Pure functions in `src/lib/analyticsMath.ts` turn rows into series and flags. They are unit tested.
- **Charts.** Hand-built SVG/CSS components in `src/components/charts/` draw them. No chart library is added.

**Tech Stack:** React 19 + TypeScript + Vite, Tailwind tokens from `src/styles/index.css`, Supabase Postgres views, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-class-analytics-redesign-design.md`. Read the "Amendments during planning" section added in Task 1, which supersedes the original wording where they differ.

## Global Constraints

- Colors only from tokens: `surface*`, `text-ink|muted|faint`, `border-line*`, `navy-*`, `amber-*`, `success-*`, `warning-*`, `danger-*`, `bg-pending-soft`/`text-pending-ink`. Never a raw hex. Never `emerald-*` or `red-*`. Never brand amber for a status.
- Every color works in both light and dark: pair a light class with a `dark:` class wherever the ramp step changes.
- Copy is sentence case and active voice. No exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Every view in `supabase/analytics-trends.sql` must:
  - be `with (security_invoker = true)`
  - be filtered by `public.is_class_professor(<class_id>)`
  - exclude archived classes, projects and tasks
  - `grant select ... to authenticated`
  - be safe to re-run (`drop view if exists` → `create view`)
- Days are Philippine days. SQL uses `(x at time zone 'Asia/Manila')::date`. TypeScript uses `manilaDay()` from `src/lib/analyticsMath.ts`.
- Forecasts stay printed arithmetic. No models (`handoff.md:196-200`).
- Motion only through `components/motion/Reveal.tsx`, and reduced motion must stay honored.
- Layout is desktop first: chart grids are `lg:grid-cols-2`. Wide tables scroll horizontally inside their card below `md`.
- `npm run build` (runs `tsc -b`), `npm run lint` and `npm test` must pass at the end of every task.
- Commit messages follow the repo style: an imperative sentence, no prefix. They end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A view with more than 1,000 rows.** Supabase caps a select at 1,000 rows. A term of daily activity, or a big class's task list, would silently truncate the charts. Expected: every row arrives. Pinned by the `pageAll` test in Task 2.
2. **An event late in the evening, Philippine time.** For example 01:30 UTC is 09:30 Manila, but 17:30 UTC is 01:30 the *next* Manila day. Expected: it lands on the Manila day. Pinned by the `manilaDay` tests in Task 3 and the day-boundary assertion in Task 1.
3. **A class whose term has not started, or has no term dates.** Expected: charts show an empty state, never a crash or an inverted axis. Pinned by `burnupSeries` returning `[]` when `to < from` (Task 3).
4. **A class with only individual projects** (no groups). Expected: no "Low share" flag and a Gini of 0, never a false free-rider. Pinned by the one-member `gini` test and the `lowestShare: null` flag test (Task 3).
5. **A task reopened after being finished** (status no longer `done`, but `done_at` still set). Expected: it does not count as done in burnup or completion. Pinned by the reopened-task test in Task 3.

---

### Task 1: Trend views in the database

**Files:**
- Modify: `supabase/analytics.sql:255-285` (`task_state` gains `created_at`, `sprint_id`, `milestone_id`)
- Create: `supabase/analytics-trends.sql`
- Create: `supabase/tests/analytics-trends.test.sql`
- Modify: `docs/superpowers/specs/2026-10-13-class-analytics-redesign-design.md` (append an amendments section)

**Interfaces:**
- Produces these views, all scoped to the class professor:
  - `public.analytics_daily_activity(class_id, project_id, board_id, actor_id, day date, kind task_event_kind, n int)`
  - `public.analytics_student_roster(class_id, student_id, student_name, avatar_url, held int, done int, late int, worklog_minutes int, comments int, last_active_at timestamptz)`
  - `public.analytics_board_cycles(board_id, class_id, project_id, returns int, accepts int, submitted_at, last_decided_at, decision_hours numeric)`
  - `public.analytics_milestones(milestone_id, project_id, board_id, class_id, name, due_on date, tasks int, done int, last_done_at)`
  - `public.analytics_sprints(sprint_id, board_id, class_id, project_id, name, starts_on, ends_on, state sprint_state, tasks int, done int, done_in_window int)`
  - `public.task_state` gains the columns `created_at timestamptz`, `sprint_id uuid`, `milestone_id uuid`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/analytics-trends.test.sql`:

```sql
-- Analytics over time — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/analytics-trends.test.sql
--
-- Each figure is checked against the base tables it is counted from, so a view
-- that drifts from what is really there fails here, not on a professor's screen.

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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_task uuid; v_board uuid; v_class uuid; v_prof uuid; v_stud uuid; v_out uuid;
begin
  -- A live task held by an active member, in a live class: the smallest
  -- fixture every view below has something to say about.
  select t.id, t.board_id, p.class_id, c.professor_id, a.student_id
    into v_task, v_board, v_class, v_prof, v_stud
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.classes c on c.id = p.class_id
    join public.class_members m
      on m.class_id = c.id and m.student_id = a.student_id and m.status = 'active'
   where t.archived_at is null and p.archived_at is null and c.archived_at is null
   order by t.created_at
   limit 1;

  select id into v_out from public.profiles
   where role = 'student' and id not in (
     select student_id from public.class_members where class_id = v_class)
   limit 1;

  -- No term floor, so the fixed-date event below is inside the window.
  update public.classes set term_start = null where id = v_class;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('task', v_task), ('board', v_board), ('class', v_class),
    ('prof', v_prof), ('stud', v_stud), ('out', v_out);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------- activity

-- 17:30 UTC is 01:30 the next morning in Manila. The day is the Manila day.
do $$
declare
  n int;
begin
  insert into public.task_events (task_id, actor_id, kind, at)
  values ((select v from fx where k='task'), (select v from fx where k='stud'),
          'commented', '2026-03-01 17:30:00+00');

  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(a.n), 0) into n from public.analytics_daily_activity a
   where a.board_id = (select v from fx where k='board')
     and a.actor_id = (select v from fx where k='stud')
     and a.kind = 'commented' and a.day = date '2026-03-02';
  perform pg_temp.must_be('an event at 01:30 Manila lands on the Manila day', n >= 1);
  perform pg_temp.act_as_service();
end $$;

-- Every event on a live task in the class is counted exactly once.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  got int; want int;
begin
  select count(*) into want
    from public.task_events e
    join public.project_tasks t on t.id = e.task_id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where p.class_id = v_class and t.archived_at is null and p.archived_at is null;

  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(n), 0) into got
    from public.analytics_daily_activity where class_id = v_class;
  perform pg_temp.must_be('daily activity adds up to the events it is built from', got = want);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- roster

do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_stud uuid := (select v from fx where k='stud');
  want int; r public.analytics_student_roster%rowtype;
  v_at timestamptz := clock_timestamp();
begin
  select count(*) into want
    from public.task_assignees a
    join public.project_tasks t on t.id = a.task_id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where p.class_id = v_class and a.student_id = v_stud
     and t.archived_at is null and p.archived_at is null;

  insert into public.task_events (task_id, actor_id, kind, at)
  values ((select v from fx where k='task'), v_stud, 'started', v_at);

  perform pg_temp.act_as((select v from fx where k='prof'));
  select * into r from public.analytics_student_roster
   where class_id = v_class and student_id = v_stud;
  perform pg_temp.must_be('the roster counts every live task a student holds', r.held = want);
  perform pg_temp.must_be('...never more done than held', r.done <= r.held);
  perform pg_temp.must_be('...never more late than done', r.late <= r.done);
  perform pg_temp.must_be('last active is their latest event', r.last_active_at >= v_at);
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- cycles

do $$
declare
  v_board uuid := (select v from fx where k='board');
  want int; got int;
begin
  select count(*) into want from public.board_results
   where board_id = v_board and verdict = 'returned';
  perform pg_temp.act_as((select v from fx where k='prof'));
  select returns into got from public.analytics_board_cycles where board_id = v_board;
  perform pg_temp.must_be('returns count every return in the history, not just the latest',
    got = want);
  select count(*) into got from public.analytics_board_cycles where decision_hours < 0;
  perform pg_temp.must_be('a decision never comes before its hand-in', got = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- milestones and sprints

do $$
declare
  n int;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.analytics_milestones where done > tasks;
  perform pg_temp.must_be('a milestone never has more done than it has', n = 0);
  select count(*) into n from public.analytics_sprints
   where done > tasks or done_in_window > done;
  perform pg_temp.must_be('a sprint never finishes more in its window than it finished', n = 0);
  select count(*) into n from public.task_state where created_at is null;
  perform pg_temp.must_be('every task in task_state carries when it was created', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- who sees

do $$
declare
  v_class uuid := (select v from fx where k='class');
  who text; v_user uuid; n int;
begin
  foreach who in array array['stud', 'out'] loop
    v_user := (select v from fx where k = who);
    perform pg_temp.act_as(v_user);
    select (select count(*) from public.analytics_daily_activity where class_id = v_class)
         + (select count(*) from public.analytics_student_roster where class_id = v_class)
         + (select count(*) from public.analytics_board_cycles where class_id = v_class)
         + (select count(*) from public.analytics_milestones where class_id = v_class)
         + (select count(*) from public.analytics_sprints where class_id = v_class)
      into n;
    perform pg_temp.must_be(format('%s reads no trend analytics of the class', who), n = 0);
    perform pg_temp.act_as_service();
  end loop;
end $$;

-- An archived class leaves every trend view.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select (select count(*) from public.analytics_daily_activity where class_id = v_class)
       + (select count(*) from public.analytics_student_roster where class_id = v_class)
       + (select count(*) from public.analytics_board_cycles where class_id = v_class)
       + (select count(*) from public.analytics_milestones where class_id = v_class)
       + (select count(*) from public.analytics_sprints where class_id = v_class)
    into n;
  perform pg_temp.must_be('an archived class leaves every trend view', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node scripts/db.mjs supabase/tests/analytics-trends.test.sql`
Expected: an error mentioning `relation "public.analytics_daily_activity" does not exist`.

- [ ] **Step 3: Extend `task_state`**

In `supabase/analytics.sql`, inside `create view public.task_state`, add three columns after `t.done_at,`. The view is dropped and recreated, and nothing else depends on it (checked with `grep -rln task_state supabase/`):

```sql
       t.started_at,
       t.done_at,
       t.created_at,
       t.sprint_id,
       t.milestone_id,
       b.id            as board_id,
```

- [ ] **Step 4: Write `supabase/analytics-trends.sql`**

```sql
-- Collabify — analytics over time: activity by day, the class roster, hand-in
-- cycles, milestones and sprints.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/analytics-trends.sql
-- Requires: tasks.sql, task-detail.sql, results.sql, class-milestones.sql,
-- class-planning.sql, analytics.sql.

/**
 * Views only. All of this was already recorded — task_events has held every
 * claim, start, finish and comment since the first task — and none of it was
 * being drawn.
 *
 * Grouped joins, never a correlated lateral per member: class_participation
 * learned that the hard way (analytics-insight.sql), quadratic in members x
 * boards.
 *
 * Days are Philippine days. A comment at 01:30 belongs to the day the student
 * lived it, not to the UTC day before.
 */

begin;

-- ------------------------------------------------------------- activity

drop view if exists public.analytics_daily_activity;

create view public.analytics_daily_activity
with (security_invoker = true) as
select p.class_id,
       b.project_id,
       b.id                                       as board_id,
       e.actor_id,
       (e.at at time zone 'Asia/Manila')::date    as day,
       e.kind,
       count(*)::int                              as n
  from public.task_events e
  join public.project_tasks t  on t.id = e.task_id
  join public.project_boards b on b.id = t.board_id
  join public.projects p       on p.id = b.project_id
  join public.classes c        on c.id = p.class_id
 where t.archived_at is null
   and p.archived_at is null
   and c.archived_at is null
   and (c.term_start is null or (e.at at time zone 'Asia/Manila')::date >= c.term_start)
   and public.is_class_professor(p.class_id)
 group by p.class_id, b.project_id, b.id, e.actor_id,
          (e.at at time zone 'Asia/Manila')::date, e.kind;

grant select on public.analytics_daily_activity to authenticated;

-- --------------------------------------------------------------- roster

drop view if exists public.analytics_student_roster;

create view public.analytics_student_roster
with (security_invoker = true) as
with live as (
  select t.id, t.status, t.late, p.class_id
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p       on p.id = b.project_id
   where t.archived_at is null and p.archived_at is null
)
select c.id                                         as class_id,
       cm.student_id,
       btrim(pr.first_name || ' ' || pr.last_name)  as student_name,
       pr.avatar_url,
       coalesce(h.held, 0)                          as held,
       coalesce(h.done, 0)                          as done,
       coalesce(h.late, 0)                          as late,
       coalesce(w.minutes, 0)                       as worklog_minutes,
       coalesce(k.comments, 0)                      as comments,
       -- greatest() skips nulls, so one kind of activity is enough.
       greatest(ev.last_at, k.last_at, w.last_at)   as last_active_at
  from public.classes c
  join public.class_members cm on cm.class_id = c.id and cm.status = 'active'
  join public.profiles pr      on pr.id = cm.student_id
  left join (
    select l.class_id, a.student_id,
           count(*)::int                                    as held,
           count(*) filter (where l.status = 'done')::int   as done,
           count(*) filter (where l.late)::int              as late
      from live l
      join public.task_assignees a on a.task_id = l.id
     group by l.class_id, a.student_id
  ) h on h.class_id = c.id and h.student_id = cm.student_id
  left join (
    select l.class_id, wl.student_id,
           sum(wl.minutes)::int as minutes, max(wl.created_at) as last_at
      from public.task_worklog wl
      join live l on l.id = wl.task_id
     group by l.class_id, wl.student_id
  ) w on w.class_id = c.id and w.student_id = cm.student_id
  left join (
    select l.class_id, tc.author_id as student_id,
           count(*)::int as comments, max(tc.created_at) as last_at
      from public.task_comments tc
      join live l on l.id = tc.task_id
     group by l.class_id, tc.author_id
  ) k on k.class_id = c.id and k.student_id = cm.student_id
  left join (
    select l.class_id, e.actor_id as student_id, max(e.at) as last_at
      from public.task_events e
      join live l on l.id = e.task_id
     group by l.class_id, e.actor_id
  ) ev on ev.class_id = c.id and ev.student_id = cm.student_id
 where c.archived_at is null
   and public.is_class_professor(c.id);

grant select on public.analytics_student_roster to authenticated;

-- ---------------------------------------------------------------- cycles

/**
 * Every answer a board has had, not only the standing one. A group returned
 * twice is a different conversation from one returned once.
 *
 * Returning a board clears submitted_at (results.sql), so only the latest
 * hand-in time survives and decision_hours speaks for the latest cycle only.
 * Null while a resubmission waits for its answer.
 */
drop view if exists public.analytics_board_cycles;

create view public.analytics_board_cycles
with (security_invoker = true) as
select b.id                                                        as board_id,
       p.class_id,
       b.project_id,
       count(r.id) filter (where r.verdict = 'returned')::int      as returns,
       count(r.id) filter (where r.verdict = 'accepted')::int      as accepts,
       b.submitted_at,
       max(r.decided_at)                                           as last_decided_at,
       case when b.submitted_at is null or max(r.decided_at) is null
                 or max(r.decided_at) < b.submitted_at then null
            else round((extract(epoch from (max(r.decided_at) - b.submitted_at)) / 3600)::numeric, 1)
       end                                                         as decision_hours
  from public.project_boards b
  join public.projects p on p.id = b.project_id
  join public.classes c  on c.id = p.class_id
  left join public.board_results r on r.board_id = b.id
 where p.archived_at is null
   and c.archived_at is null
   and public.is_class_professor(p.class_id)
 group by b.id, p.class_id, b.project_id, b.submitted_at;

grant select on public.analytics_board_cycles to authenticated;

-- ------------------------------------------------------------ milestones

/** A milestone belongs to a project; each group reaches it through its own tasks. */
drop view if exists public.analytics_milestones;

create view public.analytics_milestones
with (security_invoker = true) as
select ms.id                                            as milestone_id,
       ms.project_id,
       b.id                                             as board_id,
       p.class_id,
       ms.name,
       ms.due_on,
       count(t.id)::int                                 as tasks,
       count(t.id) filter (where t.status = 'done')::int as done,
       max(t.done_at)                                   as last_done_at
  from public.project_milestones ms
  join public.projects p       on p.id = ms.project_id
  join public.classes c        on c.id = p.class_id
  join public.project_boards b on b.project_id = ms.project_id
  left join public.project_tasks t
    on t.board_id = b.id and t.milestone_id = ms.id and t.archived_at is null
 where p.archived_at is null
   and c.archived_at is null
   and public.is_class_professor(p.class_id)
 group by ms.id, ms.project_id, b.id, p.class_id, ms.name, ms.due_on;

grant select on public.analytics_milestones to authenticated;

-- --------------------------------------------------------------- sprints

/**
 * What a sprint finished inside its own dates. Completing a sprint moves its
 * open tasks on (class-planning.sql), so what it was committed to at the start
 * is not recoverable from today's rows and is not claimed here.
 */
drop view if exists public.analytics_sprints;

create view public.analytics_sprints
with (security_invoker = true) as
select s.id                                              as sprint_id,
       s.board_id,
       p.class_id,
       b.project_id,
       s.name,
       s.starts_on,
       s.ends_on,
       s.state,
       count(t.id)::int                                  as tasks,
       count(t.id) filter (where t.status = 'done')::int as done,
       count(t.id) filter (
         where t.status = 'done'
           and (t.done_at at time zone 'Asia/Manila')::date between s.starts_on and s.ends_on
       )::int                                            as done_in_window
  from public.board_sprints s
  join public.project_boards b on b.id = s.board_id
  join public.projects p       on p.id = b.project_id
  join public.classes c        on c.id = p.class_id
  left join public.project_tasks t on t.sprint_id = s.id and t.archived_at is null
 where p.archived_at is null
   and c.archived_at is null
   and public.is_class_professor(p.class_id)
 group by s.id, s.board_id, p.class_id, b.project_id, s.name, s.starts_on, s.ends_on, s.state;

grant select on public.analytics_sprints to authenticated;

commit;
```

- [ ] **Step 5: Apply both files and run the test**

Run:
```bash
node scripts/db.mjs supabase/analytics.sql
node scripts/db.mjs supabase/analytics-trends.sql
node scripts/db.mjs supabase/tests/analytics-trends.test.sql
```
Expected: a `PASS` notice for every `must_be` and no `FAIL`. Then re-run `node scripts/db.mjs supabase/tests/analytics.test.sql` and confirm the existing suite still passes.

- [ ] **Step 6: Record the planning amendments in the spec**

Append to `docs/superpowers/specs/2026-10-13-class-analytics-redesign-design.md`:

```markdown
## Amendments during planning (2026-10-13)

- The daily view is named `analytics_daily_activity`. It returns one row per day and the client buckets the days into weeks.
- **Share of group work is `held_pct`, not `personal_pct`.** `personal_pct` is how much of a student's *own* work is finished (`task-points.sql:66`). The share bar, Gini and the "Low share" flag all use `held_pct`.
- `analytics_board_cycles` has these columns: `returns, accepts, submitted_at, last_decided_at, decision_hours`. Returning a board clears `submitted_at`, so `decision_hours` covers the latest cycle only.
- The roster uses the stored `late` flag (`deadline-lock.sql:28`) rather than comparing `done_at` with `due_at`. Late rate is late ÷ done.
- **Syllabus pace** shows weeks covered and weeks elapsed as two bars, not lines over time. Coverage history is not recorded.
- **Student drawer:**
  - Shows total work-log hours, not hours per week; a per-week figure needs another view.
  - Leaves out reassignment requests, which Analytics does not load.
  - Uses the existing `Modal` (size `lg`) rather than a new side-sheet component.
- **The "Needs attention" tile** has no sparkline, because past action counts are not recorded.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/analytics.sql supabase/analytics-trends.sql supabase/tests/analytics-trends.test.sql docs/superpowers/specs/2026-10-13-class-analytics-redesign-design.md
git commit -m "Add trend views for class analytics: activity, roster, cycles, milestones, sprints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Row types, paged fetchers, and loading them

**Files:**
- Modify: `src/lib/types.ts` (add types after `TaskState`, around line 1195; extend `TaskState`)
- Create: `src/lib/api/paging.ts`
- Test: `src/lib/api/paging.test.ts`
- Modify: `src/lib/api/analytics.ts`
- Modify: `src/pages/app/analytics/useAnalytics.ts`

**Interfaces:**
- Consumes: the views from Task 1.
- Produces:
  - Types `ActivityKind`, `ActivityDay`, `RosterRow`, `BoardCycle`, `MilestoneProgress`, `SprintProgress`. `TaskState` gains `created_at: string; sprint_id: string | null; milestone_id: string | null`.
  - `pageAll<T>(fetchPage: (from: number, to: number) => Promise<T[]>, size?: number): Promise<T[]>`
  - Fetchers: `dailyActivity(): Promise<ActivityDay[]>`, `studentRoster(): Promise<RosterRow[]>`, `boardCycles(): Promise<BoardCycle[]>`, `milestoneProgress(): Promise<MilestoneProgress[]>`, `sprintProgress(): Promise<SprintProgress[]>`. `taskStates()` now pages.
  - `useAnalytics` returns, in addition to its current fields: `shownActivity: ActivityDay[]`, `shownRoster: RosterRow[]`, `shownCycles: BoardCycle[]`, `shownMilestones: MilestoneProgress[]`, `shownSprints: SprintProgress[]`, `pace: ClassPace[]` (raw), `people: Participation[]` (raw).
  - `export type AnalyticsData = ReturnType<typeof useAnalytics>`.

- [ ] **Step 1: Write the failing paging test**

Create `src/lib/api/paging.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pageAll } from './paging'

/**
 * Supabase hands back at most a thousand rows per select. A term of daily
 * activity passes that in a few weeks, and a truncated read draws a chart that
 * simply stops — wrong, and nothing on screen says so.
 */
describe('pageAll', () => {
  const source = Array.from({ length: 2503 }, (_, i) => i)
  const fetchPage = async (from: number, to: number) => source.slice(from, to + 1)

  it('reads every row across pages', async () => {
    expect(await pageAll(fetchPage, 1000)).toEqual(source)
  })

  it('stops after a short page without asking again', async () => {
    let calls = 0
    await pageAll(async (from, to) => {
      calls++
      return source.slice(from, to + 1)
    }, 1000)
    expect(calls).toBe(3)
  })

  it('makes one extra call when the total is an exact multiple', async () => {
    let calls = 0
    const rows = await pageAll(async (from, to) => {
      calls++
      return source.slice(0, 2000).slice(from, to + 1)
    }, 1000)
    expect(rows).toHaveLength(2000)
    expect(calls).toBe(3)
  })

  it('returns an empty list for an empty source', async () => {
    expect(await pageAll(async () => [], 1000)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/api/paging.test.ts`
Expected: FAIL, "Failed to resolve import ./paging".

- [ ] **Step 3: Write `src/lib/api/paging.ts`**

```ts
export const PAGE_SIZE = 1000

/**
 * Every row of a read, a page at a time. The caller's query must have a stable
 * order, or rows can repeat or go missing between pages.
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  size = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = await fetchPage(from, from + size - 1)
    out.push(...rows)
    if (rows.length < size) return out
  }
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/lib/api/paging.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the row types to `src/lib/types.ts`**

In `export type TaskState`, add three fields after `done_at`:

```ts
  started_at: string | null
  done_at: string | null
  created_at: string
  sprint_id: string | null
  milestone_id: string | null
```

Directly after the `TaskState` type, add:

```ts
/** `task_event_kind` in the database, including the kinds task-detail.sql adds. */
export type ActivityKind =
  | 'created'
  | 'edited'
  | 'claimed'
  | 'unclaimed'
  | 'assigned'
  | 'started'
  | 'finished'
  | 'reopened'
  | 'commented'
  | 'logged'
  | 'file_added'
  | 'file_removed'

/** analytics_daily_activity: events per board, person, Philippine day and kind. */
export type ActivityDay = {
  class_id: string
  project_id: string
  board_id: string
  actor_id: string | null
  day: string
  kind: ActivityKind
  n: number
}

/** analytics_student_roster: one active class member and the evidence of their work. */
export type RosterRow = {
  class_id: string
  student_id: string
  student_name: string
  avatar_url: string | null
  held: number
  done: number
  late: number
  worklog_minutes: number
  comments: number
  last_active_at: string | null
}

/** analytics_board_cycles: every answer a board has had. */
export type BoardCycle = {
  board_id: string
  class_id: string
  project_id: string
  returns: number
  accepts: number
  submitted_at: string | null
  last_decided_at: string | null
  /** The latest cycle only; null while a hand-in waits for an answer. */
  decision_hours: number | null
}

/** analytics_milestones: one project milestone as one board is reaching it. */
export type MilestoneProgress = {
  milestone_id: string
  project_id: string
  board_id: string
  class_id: string
  name: string
  due_on: string
  tasks: number
  done: number
  last_done_at: string | null
}

/** analytics_sprints: what a sprint finished inside its own dates. */
export type SprintProgress = {
  sprint_id: string
  board_id: string
  class_id: string
  project_id: string
  name: string
  starts_on: string
  ends_on: string
  state: 'planned' | 'active' | 'completed'
  tasks: number
  done: number
  done_in_window: number
}
```

- [ ] **Step 6: Add the fetchers to `src/lib/api/analytics.ts`**

Extend the type import at the top:

```ts
import type {
  ActivityDay,
  BoardBurn,
  BoardCycle,
  ClassGap,
  ClassHealth,
  ClassPace,
  ClassUnmeasured,
  MemberLoad,
  MilestoneProgress,
  RosterRow,
  SprintProgress,
  TaskState,
} from '../types'
import { pageAll } from './paging'
```

Replace `taskStates` with a paged version:

```ts
/** The leaf of the filter chain. Paged: a busy class passes a thousand tasks. */
export async function taskStates() {
  return pageAll<TaskState>(async (from, to) => {
    const { data, error } = await supabase
      .from('task_state')
      .select('*')
      .order('task_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as TaskState[]
  })
}
```

Then append:

```ts
/* ------------------------------------------------------------ over time */

/** Events per board, person, day and kind. Paged: a term runs to thousands of rows. */
export async function dailyActivity() {
  return pageAll<ActivityDay>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_daily_activity')
      .select('*')
      .order('day')
      .order('board_id')
      .order('actor_id', { nullsFirst: true })
      .order('kind')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ActivityDay[]
  })
}

export async function studentRoster() {
  const { data, error } = await supabase
    .from('analytics_student_roster')
    .select('*')
    .order('student_name')
  if (error) throw error
  return (data ?? []) as RosterRow[]
}

export async function boardCycles() {
  const { data, error } = await supabase.from('analytics_board_cycles').select('*')
  if (error) throw error
  return (data ?? []) as BoardCycle[]
}

export async function milestoneProgress() {
  const { data, error } = await supabase
    .from('analytics_milestones')
    .select('*')
    .order('due_on')
  if (error) throw error
  return (data ?? []) as MilestoneProgress[]
}

export async function sprintProgress() {
  const { data, error } = await supabase
    .from('analytics_sprints')
    .select('*')
    .order('starts_on')
  if (error) throw error
  return (data ?? []) as SprintProgress[]
}
```

- [ ] **Step 7: Load and narrow them in `useAnalytics.ts`**

Add these to the existing imports:

```ts
import {
  boardBurn,
  boardCycles,
  boardDiagnoses,
  classActions,
  classGaps,
  classHealth,
  classPace,
  classParticipation,
  classesUnmeasured,
  dailyActivity,
  deadlinePressure,
  memberLoad,
  milestoneProgress,
  sprintProgress,
  studentRoster,
  taskStates,
} from '../../../lib/api/analytics'
```

and to the types import, add `ActivityDay, BoardCycle, MilestoneProgress, RosterRow, SprintProgress`.

Add state next to the others:

```ts
  const [activity, setActivity] = useState<ActivityDay[]>([])
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [cycles, setCycles] = useState<BoardCycle[]>([])
  const [milestones, setMilestones] = useState<MilestoneProgress[]>([])
  const [sprints, setSprints] = useState<SprintProgress[]>([])
```

Replace the `Promise.all` block inside `load` with:

```ts
      const [p, u, g, h, m, b, t, d, pa, pr, ac, av, ro, cy, ms, sp] = await Promise.all([
        classPace(),
        classesUnmeasured(),
        classGaps(),
        classHealth(),
        memberLoad(),
        boardBurn(),
        taskStates(),
        boardDiagnoses(),
        classParticipation(),
        deadlinePressure(),
        classActions(),
        dailyActivity(),
        studentRoster(),
        boardCycles(),
        milestoneProgress(),
        sprintProgress(),
      ])
      setPace(p)
      setUnmeasured(u)
      setGaps(g)
      setHealth(h)
      setMembers(m)
      setBurns(b)
      setTasks(t)
      setDiagnoses(d)
      setPeople(pa)
      setPressure(pr)
      setActionRows(ac)
      setActivity(av)
      setRoster(ro)
      setCycles(cy)
      setMilestones(ms)
      setSprints(sp)
      setError(null)
```

Replace the `useLive` line with:

```ts
  useLive(load, [
    'project_tasks', 'task_assignees', 'project_boards', 'projects', 'board_results',
    'task_events', 'task_reassignments', 'syllabus_weeks', 'class_members',
    'task_worklog', 'task_comments', 'board_sprints', 'project_milestones',
  ])
```

After `shownPressure`, add the narrowed sets:

```ts
  const shownActivity = useMemo(
    () =>
      activity
        .filter((a) => (scope.classId ? a.class_id === scope.classId : true))
        .filter((a) => (scope.projectId ? a.project_id === scope.projectId : true))
        .filter((a) => (scope.boardId ? a.board_id === scope.boardId : true))
        .filter((a) => (scope.studentId ? a.actor_id === scope.studentId : true)),
    [activity, scope],
  )
  const shownRoster = useMemo(
    () =>
      roster
        .filter((r) => (scope.classId ? r.class_id === scope.classId : true))
        .filter((r) => (scope.studentId ? r.student_id === scope.studentId : true)),
    [roster, scope.classId, scope.studentId],
  )
  const shownCycles = useMemo(
    () =>
      cycles
        .filter((c) => (scope.classId ? c.class_id === scope.classId : true))
        .filter((c) => (scope.projectId ? c.project_id === scope.projectId : true))
        .filter((c) => (scope.boardId ? c.board_id === scope.boardId : true)),
    [cycles, scope],
  )
  const shownMilestones = useMemo(
    () =>
      milestones
        .filter((m) => (scope.classId ? m.class_id === scope.classId : true))
        .filter((m) => (scope.projectId ? m.project_id === scope.projectId : true))
        .filter((m) => (scope.boardId ? m.board_id === scope.boardId : true)),
    [milestones, scope],
  )
  const shownSprints = useMemo(
    () =>
      sprints
        .filter((s) => (scope.classId ? s.class_id === scope.classId : true))
        .filter((s) => (scope.projectId ? s.project_id === scope.projectId : true))
        .filter((s) => (scope.boardId ? s.board_id === scope.boardId : true)),
    [sprints, scope],
  )
```

In the returned object, add after `actions,`:

```ts
    shownActivity,
    shownRoster,
    shownCycles,
    shownMilestones,
    shownSprints,
    // Raw, for class-level facts the views need whatever the narrowing.
    pace: pace ?? [],
    people,
```

At the bottom of the file, add:

```ts
export type AnalyticsData = ReturnType<typeof useAnalytics>
```

- [ ] **Step 8: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all pass. The page renders as before, since nothing consumes the new fields yet.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/api/paging.ts src/lib/api/paging.test.ts src/lib/api/analytics.ts src/pages/app/analytics/useAnalytics.ts
git commit -m "Load the trend views into analytics and page reads past a thousand rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Analytics math

**Files:**
- Create: `src/lib/analyticsMath.ts`
- Test: `src/lib/analyticsMath.test.ts`

**Interfaces:**
- Consumes: `ActivityDay`, `ActivityKind`, `TaskState` from `src/lib/types.ts` (Task 2).
- Produces (exact exports):
  - `LOW_SHARE_PCT = 10`, `INACTIVE_DAYS = 7`, `OFTEN_LATE_MIN = 3`, `OFTEN_LATE_RATE = 0.3`, `STUCK_DAYS = 7`
  - `type Tone = 'success' | 'warning' | 'danger' | 'pending'`
  - `manilaDay(t: string | Date): string`, `addDays(day: string, n: number): string`, `daysBetween(from: string, to: string): number`, `mondayOf(day: string): string`, `lastWeeks(today: string, n: number): string[]`
  - `gini(values: number[]): number`
  - `WORK_KINDS`, `TALK_KINDS`, `type WeekRow = { week: string; work: number; talk: number }`, `weeklyActivity(rows: ActivityDay[], from: string, to: string): WeekRow[]`
  - `type BurnupPoint = { day: string; scope: number; done: number }`, `burnupSeries(tasks: TimedTask[], from: string, to: string): BurnupPoint[]`
  - `completionByWeek(tasks: TimedTask[], weeks: string[]): (number | null)[]`, `onTimeByWeek(tasks: FinishedTask[], weeks: string[]): (number | null)[]`, `activeByWeek(rows: ActivityDay[], people: Set<string>, weeks: string[]): number[]`
  - `type HealthMeasure = 'pace' | 'overdue' | 'gini' | 'idle' | 'returns'`, `healthTone(measure: HealthMeasure, value: number | null): Tone`
  - `type StudentFlag = 'no_group' | 'holding_nothing' | 'low_share' | 'inactive' | 'often_late'`, `type FlagInput`, `studentFlags(s: FlagInput, now: Date): StudentFlag[]`, `idleDays(last: string | null, now: Date): number | null`
  - `type MilestoneState = 'met' | 'late' | 'upcoming' | 'no_tasks'`, `milestoneState(m, today: string): MilestoneState`
  - `isStuck(t: Pick<TaskState, 'status' | 'started_at'>, now: Date): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/analyticsMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  activeByWeek,
  addDays,
  burnupSeries,
  completionByWeek,
  daysBetween,
  gini,
  healthTone,
  isStuck,
  lastWeeks,
  manilaDay,
  milestoneState,
  mondayOf,
  onTimeByWeek,
  studentFlags,
  weeklyActivity,
} from './analyticsMath'
import type { FlagInput } from './analyticsMath'
import type { ActivityDay } from './types'

const ev = (day: string, kind: ActivityDay['kind'], n = 1, actor = 's1'): ActivityDay => ({
  class_id: 'c', project_id: 'p', board_id: 'b', actor_id: actor, day, kind, n,
})

describe('dates', () => {
  it('reads an instant as the Manila day, not the UTC day', () => {
    expect(manilaDay('2026-03-01T17:30:00Z')).toBe('2026-03-02')
    expect(manilaDay('2026-03-01T15:59:00Z')).toBe('2026-03-01')
  })
  it('adds days across a month end', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3)
  })
  it('finds the Monday of a week, Sunday included', () => {
    expect(mondayOf('2026-10-13')).toBe('2026-10-12') // Tuesday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12') // Sunday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12') // Monday
  })
  it('lists the last n Mondays oldest first', () => {
    expect(lastWeeks('2026-10-13', 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
  })
})

describe('gini', () => {
  it('is zero for an even split', () => {
    expect(gini([25, 25, 25, 25])).toBe(0)
  })
  it('is 0.75 when one of four does everything', () => {
    expect(gini([0, 0, 0, 100])).toBe(0.75)
  })
  it('is 0.5 when one of two does everything', () => {
    expect(gini([0, 100])).toBe(0.5)
  })
  it('is zero for one member or nothing at all, never a false alarm', () => {
    expect(gini([100])).toBe(0)
    expect(gini([])).toBe(0)
    expect(gini([0, 0])).toBe(0)
  })
})

describe('weeklyActivity', () => {
  it('splits work from talk and zero-fills empty weeks', () => {
    const rows = [
      ev('2026-10-05', 'finished', 2),
      ev('2026-10-06', 'commented', 3),
      ev('2026-10-19', 'started'),
      ev('2026-10-19', 'edited', 9), // neither work nor talk
    ]
    expect(weeklyActivity(rows, '2026-10-05', '2026-10-20')).toEqual([
      { week: '2026-10-05', work: 2, talk: 3 },
      { week: '2026-10-12', work: 0, talk: 0 },
      { week: '2026-10-19', work: 1, talk: 0 },
    ])
  })
})

describe('burnupSeries', () => {
  const task = (created: string, done: string | null, status: 'todo' | 'in_progress' | 'done' = done ? 'done' : 'todo') => ({
    created_at: created, done_at: done, status,
  })

  it('counts scope and done per day, carrying earlier work into the first day', () => {
    const tasks = [
      task('2026-09-30T02:00:00Z', '2026-10-02T02:00:00Z'),
      task('2026-10-02T02:00:00Z', null),
    ]
    expect(burnupSeries(tasks, '2026-10-01', '2026-10-03')).toEqual([
      { day: '2026-10-01', scope: 1, done: 0 },
      { day: '2026-10-02', scope: 2, done: 1 },
      { day: '2026-10-03', scope: 2, done: 1 },
    ])
  })
  it('does not count a reopened task as done', () => {
    const tasks = [task('2026-10-01T02:00:00Z', '2026-10-01T05:00:00Z', 'in_progress')]
    expect(burnupSeries(tasks, '2026-10-01', '2026-10-01')).toEqual([
      { day: '2026-10-01', scope: 1, done: 0 },
    ])
  })
  it('is empty when the window has not begun', () => {
    expect(burnupSeries([], '2026-11-01', '2026-10-01')).toEqual([])
  })
})

describe('weekly series', () => {
  const tasks = [
    { created_at: '2026-09-29T02:00:00Z', done_at: '2026-10-06T02:00:00Z', status: 'done' as const, late: false },
    { created_at: '2026-09-29T02:00:00Z', done_at: '2026-10-07T02:00:00Z', status: 'done' as const, late: true },
    { created_at: '2026-10-13T02:00:00Z', done_at: null, status: 'todo' as const, late: false },
  ]
  const weeks = ['2026-09-28', '2026-10-05', '2026-10-12']

  it('completion is done over scope at each week end', () => {
    expect(completionByWeek(tasks, weeks)).toEqual([0, 100, 67])
  })
  it('on-time is the share finished in that week that was not late', () => {
    expect(onTimeByWeek(tasks, weeks)).toEqual([null, 50, null])
  })
  it('active counts each listed person once per week', () => {
    const rows = [ev('2026-10-05', 'started', 1, 's1'), ev('2026-10-06', 'finished', 1, 's1'),
                  ev('2026-10-06', 'commented', 1, 'prof')]
    expect(activeByWeek(rows, new Set(['s1', 's2']), weeks)).toEqual([0, 1, 0])
  })
})

describe('healthTone', () => {
  it.each([
    ['pace', 0, 'success'], ['pace', -19, 'warning'], ['pace', -20, 'danger'],
    ['overdue', 0, 'success'], ['overdue', 2, 'warning'], ['overdue', 3, 'danger'],
    ['gini', 0.29, 'success'], ['gini', 0.5, 'warning'], ['gini', 0.51, 'danger'],
    ['idle', 3, 'success'], ['idle', 6, 'warning'], ['idle', 7, 'danger'],
    ['returns', 0, 'success'], ['returns', 1, 'warning'], ['returns', 2, 'danger'],
  ] as const)('%s %d is %s', (measure, value, tone) => {
    expect(healthTone(measure, value)).toBe(tone)
  })
  it('is pending when there is nothing to measure', () => {
    expect(healthTone('idle', null)).toBe('pending')
  })
})

describe('studentFlags', () => {
  const now = new Date('2026-10-13T04:00:00Z')
  const base: FlagInput = {
    held: 4, done: 2, late: 0, lowestShare: 30, inAnyGroup: true,
    lastActiveAt: '2026-10-12T04:00:00Z', termStarted: true,
  }
  it('flags nothing for a student pulling their weight', () => {
    expect(studentFlags(base, now)).toEqual([])
  })
  it('flags someone in a group who holds nothing', () => {
    expect(studentFlags({ ...base, held: 0, done: 0 }, now)).toEqual(['holding_nothing'])
  })
  it('flags someone in no group, and not also as holding nothing', () => {
    expect(studentFlags({ ...base, inAnyGroup: false, held: 0, done: 0, lowestShare: null }, now))
      .toEqual(['no_group'])
  })
  it('flags a low share only where there is a group to share with', () => {
    expect(studentFlags({ ...base, lowestShare: 8 }, now)).toEqual(['low_share'])
    expect(studentFlags({ ...base, lowestShare: null }, now)).toEqual([])
  })
  it('flags a week without activity once the term has started', () => {
    expect(studentFlags({ ...base, lastActiveAt: '2026-10-06T04:00:00Z' }, now)).toEqual(['inactive'])
    expect(studentFlags({ ...base, lastActiveAt: null }, now)).toEqual(['inactive'])
    expect(studentFlags({ ...base, lastActiveAt: null, termStarted: false }, now)).toEqual([])
  })
  it('flags chronic lateness, not a single late task', () => {
    expect(studentFlags({ ...base, done: 10, late: 3 }, now)).toEqual(['often_late'])
    expect(studentFlags({ ...base, done: 10, late: 2 }, now)).toEqual([])
    expect(studentFlags({ ...base, done: 20, late: 3 }, now)).toEqual([])
  })
})

describe('milestoneState', () => {
  const m = { tasks: 2, done: 2, due_on: '2026-10-10', last_done_at: '2026-10-10T10:00:00Z' }
  it('is met when everything was done by the date', () => {
    expect(milestoneState(m, '2026-10-13')).toBe('met')
  })
  it('is late when it was finished after the date', () => {
    expect(milestoneState({ ...m, last_done_at: '2026-10-10T17:00:00Z' }, '2026-10-13')).toBe('late')
  })
  it('is late when the date passed with work open, upcoming before it', () => {
    expect(milestoneState({ ...m, done: 1 }, '2026-10-11')).toBe('late')
    expect(milestoneState({ ...m, done: 1 }, '2026-10-10')).toBe('upcoming')
  })
  it('says so when no task is tagged to it', () => {
    expect(milestoneState({ ...m, tasks: 0, done: 0, last_done_at: null }, '2026-10-13')).toBe('no_tasks')
  })
})

describe('isStuck', () => {
  const now = new Date('2026-10-13T04:00:00Z')
  it('is a task in progress for a week or more', () => {
    expect(isStuck({ status: 'in_progress', started_at: '2026-10-06T04:00:00Z' }, now)).toBe(true)
    expect(isStuck({ status: 'in_progress', started_at: '2026-10-07T04:00:00Z' }, now)).toBe(false)
    expect(isStuck({ status: 'done', started_at: '2026-09-01T04:00:00Z' }, now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/analyticsMath.test.ts`
Expected: FAIL, "Failed to resolve import ./analyticsMath".

- [ ] **Step 3: Write `src/lib/analyticsMath.ts`**

```ts
import type { ActivityDay, ActivityKind, TaskState } from './types'

/**
 * The arithmetic under the analytics charts. Pure, so every threshold a
 * professor sees a colour for is pinned by a test.
 */

export const LOW_SHARE_PCT = 10
export const INACTIVE_DAYS = 7
export const OFTEN_LATE_MIN = 3
export const OFTEN_LATE_RATE = 0.3
export const STUCK_DAYS = 7

export type Tone = 'success' | 'warning' | 'danger' | 'pending'

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000
const MANILA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The day an instant falls on in the Philippines, as YYYY-MM-DD. */
export function manilaDay(t: string | Date): string {
  return MANILA.format(typeof t === 'string' ? new Date(t) : t)
}

const utc = (day: string) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))

export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS)
}

export function mondayOf(day: string): string {
  const dow = new Date(utc(day)).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

/** The Mondays of the last `n` weeks, oldest first, ending with this week's. */
export function lastWeeks(today: string, n: number): string[] {
  const end = mondayOf(today)
  return Array.from({ length: n }, (_, i) => addDays(end, (i - n + 1) * 7))
}

/* ------------------------------------------------------------------ share */

/**
 * How unevenly work is split: 0 is perfectly even, and it approaches 1 as one
 * person holds everything. One member, or nobody holding anything, is 0 —
 * there is no split to be uneven.
 */
export function gini(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0)
  const n = xs.length
  const sum = xs.reduce((s, v) => s + v, 0)
  if (n < 2 || sum === 0) return 0
  let diff = 0
  for (const a of xs) for (const b of xs) diff += Math.abs(a - b)
  return Math.round((diff / (2 * n * sum)) * 1000) / 1000
}

/* --------------------------------------------------------------- activity */

export const WORK_KINDS: readonly ActivityKind[] = ['claimed', 'started', 'finished']
export const TALK_KINDS: readonly ActivityKind[] = ['commented', 'file_added']

export type WeekRow = { week: string; work: number; talk: number }

/** Day rows folded into Monday weeks between two days, empty weeks included. */
export function weeklyActivity(rows: ActivityDay[], from: string, to: string): WeekRow[] {
  const out = new Map<string, WeekRow>()
  for (let w = mondayOf(from); w <= mondayOf(to); w = addDays(w, 7)) {
    out.set(w, { week: w, work: 0, talk: 0 })
  }
  for (const r of rows) {
    const row = out.get(mondayOf(r.day))
    if (!row) continue
    if (WORK_KINDS.includes(r.kind)) row.work += r.n
    else if (TALK_KINDS.includes(r.kind)) row.talk += r.n
  }
  return [...out.values()]
}

export function activeByWeek(rows: ActivityDay[], people: Set<string>, weeks: string[]): number[] {
  const seen = new Map(weeks.map((w) => [w, new Set<string>()]))
  for (const r of rows) {
    if (!r.actor_id || !people.has(r.actor_id)) continue
    seen.get(mondayOf(r.day))?.add(r.actor_id)
  }
  return weeks.map((w) => seen.get(w)?.size ?? 0)
}

/* ---------------------------------------------------------------- burnup */

export type TimedTask = Pick<TaskState, 'created_at' | 'done_at' | 'status'>
export type FinishedTask = Pick<TaskState, 'done_at' | 'status' | 'late'>

export type BurnupPoint = { day: string; scope: number; done: number }

/** The day a task counts as done, or null. A reopened task keeps done_at but is not done. */
const doneDay = (t: Pick<TaskState, 'done_at' | 'status'>) =>
  t.status === 'done' && t.done_at ? manilaDay(t.done_at) : null

/**
 * Tasks that exist, and tasks finished, at the end of each day from `from` to
 * `to`. Work from before `from` is carried into the first day.
 */
export function burnupSeries(tasks: TimedTask[], from: string, to: string): BurnupPoint[] {
  if (to < from) return []
  const created = new Map<string, number>()
  const finished = new Map<string, number>()
  let scope = 0
  let done = 0
  for (const t of tasks) {
    const c = manilaDay(t.created_at)
    if (c <= from) scope++
    else created.set(c, (created.get(c) ?? 0) + 1)
    const d = doneDay(t)
    if (d === null) continue
    if (d <= from) done++
    else finished.set(d, (finished.get(d) ?? 0) + 1)
  }
  const out: BurnupPoint[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (day !== from) {
      scope += created.get(day) ?? 0
      done += finished.get(day) ?? 0
    }
    out.push({ day, scope, done })
  }
  return out
}

/** Per cent done at the end of each week; null for a week with nothing in it yet. */
export function completionByWeek(tasks: TimedTask[], weeks: string[]): (number | null)[] {
  const rows = tasks.map((t) => ({ c: manilaDay(t.created_at), d: doneDay(t) }))
  return weeks.map((w) => {
    const end = addDays(w, 6)
    const scope = rows.filter((r) => r.c <= end).length
    const done = rows.filter((r) => r.d !== null && r.d <= end).length
    return scope === 0 ? null : Math.round((done / scope) * 100)
  })
}

/** Of the tasks finished in each week, the per cent finished on time; null if none were. */
export function onTimeByWeek(tasks: FinishedTask[], weeks: string[]): (number | null)[] {
  const rows = tasks
    .map((t) => ({ d: doneDay(t), late: t.late }))
    .filter((r): r is { d: string; late: boolean } => r.d !== null)
  return weeks.map((w) => {
    const end = addDays(w, 6)
    const inWeek = rows.filter((r) => r.d >= w && r.d <= end)
    if (inWeek.length === 0) return null
    return Math.round((inWeek.filter((r) => !r.late).length / inWeek.length) * 100)
  })
}

/* ---------------------------------------------------------------- health */

export type HealthMeasure = 'pace' | 'overdue' | 'gini' | 'idle' | 'returns'

/**
 * The colour of one cell in the group health grid. `pace` is points of
 * completion ahead of (positive) or behind (negative) the time elapsed.
 */
export function healthTone(measure: HealthMeasure, value: number | null): Tone {
  if (value === null) return 'pending'
  switch (measure) {
    case 'pace':
      return value >= 0 ? 'success' : value > -20 ? 'warning' : 'danger'
    case 'overdue':
      return value === 0 ? 'success' : value <= 2 ? 'warning' : 'danger'
    case 'gini':
      return value < 0.3 ? 'success' : value <= 0.5 ? 'warning' : 'danger'
    case 'idle':
      return value < 4 ? 'success' : value < INACTIVE_DAYS ? 'warning' : 'danger'
    case 'returns':
      return value === 0 ? 'success' : value === 1 ? 'warning' : 'danger'
  }
}

/* --------------------------------------------------------------- students */

export type StudentFlag = 'no_group' | 'holding_nothing' | 'low_share' | 'inactive' | 'often_late'

export type FlagInput = {
  held: number
  done: number
  late: number
  /** Their smallest share on a board of two or more; null when they have none. */
  lowestShare: number | null
  inAnyGroup: boolean
  lastActiveAt: string | null
  termStarted: boolean
}

export function idleDays(last: string | null, now: Date): number | null {
  return last ? daysBetween(manilaDay(last), manilaDay(now)) : null
}

/** Prompts for a conversation, never verdicts. Each one names a fact. */
export function studentFlags(s: FlagInput, now: Date): StudentFlag[] {
  const out: StudentFlag[] = []
  if (!s.inAnyGroup) out.push('no_group')
  else if (s.held === 0) out.push('holding_nothing')
  if (s.held > 0 && s.lowestShare !== null && s.lowestShare < LOW_SHARE_PCT) out.push('low_share')
  const idle = idleDays(s.lastActiveAt, now)
  if (s.termStarted && (idle === null || idle >= INACTIVE_DAYS)) out.push('inactive')
  if (s.late >= OFTEN_LATE_MIN && s.done > 0 && s.late / s.done >= OFTEN_LATE_RATE) {
    out.push('often_late')
  }
  return out
}

/* ------------------------------------------------------------- milestones */

export type MilestoneState = 'met' | 'late' | 'upcoming' | 'no_tasks'

export function milestoneState(
  m: { tasks: number; done: number; due_on: string; last_done_at: string | null },
  today: string,
): MilestoneState {
  if (m.tasks === 0) return 'no_tasks'
  if (m.done === m.tasks) {
    return m.last_done_at && manilaDay(m.last_done_at) <= m.due_on ? 'met' : 'late'
  }
  return today > m.due_on ? 'late' : 'upcoming'
}

export function isStuck(t: Pick<TaskState, 'status' | 'started_at'>, now: Date): boolean {
  return (
    t.status === 'in_progress' &&
    !!t.started_at &&
    daysBetween(manilaDay(t.started_at), manilaDay(now)) >= STUCK_DAYS
  )
}
```

The test file checks Gini against hand values. With `diff / (2 * n * sum)`: for [0,0,0,100], diff = 600 and 2·4·100 = 800, giving 0.75. For [0,100], diff = 200 and 2·2·100 = 400, giving 0.5.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/analyticsMath.test.ts`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analyticsMath.ts src/lib/analyticsMath.test.ts
git commit -m "Add the arithmetic behind the analytics charts and flags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sub-view routing and the Needs attention strip

**Files:**
- Create: `src/lib/analyticsView.ts`
- Test: `src/lib/analyticsView.test.ts`
- Modify: `src/components/analytics/ActionList.tsx` (optional `onSeeWhy`)
- Create: `src/components/analytics/NeedsAttention.tsx`

**Interfaces:**
- Consumes: `Action` and `ActionKind` from `src/lib/insight.ts`.
- Produces:
  - `ANALYTICS_VIEWS`, `type AnalyticsView = 'class' | 'groups' | 'students' | 'projects'`
  - `readAnalyticsView(v: string | null): AnalyticsView`
  - `viewForAction(kind: ActionKind): AnalyticsView`
  - `<ActionList actions onSeeWhy? />`
  - `<NeedsAttention actions={Action[]} onSeeWhy={(a: Action) => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/lib/analyticsView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readAnalyticsView, viewForAction } from './analyticsView'

describe('readAnalyticsView', () => {
  it('reads a known view', () => {
    expect(readAnalyticsView('students')).toBe('students')
  })
  it('falls back to the class view for anything else', () => {
    expect(readAnalyticsView(null)).toBe('class')
    expect(readAnalyticsView('reports')).toBe('class')
  })
})

describe('viewForAction', () => {
  it('sends board problems to Groups', () => {
    expect(viewForAction('carrying_alone')).toBe('groups')
    expect(viewForAction('stalled_board')).toBe('groups')
  })
  it('sends people problems to Students', () => {
    expect(viewForAction('not_in_a_group')).toBe('students')
    expect(viewForAction('holding_nothing')).toBe('students')
  })
  it('sends syllabus and calendar problems to Class', () => {
    expect(viewForAction('syllabus_gap')).toBe('class')
    expect(viewForAction('deadline_pile_up')).toBe('class')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/analyticsView.test.ts`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Write `src/lib/analyticsView.ts`**

```ts
import type { ActionKind } from './insight'

export const ANALYTICS_VIEWS = ['class', 'groups', 'students', 'projects'] as const
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number]

/** The `?view=` value if it names a view; the class view otherwise. */
export function readAnalyticsView(value: string | null): AnalyticsView {
  return (ANALYTICS_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as AnalyticsView)
    : 'class'
}

/** Where the evidence for each recommendation is drawn. A Record, so a new kind cannot be forgotten. */
const VIEW_FOR: Record<ActionKind, AnalyticsView> = {
  overdue_work: 'groups',
  returned_untouched: 'groups',
  stalled_board: 'groups',
  empty_board: 'groups',
  unclaimed_work: 'groups',
  carrying_alone: 'groups',
  will_miss_deadline: 'groups',
  not_in_a_group: 'students',
  holding_nothing: 'students',
  pending_reassignment: 'students',
  deadline_pile_up: 'class',
  syllabus_gap: 'class',
  class_unmeasured: 'class',
}

export function viewForAction(kind: ActionKind): AnalyticsView {
  return VIEW_FOR[kind]
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/lib/analyticsView.test.ts`
Expected: PASS.

- [ ] **Step 5: Add "See why" to `ActionList`**

In `src/components/analytics/ActionList.tsx`, change the signature to:

```tsx
export function ActionList({
  actions,
  onSeeWhy,
}: {
  actions: Action[]
  /** Opens the chart that is the evidence for this card. */
  onSeeWhy?: (a: Action) => void
}) {
```

In the button group, inside `<div className="flex shrink-0 items-center gap-2">`, add this before the `NudgeButton` line:

```tsx
                {onSeeWhy && (
                  <button
                    type="button"
                    onClick={() => onSeeWhy(a)}
                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
                  >
                    See why
                  </button>
                )}
```

- [ ] **Step 6: Write `src/components/analytics/NeedsAttention.tsx`**

```tsx
import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { ActionList } from './ActionList'
import type { Action } from '../../lib/insight'

/**
 * The first thing on the page, because "what do I do" is a professor's first
 * question. Collapsed, it is a count; open, it is the ranked list, and each
 * card points back to the chart that argues for it.
 */
export function NeedsAttention({
  actions,
  onSeeWhy,
}: {
  actions: Action[]
  onSeeWhy: (a: Action) => void
}) {
  const [open, setOpen] = useState(false)
  const urgent = actions.filter((a) => a.severity === 1).length

  return (
    <section className="surface rounded-panel border border-line px-4 py-3 shadow-card sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2.5">
          <Icon
            name={actions.length ? 'alert' : 'checkCircle'}
            size={16}
            className={actions.length ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}
          />
          <span className="font-display text-[16px] font-semibold text-ink">Needs attention</span>
          <span className="font-mono text-[13px] text-muted">{actions.length}</span>
          {urgent > 0 && (
            <span className="rounded-md bg-danger-500/15 px-1.5 py-0.5 font-mono text-[11px] text-danger-700 dark:text-danger-300">
              {urgent} urgent
            </span>
          )}
        </span>
        <Icon
          name="chevronDown"
          size={16}
          className={`shrink-0 text-faint transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-4">
          <ActionList actions={actions} onSeeWhy={onSeeWhy} />
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/analyticsView.ts src/lib/analyticsView.test.ts src/components/analytics/ActionList.tsx src/components/analytics/NeedsAttention.tsx
git commit -m "Add analytics sub-view routing and a Needs attention strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Move the shared charts

**Files:**
- Move: `src/components/general/reports/charts/{LineChart,StackedBar,DonutChart,ProgressBar}.tsx` → `src/components/charts/`
- Create: `src/components/charts/format.ts`
- Modify: `src/components/general/reports/ReportSections.tsx:19-24` (imports)
- Modify: `src/components/charts/LineChart.tsx` (import `shortDay`)

**Interfaces:**
- Produces: `src/components/charts/format.ts` exports `shortDay(day: string): string` and `TONE_CELL: Record<Tone, string>`. The four charts are now importable from `src/components/charts/*`.

- [ ] **Step 1: Move the files with git**

```bash
mkdir -p src/components/charts
git mv src/components/general/reports/charts/LineChart.tsx src/components/charts/LineChart.tsx
git mv src/components/general/reports/charts/StackedBar.tsx src/components/charts/StackedBar.tsx
git mv src/components/general/reports/charts/DonutChart.tsx src/components/charts/DonutChart.tsx
git mv src/components/general/reports/charts/ProgressBar.tsx src/components/charts/ProgressBar.tsx
```

- [ ] **Step 2: Create `src/components/charts/format.ts`**

```ts
import type { Tone } from '../../lib/analyticsMath'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD' as '7 Oct'. */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** A tinted cell or chip for each tone, readable in light and dark. */
export const TONE_CELL: Record<Tone, string> = {
  success: 'bg-success-500/15 text-success-700 dark:text-success-300',
  warning: 'bg-warning-400/20 text-warning-700 dark:text-warning-300',
  danger: 'bg-danger-500/15 text-danger-700 dark:text-danger-300',
  pending: 'bg-pending-soft text-pending-ink',
}
```

- [ ] **Step 3: Use it in `LineChart.tsx`**

Delete the local `function shortDay(...) { ... }` (lines 9-12) and add `import { shortDay } from './format'` below the `useId` import.

- [ ] **Step 4: Fix the imports in `ReportSections.tsx`**

Replace lines 19-24:

```tsx
import { DonutChart } from '../../charts/DonutChart'
import { LineChart } from '../../charts/LineChart'
import type { LinePoint } from '../../charts/LineChart'
import { ProgressBar } from '../../charts/ProgressBar'
import { StackedBar } from '../../charts/StackedBar'
```

Check that nothing else still points at the old folder:

Run: `git grep -n "reports/charts/" -- src`
Expected: no output.

- [ ] **Step 5: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all pass. General reports render as before.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/charts src/components/general/reports
git commit -m "Move the report charts somewhere analytics can share them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: New chart components

**Files:**
- Create: `src/components/charts/Sparkline.tsx`
- Create: `src/components/charts/Burnup.tsx`
- Create: `src/components/charts/WeekBars.tsx`
- Create: `src/components/charts/HeatGrid.tsx`
- Create: `src/components/charts/ShareBar.tsx`
- Create: `src/components/charts/CalendarHeat.tsx`
- Create: `src/components/charts/LaneTimeline.tsx`

**Interfaces:**
- Consumes: `shortDay` and `TONE_CELL` (Task 5), and `BurnupPoint`, `WeekRow`, `Tone`, `MilestoneState`, `addDays`, `daysBetween`, `mondayOf` (Task 3).
- Produces:
  - `<Sparkline values={(number|null)[]} label={string} />`
  - `<Burnup points={BurnupPoint[]} endDay?={string} title={string} compact?={boolean} />`
  - `<WeekBars rows={WeekRow[]} title={string} />`
  - `type HeatCell = { value: ReactNode; tone: Tone; title?: string }`, `type HeatRow = { key: string; label: ReactNode; cells: HeatCell[] }`, `<HeatGrid columns={string[]} rows={HeatRow[]} caption={string} />`
  - `type Share = { id: string; name: string; pct: number; low: boolean }`, `<ShareBar shares={Share[]} label={string} />`
  - `<CalendarHeat counts={Map<string, number>} from={string} to={string} title={string} />`
  - `type LaneMark = { key: string; day: string; label: string; state: MilestoneState }`, `type LaneBar = { from: string; to: string; tone: 'done' | 'open' | 'late' }`, `type Lane = { key: string; label: string; sub?: string; bar?: LaneBar; marks: LaneMark[] }`, `<LaneTimeline lanes={Lane[]} from={string} to={string} today={string} title={string} />`

These are presentational, and the repo has no component test harness. Each one is verified by `tsc` here and in the browser in Task 12.

- [ ] **Step 1: `Sparkline.tsx`**

```tsx
/**
 * A trend at the size of a word. A null value is a gap in the line, not a
 * zero: "nothing was finished that week" and "it was 0%" are different facts.
 */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const W = 96
  const H = 24
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) {
    return (
      <span className="font-mono text-[11px] text-faint" aria-label={label}>
        no data
      </span>
    )
  }
  const max = Math.max(...nums)
  const min = Math.min(...nums, 0)
  const span = max - min || 1
  const x = (i: number) => (values.length === 1 ? W / 2 : 2 + (i / (values.length - 1)) * (W - 4))
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6)
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
    pen = true
  })
  let lastIdx = values.length - 1
  while (values[lastIdx] === null) lastIdx--
  const last = values[lastIdx] as number

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24 shrink-0" role="img" aria-label={label}>
      <path
        d={d}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-navy-600 dark:stroke-navy-300"
      />
      <circle cx={x(lastIdx)} cy={y(last)} r="2.25" className="fill-navy-600 dark:fill-navy-300" />
    </svg>
  )
}
```

- [ ] **Step 2: `Burnup.tsx`**

```tsx
import { useId } from 'react'
import { daysBetween } from '../../lib/analyticsMath'
import type { BurnupPoint } from '../../lib/analyticsMath'
import { shortDay } from './format'

/**
 * Work that exists against work finished, day by day, with the even pace that
 * would finish today's scope by `endDay`. When scope grows, the grey line
 * rises and the gap says so: a percentage alone hides new work.
 */
export function Burnup({
  points,
  endDay,
  title,
  compact = false,
}: {
  points: BurnupPoint[]
  endDay?: string | null
  title: string
  compact?: boolean
}) {
  const uid = useId()
  if (points.length === 0) return null
  const W = compact ? 260 : 640
  const H = compact ? 120 : 220
  const PAD = compact
    ? { top: 8, right: 8, bottom: 18, left: 26 }
    : { top: 12, right: 14, bottom: 26, left: 36 }
  const first = points[0].day
  const lastPoint = points[points.length - 1]
  const last = endDay && endDay > lastPoint.day ? endDay : lastPoint.day
  const span = Math.max(1, daysBetween(first, last))
  const top = Math.max(1, ...points.map((p) => p.scope))
  const x = (day: string) => PAD.left + (daysBetween(first, day) / span) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom)
  const path = (key: 'scope' | 'done') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const area = `${path('done')} L${x(lastPoint.day).toFixed(1)},${y(0)} L${x(first).toFixed(1)},${y(0)} Z`
  const ticks = compact ? [0, top] : [0, Math.round(top / 2), top]
  const desc = `${lastPoint.done} of ${lastPoint.scope} tasks done on ${shortDay(lastPoint.day)}.`

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{desc}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-[var(--line)]" strokeWidth="1" />
            <text x={PAD.left - 5} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {!compact && (
          <>
            <text x={x(first)} y={H - 8} textAnchor="start" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {shortDay(first)}
            </text>
            <text x={x(last)} y={H - 8} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {shortDay(last)}
            </text>
          </>
        )}
        <line
          x1={x(first)}
          y1={y(0)}
          x2={x(last)}
          y2={y(lastPoint.scope)}
          strokeWidth="1.25"
          strokeDasharray="4 4"
          className="stroke-amber-400"
        />
        <path d={area} className="fill-navy-600/10 dark:fill-navy-300/10" />
        <path d={path('scope')} fill="none" strokeWidth="1.5" className="stroke-[var(--ink-faint)]" />
        <path d={path('done')} fill="none" strokeWidth="2.25" strokeLinejoin="round" className="stroke-navy-600 dark:stroke-navy-300" />
      </svg>
      {!compact && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-navy-600 dark:bg-navy-300" />Done</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--ink-faint)]" />All tasks</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-amber-400" />Even pace</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th>Day</th><th>All tasks</th><th>Done</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}><td>{p.day}</td><td>{p.scope}</td><td>{p.done}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
```

- [ ] **Step 3: `WeekBars.tsx`**

```tsx
import { useId } from 'react'
import type { WeekRow } from '../../lib/analyticsMath'
import { shortDay } from './format'

/** Work (claims, starts, finishes) and talk (comments, files) per week, stacked. */
export function WeekBars({ rows, title }: { rows: WeekRow[]; title: string }) {
  const uid = useId()
  if (rows.length === 0) return null
  const W = 640
  const H = 200
  const PAD = { top: 10, right: 8, bottom: 26, left: 32 }
  const peak = Math.max(1, ...rows.map((r) => r.work + r.talk))
  const slot = (W - PAD.left - PAD.right) / rows.length
  const bw = Math.max(4, Math.min(28, slot * 0.6))
  const h = (v: number) => (v / peak) * (H - PAD.top - PAD.bottom)
  const base = H - PAD.bottom
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8))
  const total = rows.reduce((s, r) => s + r.work + r.talk, 0)

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{`${total} actions over ${rows.length} weeks.`}</desc>
        {[0, peak].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={base - h(t)} y2={base - h(t)} className="stroke-[var(--line)]" strokeWidth="1" />
            <text x={PAD.left - 5} y={base - h(t) + 3.5} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={r.week}>
              <rect x={cx - bw / 2} y={base - h(r.work)} width={bw} height={h(r.work)} rx="2" className="fill-navy-600 dark:fill-navy-300" />
              <rect x={cx - bw / 2} y={base - h(r.work) - h(r.talk)} width={bw} height={h(r.talk)} rx="2" className="fill-amber-400" />
              {(i % labelEvery === 0 || i === rows.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--ink-faint)] font-mono text-[10px]">
                  {shortDay(r.week)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-navy-600 dark:bg-navy-300" />Work</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Comments and files</span>
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Week of</th><th>Work</th><th>Comments and files</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}><td>{r.week}</td><td>{r.work}</td><td>{r.talk}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
```

- [ ] **Step 4: `HeatGrid.tsx`**

```tsx
import type { ReactNode } from 'react'
import type { Tone } from '../../lib/analyticsMath'
import { TONE_CELL } from './format'

export type HeatCell = { value: ReactNode; tone: Tone; title?: string }
export type HeatRow = { key: string; label: ReactNode; cells: HeatCell[] }

/** A real table whose cells carry their tone. Readable without colour: every cell prints its value. */
export function HeatGrid({
  columns,
  rows,
  caption,
}: {
  columns: string[]
  rows: HeatRow[]
  caption: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-[12px] font-medium text-faint">Group</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1 text-left text-[12px] font-medium text-faint">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="max-w-[220px] px-2 py-1.5 text-left font-normal text-ink">{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={columns[i]} title={c.title} className={`rounded-md px-2 py-1.5 font-mono text-[12px] ${TONE_CELL[c.tone]}`}>
                  {c.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: `ShareBar.tsx`**

```tsx
const SEGMENTS = [
  'bg-navy-800 dark:bg-navy-200',
  'bg-navy-600 dark:bg-navy-300',
  'bg-navy-400 dark:bg-navy-500',
  'bg-navy-300 dark:bg-navy-600',
  'bg-navy-200 dark:bg-navy-700',
]

export type Share = { id: string; name: string; pct: number; low: boolean }

/**
 * One group's 100 per cent, split by who holds it. A member under the low-share
 * line is outlined and named in danger, so the bar is never the only signal.
 */
export function ShareBar({ shares, label }: { shares: Share[]; label: string }) {
  const sorted = [...shares].sort((a, b) => b.pct - a.pct)
  const summary = sorted.map((s) => `${s.name} ${Math.round(s.pct)}%`).join(', ')
  return (
    <div className="space-y-2">
      <div role="img" aria-label={`${label}: ${summary || 'no work held yet'}`} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full surface-sunken">
        {sorted.map((s, i) =>
          s.pct > 0 ? (
            <span
              key={s.id}
              className={`h-full ${SEGMENTS[i % SEGMENTS.length]} ${s.low ? 'ring-2 ring-inset ring-danger-500' : ''}`}
              style={{ width: `${s.pct}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${SEGMENTS[i % SEGMENTS.length]}`} />
            <span className={s.low ? 'text-danger-700 dark:text-danger-300' : 'text-muted'}>
              {s.name} <span className="font-mono">{Math.round(s.pct)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 6: `CalendarHeat.tsx`**

```tsx
import { addDays, mondayOf } from '../../lib/analyticsMath'
import { shortDay } from './format'

const LEVELS = [
  'surface-sunken',
  'bg-navy-600/20 dark:bg-navy-300/20',
  'bg-navy-600/40 dark:bg-navy-300/40',
  'bg-navy-600/70 dark:bg-navy-300/70',
  'bg-navy-600 dark:bg-navy-300',
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Weeks across, weekdays down. Cramming shows as a dark column before a deadline. */
export function CalendarHeat({
  counts,
  from,
  to,
  title,
}: {
  counts: Map<string, number>
  from: string
  to: string
  title: string
}) {
  const weeks: string[] = []
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) weeks.push(w)
  const peak = Math.max(0, ...counts.values())
  const level = (n: number) => (n === 0 || peak === 0 ? 0 : Math.min(4, Math.ceil((n / peak) * 4)))
  let busiest: [string, number] | null = null
  for (const [d, n] of counts) if (!busiest || n > busiest[1]) busiest = [d, n]
  const label = busiest
    ? `${title}. Busiest day ${shortDay(busiest[0])} with ${busiest[1]} actions.`
    : `${title}. No activity yet.`

  return (
    <figure className="overflow-x-auto">
      <div role="img" aria-label={label} className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(7, 12px)' }}>
        {WEEKDAYS.map((d) => (
          <span key={d} className="pr-1.5 font-mono text-[9px] leading-[12px] text-faint">{d}</span>
        ))}
        {weeks.flatMap((w) =>
          WEEKDAYS.map((_, i) => {
            const day = addDays(w, i)
            const n = day < from || day > to ? 0 : (counts.get(day) ?? 0)
            return <span key={day} title={`${shortDay(day)}: ${n}`} className={`h-3 w-3 rounded-[3px] ${LEVELS[level(n)]}`} />
          }),
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Day</th><th>Actions</th></tr></thead>
        <tbody>
          {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => (
            <tr key={d}><td>{d}</td><td>{n}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
```

- [ ] **Step 7: `LaneTimeline.tsx`**

```tsx
import { daysBetween } from '../../lib/analyticsMath'
import type { MilestoneState } from '../../lib/analyticsMath'
import { shortDay } from './format'

export type LaneMark = { key: string; day: string; label: string; state: MilestoneState }
export type LaneBar = { from: string; to: string; tone: 'done' | 'open' | 'late' }
export type Lane = { key: string; label: string; sub?: string; bar?: LaneBar; marks: LaneMark[] }

const MARK: Record<MilestoneState, string> = {
  met: 'bg-success-500 border-success-600',
  late: 'bg-danger-500 border-danger-600',
  upcoming: 'surface border-navy-500 dark:border-navy-300',
  no_tasks: 'bg-pending-soft border-line-strong',
}
const MARK_WORD: Record<MilestoneState, string> = {
  met: 'met',
  late: 'late',
  upcoming: 'upcoming',
  no_tasks: 'no tasks tagged',
}
const BAR: Record<LaneBar['tone'], string> = {
  done: 'bg-success-500/60',
  open: 'bg-navy-400/50 dark:bg-navy-300/40',
  late: 'bg-danger-500/60',
}

/** One row per group or task across a shared date axis, with today marked. */
export function LaneTimeline({
  lanes,
  from,
  to,
  today,
  title,
}: {
  lanes: Lane[]
  from: string
  to: string
  today: string
  title: string
}) {
  const span = Math.max(1, daysBetween(from, to))
  const pct = (day: string) => `${Math.min(100, Math.max(0, (daysBetween(from, day) / span) * 100))}%`
  const showToday = today >= from && today <= to

  return (
    <figure className="space-y-1.5">
      <div className="flex justify-between pl-[34%] font-mono text-[10px] text-faint sm:pl-[180px]">
        <span>{shortDay(from)}</span>
        <span>{shortDay(to)}</span>
      </div>
      <ul className="space-y-1.5" aria-hidden>
        {lanes.map((l) => (
          <li key={l.key} className="flex items-center gap-3">
            <span className="w-[34%] shrink-0 truncate text-[13px] text-ink sm:w-[168px]">
              {l.label}
              {l.sub && <span className="block truncate text-[11px] text-faint">{l.sub}</span>}
            </span>
            <span className="relative h-6 flex-1 rounded-md surface-sunken">
              {showToday && <span className="absolute inset-y-0 w-px bg-amber-400" style={{ left: pct(today) }} />}
              {l.bar && (
                <span
                  className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${BAR[l.bar.tone]}`}
                  style={{ left: pct(l.bar.from), width: `max(4px, calc(${pct(l.bar.to)} - ${pct(l.bar.from)}))` }}
                />
              )}
              {l.marks.map((m) => (
                <span
                  key={m.key}
                  title={`${m.label}, ${shortDay(m.day)}: ${MARK_WORD[m.state]}`}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${MARK[m.state]}`}
                  style={{ left: pct(m.day) }}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12px] text-muted">
        {(['met', 'late', 'upcoming'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rotate-45 border ${MARK[s]}`} />
            {MARK_WORD[s][0].toUpperCase() + MARK_WORD[s].slice(1)}
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-amber-400" />Today</span>
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Row</th><th>Item</th><th>Date</th><th>State</th></tr></thead>
        <tbody>
          {lanes.flatMap((l) =>
            l.marks.map((m) => (
              <tr key={`${l.key}-${m.key}`}>
                <td>{l.label}</td><td>{m.label}</td><td>{m.day}</td><td>{MARK_WORD[m.state]}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  )
}
```

- [ ] **Step 8: Build and lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/charts
git commit -m "Add sparkline, burnup, weekly bars, heat grid, share bar, calendar and lane charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Class view

**Files:**
- Create: `src/pages/app/analytics/views/ClassView.tsx`
- Create: `src/pages/app/analytics/views/Section.tsx`

**Interfaces:**
- Consumes:
  - `AnalyticsData` (Task 2)
  - `burnupSeries`, `completionByWeek`, `onTimeByWeek`, `activeByWeek`, `weeklyActivity`, `lastWeeks`, `manilaDay` (Task 3)
  - `Burnup`, `WeekBars`, `Sparkline` (Task 6)
  - the existing `PressureChart`, `PaceCard`, `GapList`, `UnmeasuredList`
- Produces:
  - `<ClassView data={AnalyticsData} />`
  - `<Section title subtitle? children />`, the card shell used by every view
  - `classWindow(data: AnalyticsData, today: string): { from: string; to: string; end: string }`, exported from `ClassView.tsx` for the other views

- [ ] **Step 1: `Section.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Reveal } from '../../../../components/motion/Reveal'

/** One titled card on an analytics view. */
export function Section({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Reveal as="section" className={`card min-w-0 space-y-4 p-4 shadow-card sm:p-5 ${className}`}>
      <header>
        <h3 className="text-ink">{title}</h3>
        {subtitle && <p className="mt-1 max-w-[66ch] text-[13px] text-muted">{subtitle}</p>}
      </header>
      {children}
    </Reveal>
  )
}
```

- [ ] **Step 2: `ClassView.tsx`**

```tsx
import { GapList } from '../../../../components/analytics/GapList'
import { PaceCard } from '../../../../components/analytics/PaceCard'
import { PressureChart } from '../../../../components/analytics/PressureChart'
import { UnmeasuredList } from '../../../../components/analytics/UnmeasuredList'
import { Burnup } from '../../../../components/charts/Burnup'
import { Sparkline } from '../../../../components/charts/Sparkline'
import { WeekBars } from '../../../../components/charts/WeekBars'
import { EmptyState } from '../../../../components/ui/EmptyState'
import {
  activeByWeek,
  burnupSeries,
  completionByWeek,
  lastWeeks,
  manilaDay,
  onTimeByWeek,
  weeklyActivity,
} from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { Section } from './Section'

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100))

/**
 * The window every time chart on the page shares: from the earliest term start
 * (or the first task, for a class with no dates) to today, with the term end as
 * the far edge of the axis.
 */
export function classWindow(data: AnalyticsData, today: string) {
  const starts = data.shownPace.map((p) => p.term_start).filter(Boolean)
  const ends = data.shownPace.map((p) => p.term_end).filter(Boolean)
  const firstTask = data.shownTasks.reduce<string | null>((min, t) => {
    const d = manilaDay(t.created_at)
    return min === null || d < min ? d : min
  }, null)
  const from = starts.length ? starts.sort()[0] : (firstTask ?? today)
  const end = ends.length ? ends.sort()[ends.length - 1] : today
  const to = today < end ? today : end
  return { from, to: to < from ? from : to, end }
}

function Kpi({
  label,
  value,
  trend,
  trendLabel,
}: {
  label: string
  value: string
  trend?: (number | null)[]
  trendLabel?: string
}) {
  return (
    <div className="card flex items-end justify-between gap-3 px-4 py-3 shadow-card">
      <div className="min-w-0">
        <p className="font-mono text-[22px] leading-none text-ink">{value}</p>
        <p className="mt-1.5 text-[12px] text-muted">{label}</p>
      </div>
      {trend && trendLabel && <Sparkline values={trend} label={trendLabel} />}
    </div>
  )
}

export function ClassView({ data }: { data: AnalyticsData }) {
  const today = manilaDay(new Date())
  const { from, to, end } = classWindow(data, today)
  const tasks = data.shownTasks
  const weeks = lastWeeks(today, 8)
  const students = new Set(data.shownRoster.map((r) => r.student_id))

  const completion = completionByWeek(tasks, weeks)
  const onTime = onTimeByWeek(tasks, weeks)
  const active = activeByWeek(data.shownActivity, students, weeks)

  const done = tasks.filter((t) => t.status === 'done')
  const onTimeNow = pct(done.filter((t) => !t.late).length, done.length)
  const completionNow = pct(done.length, tasks.length)

  const burn = burnupSeries(tasks, from, to)
  const weekly = weeklyActivity(data.shownActivity, from, to)
  const hasActivity = weekly.some((w) => w.work + w.talk > 0)
  const span = (xs: (number | null)[]) => {
    const n = xs.filter((x): x is number => x !== null)
    return n.length ? `from ${n[0]} to ${n[n.length - 1]}` : 'no data yet'
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Tasks done"
          value={completionNow === null ? '—' : `${completionNow}%`}
          trend={completion}
          trendLabel={`Per cent done over the last 8 weeks, ${span(completion)}`}
        />
        <Kpi
          label="Finished on time"
          value={onTimeNow === null ? '—' : `${onTimeNow}%`}
          trend={onTime}
          trendLabel={`Per cent finished on time each week, ${span(onTime)}`}
        />
        <Kpi
          label="Students active this week"
          value={`${active[active.length - 1]} of ${students.size}`}
          trend={active}
          trendLabel={`Active students per week, ${span(active)}`}
        />
        <Kpi label="Need attention" value={String(data.actions.length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Work against time"
          subtitle="All tasks and finished tasks each day. The dashed line is the even pace that finishes today's tasks by the end of term."
        >
          {burn.length > 1 ? (
            <Burnup points={burn} endDay={end} title="Tasks and finished tasks over the term" />
          ) : (
            <EmptyState icon="chart" title="No history yet" body="This fills in day by day once the term starts and tasks are added." />
          )}
        </Section>

        <Section
          title="Weekly activity"
          subtitle="Claims, starts and finishes, with comments and files on top. A quiet week shows here before it shows in the grades."
        >
          {hasActivity ? (
            <WeekBars rows={weekly} title="Activity per week" />
          ) : (
            <EmptyState icon="chart" title="No activity recorded yet" body="Charts fill in as students claim and finish tasks." />
          )}
        </Section>
      </div>

      {!data.narrowedBelowClass && data.shownPace.length > 0 && (
        <Section title="Syllabus pace" subtitle="Weeks with a project set against them, beside the weeks that have gone by.">
          <div className="space-y-5">
            {data.shownPace.map((p) => (
              <div key={p.class_id} className="space-y-3">
                <div className="space-y-1.5">
                  {[
                    { label: 'Covered', value: p.weeks_covered, cls: 'bg-navy-600 dark:bg-navy-300' },
                    { label: 'Elapsed', value: p.weeks_elapsed, cls: 'bg-amber-400' },
                  ].map((b) => (
                    <div key={b.label} className="flex items-center gap-3 text-[12px]">
                      <span className="w-16 shrink-0 text-muted">{b.label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full surface-sunken">
                        <span
                          className={`block h-full rounded-full ${b.cls}`}
                          style={{ width: `${Math.min(100, (b.value / Math.max(1, p.weeks_in_term)) * 100)}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-faint">
                        {b.value} of {p.weeks_in_term}
                      </span>
                    </div>
                  ))}
                </div>
                <PaceCard pace={p} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {!data.narrowedBelowClass && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="What falls due next" subtitle="Open work by the week it is due, for the next four weeks.">
            <PressureChart rows={data.shownPressure} />
          </Section>
          <Section title="Weeks with nothing set" subtitle="Syllabus weeks that ask for an assessment but have no project against them.">
            <GapList gaps={data.shownGaps} />
          </Section>
        </div>
      )}

      {!data.narrowedBelowClass && <UnmeasuredList rows={data.shownUnmeasured} />}
    </div>
  )
}
```

- [ ] **Step 3: Build and lint**

Run: `npm run build && npm run lint`
Expected: both pass. The view is not mounted until Task 11.

- [ ] **Step 4: Commit**

```bash
git add src/pages/app/analytics/views/Section.tsx src/pages/app/analytics/views/ClassView.tsx
git commit -m "Add the Class view: trends, burnup, weekly activity and pace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Groups view

**Files:**
- Create: `src/components/analytics/GroupHealthGrid.tsx`
- Create: `src/pages/app/analytics/views/GroupsView.tsx`

**Interfaces:**
- Consumes:
  - `AnalyticsData`
  - `healthTone`, `gini`, `LOW_SHARE_PCT`, `burnupSeries`, `daysBetween`, `manilaDay` (Task 3)
  - `HeatGrid`, `ShareBar`, `Burnup`, `CalendarHeat` (Task 6)
  - `Section`, `classWindow` (Task 7)
  - the existing `DiagnosisList`, `ForecastSummary`, `BurnCard`
- Produces: `<GroupHealthGrid data={AnalyticsData} today={string} />` and `<GroupsView data={AnalyticsData} />`.

- [ ] **Step 1: `GroupHealthGrid.tsx`**

```tsx
import { HeatGrid } from '../charts/HeatGrid'
import type { HeatRow } from '../charts/HeatGrid'
import { daysBetween, gini, healthTone } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

const COLUMNS = ['Done vs time', 'Overdue', 'Uneven split', 'Last activity', 'Hand-in', 'Returned']

/** One row per group board. Every cell prints its figure; the colour only ranks it. */
export function GroupHealthGrid({ data, today }: { data: AnalyticsData; today: string }) {
  const now = Date.now()
  const lastDay = new Map<string, string>()
  for (const a of data.shownActivity) {
    const prev = lastDay.get(a.board_id)
    if (!prev || a.day > prev) lastDay.set(a.board_id, a.day)
  }
  const cycles = new Map(data.shownCycles.map((c) => [c.board_id, c]))

  const rows: HeatRow[] = data.shownBurns
    .filter((b) => b.group_id)
    .map((b) => {
      const elapsed =
        b.days_active === null || b.days_left === null
          ? null
          : b.days_left < 0
            ? 100
            : (b.days_active / (b.days_active + b.days_left)) * 100
      const pace = elapsed === null ? null : Math.round(Number(b.done_pct) - elapsed)
      const overdue = data.shownTasks.filter(
        (t) => t.board_id === b.board_id && t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() < now,
      ).length
      const g = gini(data.shownMembers.filter((m) => m.board_id === b.board_id).map((m) => Number(m.held_pct)))
      const last = lastDay.get(b.board_id)
      const idle = last ? daysBetween(last, today) : null
      const returns = cycles.get(b.board_id)?.returns ?? 0
      const handIn = b.result_verdict === 'accepted'
        ? { value: 'Accepted', tone: 'success' as const }
        : b.submitted_at
          ? { value: 'Handed in', tone: 'success' as const }
          : b.result_verdict === 'returned'
            ? { value: 'Returned', tone: 'warning' as const }
            : { value: 'Open', tone: 'pending' as const }

      return {
        key: b.board_id,
        label: (
          <>
            <span className="block truncate">{b.group_name}</span>
            <span className="block truncate text-[11px] text-faint">{b.project_title}</span>
          </>
        ),
        cells: [
          {
            value: pace === null ? 'Not started' : `${Math.round(Number(b.done_pct))}% · ${pace >= 0 ? '+' : ''}${pace}`,
            tone: healthTone('pace', pace),
            title: 'Per cent done, and points ahead of or behind the time used',
          },
          { value: overdue, tone: healthTone('overdue', overdue) },
          { value: g.toFixed(2), tone: healthTone('gini', g), title: '0 is an even split, 1 is one person holding everything' },
          { value: idle === null ? 'None yet' : idle === 0 ? 'Today' : `${idle}d ago`, tone: healthTone('idle', idle) },
          handIn,
          { value: returns, tone: healthTone('returns', returns) },
        ],
      }
    })

  if (rows.length === 0) {
    return <p className="text-[13px] text-muted">No group boards in view. Individual projects appear under Students.</p>
  }
  return <HeatGrid columns={COLUMNS} rows={rows} caption="Group health" />
}
```

- [ ] **Step 2: `GroupsView.tsx`**

```tsx
import { useState } from 'react'
import { BurnCard } from '../../../../components/analytics/BurnCard'
import { DiagnosisList } from '../../../../components/analytics/DiagnosisList'
import { ForecastSummary } from '../../../../components/analytics/ForecastSummary'
import { GroupHealthGrid } from '../../../../components/analytics/GroupHealthGrid'
import { Burnup } from '../../../../components/charts/Burnup'
import { CalendarHeat } from '../../../../components/charts/CalendarHeat'
import { ShareBar } from '../../../../components/charts/ShareBar'
import { LOW_SHARE_PCT, burnupSeries, manilaDay } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { classWindow } from './ClassView'
import { Section } from './Section'

const SHOWN = 6

export function GroupsView({ data }: { data: AnalyticsData }) {
  const today = manilaDay(new Date())
  const [allBurns, setAllBurns] = useState(false)
  const groupBoards = data.shownBurns.filter((b) => b.group_id)
  const atRisk = data.shownBurns.filter((b) => !b.submitted_at && b.task_count > 0 && b.done_count < b.task_count)

  const board = data.scope.boardId ? groupBoards.find((b) => b.board_id === data.scope.boardId) : null
  const { from } = classWindow(data, today)
  const counts = new Map<string, number>()
  if (board) {
    for (const a of data.shownActivity) {
      if (a.board_id === board.board_id) counts.set(a.day, (counts.get(a.day) ?? 0) + a.n)
    }
  }

  const projectBoards = data.scope.projectId
    ? groupBoards.filter((b) => b.project_id === data.scope.projectId)
    : []
  const projectTasks = data.shownTasks.filter((t) => t.project_id === data.scope.projectId)
  const projectFrom = projectTasks.reduce<string>((min, t) => {
    const d = manilaDay(t.created_at)
    return d < min ? d : min
  }, today)

  return (
    <div className="space-y-5">
      <Section
        title="Group health"
        subtitle="Each group on the measures that predict trouble. Hover a heading's cells for what the number means."
      >
        <GroupHealthGrid data={data} today={today} />
      </Section>

      <Section
        title="Who holds the work"
        subtitle={`Each group's work split by who holds it. Anyone under ${LOW_SHARE_PCT}% is outlined. A count is a prompt for a conversation, not a verdict.`}
      >
        {groupBoards.length === 0 ? (
          <p className="text-[13px] text-muted">No group boards in view.</p>
        ) : (
          <ul className="grid gap-5 lg:grid-cols-2">
            {groupBoards.map((b) => {
              const members = data.shownMembers.filter((m) => m.board_id === b.board_id)
              return (
                <li key={b.board_id} className="min-w-0 space-y-2">
                  <p className="truncate text-[13px] text-ink">
                    {b.group_name} <span className="text-faint">· {b.project_title}</span>
                  </p>
                  <ShareBar
                    label={`${b.group_name ?? 'Group'} work split`}
                    shares={members.map((m) => ({
                      id: m.student_id,
                      name: m.student_name,
                      pct: Number(m.held_pct),
                      low: m.group_size >= 2 && Number(m.held_pct) < LOW_SHARE_PCT,
                    }))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Groups side by side" subtitle="Burnup per group on one scale. Choose a project in the scope bar to compare its groups.">
          {projectBoards.length === 0 ? (
            <p className="text-[13px] text-muted">Choose a project to compare its groups.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {projectBoards.map((b) => {
                const pts = burnupSeries(projectTasks.filter((t) => t.board_id === b.board_id), projectFrom, today)
                return (
                  <li key={b.board_id} className="min-w-0">
                    <p className="mb-1 truncate text-[12px] text-muted">{b.group_name}</p>
                    {pts.length > 1 ? (
                      <Burnup compact points={pts} endDay={b.project_due_at ? manilaDay(b.project_due_at) : null} title={`${b.group_name} burnup`} />
                    ) : (
                      <p className="text-[12px] text-faint">No history yet.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="When the group works" subtitle="Each square is a day. A dark column just before a deadline is cramming.">
          {board ? (
            <CalendarHeat counts={counts} from={from} to={today} title={`${board.group_name} activity by day`} />
          ) : (
            <p className="text-[13px] text-muted">Choose a group in the scope bar to see when it works.</p>
          )}
        </Section>
      </div>

      <Section title="Will each group finish on time" subtitle="Tasks finished per day since each board started, against the days left. Every figure is a division you can redo by hand.">
        <ForecastSummary burns={data.shownBurns} />
        {atRisk.length > 0 && (
          <>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(allBurns ? atRisk : atRisk.slice(0, SHOWN)).map((b) => (
                <BurnCard key={b.board_id} burn={b} />
              ))}
            </ul>
            {atRisk.length > SHOWN && (
              <button
                type="button"
                onClick={() => setAllBurns((v) => !v)}
                className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                {allBurns ? 'Show fewer' : `Show the other ${atRisk.length - SHOWN}`}
              </button>
            )}
          </>
        )}
      </Section>

      <Section title="Why groups are behind" subtitle="Each cause is measured, and the number that shows it sits in the line.">
        <DiagnosisList rows={data.shownDiagnoses} />
      </Section>
    </div>
  )
}
```

- [ ] **Step 3: Build and lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/GroupHealthGrid.tsx src/pages/app/analytics/views/GroupsView.tsx
git commit -m "Add the Groups view: health grid, work split, burnups and activity calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Students view, roster and drawer

**Files:**
- Create: `src/components/analytics/Roster.tsx`
- Create: `src/components/analytics/StudentDrawer.tsx`
- Create: `src/pages/app/analytics/views/StudentsView.tsx`

**Interfaces:**
- Consumes:
  - `AnalyticsData`
  - `studentFlags`, `StudentFlag`, `idleDays`, `weeklyActivity`, `lastWeeks`, `addDays`, `manilaDay`, `LOW_SHARE_PCT` (Task 3)
  - `Sparkline`, `WeekBars`, `LaneTimeline`, `TONE_CELL` (Tasks 5-6)
  - `classWindow`, `Section` (Task 7)
  - the existing `Modal`, `NudgeButton`
- Produces:
  - `type RosterEntry = RosterRow & { flags: StudentFlag[]; lowestShare: number | null; trend: number[]; idle: number | null }`
  - `<Roster entries={RosterEntry[]} onOpen={(id: string) => void} />`
  - `<StudentDrawer entry={RosterEntry | null} data={AnalyticsData} onClose={() => void} onOpenTask={(id: string) => void} />`
  - `<StudentsView data={AnalyticsData} onOpenTask={(id: string) => void} />`

- [ ] **Step 1: `Roster.tsx`**

```tsx
import { useState } from 'react'
import { Sparkline } from '../charts/Sparkline'
import { TONE_CELL } from '../charts/format'
import type { StudentFlag, Tone } from '../../lib/analyticsMath'
import type { RosterRow } from '../../lib/types'

export type RosterEntry = RosterRow & {
  flags: StudentFlag[]
  lowestShare: number | null
  trend: number[]
  idle: number | null
}

export const FLAG_META: Record<StudentFlag, { word: (e: RosterEntry) => string; tone: Tone }> = {
  no_group: { word: () => 'In no group', tone: 'danger' },
  holding_nothing: { word: () => 'Holding nothing', tone: 'danger' },
  low_share: { word: () => 'Low share', tone: 'warning' },
  inactive: { word: (e) => (e.idle === null ? 'Never active' : `Inactive ${e.idle} days`), tone: 'warning' },
  often_late: { word: () => 'Often late', tone: 'warning' },
}

type Key = 'name' | 'share' | 'done' | 'late' | 'hours' | 'comments' | 'idle' | 'flags'

const value = (e: RosterEntry, k: Key): number | string => {
  switch (k) {
    case 'name': return e.student_name
    case 'share': return e.lowestShare ?? 101
    case 'done': return e.held ? e.done / e.held : -1
    case 'late': return e.done ? e.late / e.done : -1
    case 'hours': return e.worklog_minutes
    case 'comments': return e.comments
    case 'idle': return e.idle ?? 9999
    case 'flags': return e.flags.length
  }
}

const HEADS: { key: Key; label: string }[] = [
  { key: 'name', label: 'Student' },
  { key: 'share', label: 'Share of group work' },
  { key: 'done', label: 'Finished' },
  { key: 'late', label: 'Late' },
  { key: 'hours', label: 'Logged' },
  { key: 'comments', label: 'Comments' },
  { key: 'idle', label: 'Last active' },
  { key: 'flags', label: 'Flags' },
]

/** Every student, sortable on every column. Flags first by default, so the people to talk to lead. */
export function Roster({ entries, onOpen }: { entries: RosterEntry[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: 'flags', desc: true })
  const rows = [...entries].sort((a, b) => {
    const va = value(a, sort.key)
    const vb = value(b, sort.key)
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return (sort.desc ? -c : c) || a.student_name.localeCompare(b.student_name)
  })

  if (entries.length === 0) {
    return <p className="text-[13px] text-muted">No active students in view.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <caption className="sr-only">Students and the evidence of their work</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {HEADS.map((h) => (
              <th key={h.key} scope="col" aria-sort={sort.key === h.key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="px-2 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: h.key, desc: s.key === h.key ? !s.desc : h.key !== 'name' }))}
                  className="text-[12px] text-faint hover:text-ink"
                >
                  {h.label}
                  {sort.key === h.key && <span aria-hidden> {sort.desc ? '↓' : '↑'}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-[12px] font-medium text-faint">8 weeks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.student_id} className="border-b border-line last:border-0 hover:bg-[var(--surface-sunken)]">
              <th scope="row" className="px-2 py-2 text-left font-normal">
                <button type="button" onClick={() => onOpen(e.student_id)} className="text-ink hover:underline">
                  {e.student_name}
                </button>
              </th>
              <td className="px-2 py-2 font-mono text-muted">{e.lowestShare === null ? '—' : `${Math.round(e.lowestShare)}%`}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.done} / {e.held}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.done ? `${Math.round((e.late / e.done) * 100)}%` : '—'}</td>
              <td className="px-2 py-2 font-mono text-muted">{(e.worklog_minutes / 60).toFixed(1)}h</td>
              <td className="px-2 py-2 font-mono text-muted">{e.comments}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.idle === null ? 'Never' : e.idle === 0 ? 'Today' : `${e.idle}d ago`}</td>
              <td className="px-2 py-2">
                <span className="flex flex-wrap gap-1">
                  {e.flags.map((f) => (
                    <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[FLAG_META[f].tone]}`}>
                      {FLAG_META[f].word(e)}
                    </span>
                  ))}
                </span>
              </td>
              <td className="px-2 py-2">
                <Sparkline values={e.trend} label={`${e.student_name}: actions per week for 8 weeks, latest ${e.trend[e.trend.length - 1]}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: `StudentDrawer.tsx`**

```tsx
import { NudgeButton } from '../projects/NudgeButton'
import { LaneTimeline } from '../charts/LaneTimeline'
import type { Lane } from '../charts/LaneTimeline'
import { TONE_CELL } from '../charts/format'
import { WeekBars } from '../charts/WeekBars'
import { Modal } from '../ui/Modal'
import { addDays, manilaDay, weeklyActivity } from '../../lib/analyticsMath'
import { classWindow } from '../../pages/app/analytics/views/ClassView'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'
import { FLAG_META } from './Roster'
import type { RosterEntry } from './Roster'

const SHOWN_TASKS = 12

/** One student, all the evidence, one click from a reminder. */
export function StudentDrawer({
  entry,
  data,
  onClose,
  onOpenTask,
}: {
  entry: RosterEntry | null
  data: AnalyticsData
  onClose: () => void
  onOpenTask: (id: string) => void
}) {
  if (!entry) return null
  const today = manilaDay(new Date())
  const { from } = classWindow(data, today)
  const mine = data.shownActivity.filter((a) => a.actor_id === entry.student_id)
  const weekly = weeklyActivity(mine, from, today)
  const tasks = data.shownTasks
    .filter((t) => t.assignee_ids.includes(entry.student_id))
    .sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))
    .slice(0, SHOWN_TASKS)
  const mainBoard = data.shownMembers
    .filter((m) => m.student_id === entry.student_id)
    .sort((a, b) => b.task_count - a.task_count)[0]

  const lanes: Lane[] = tasks.map((t) => {
    const start = manilaDay(t.started_at ?? t.created_at)
    const end = t.done_at && t.status === 'done' ? manilaDay(t.done_at) : today
    const due = t.due_at ? manilaDay(t.due_at) : null
    const overdue = t.status !== 'done' && due !== null && due < today
    return {
      key: t.task_id,
      label: t.title,
      sub: t.group_name ?? t.project_title,
      bar: { from: start, to: end < start ? start : end, tone: t.late || overdue ? 'late' : t.status === 'done' ? 'done' : 'open' },
      marks: due
        ? [{ key: 'due', day: due, label: 'Due', state: t.late || overdue ? 'late' : t.status === 'done' ? 'met' : 'upcoming' }]
        : [],
    }
  })
  const laneFrom = lanes.reduce((min, l) => (l.bar && l.bar.from < min ? l.bar.from : min), today)
  const laneTo = [today, ...lanes.flatMap((l) => l.marks.map((m) => m.day))].sort().at(-1) ?? today

  return (
    <Modal open onClose={onClose} title={entry.student_name} size="lg">
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Finished', `${entry.done} of ${entry.held}`],
            ['Late', String(entry.late)],
            ['Logged', `${(entry.worklog_minutes / 60).toFixed(1)}h`],
            ['Comments', String(entry.comments)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl surface-sunken px-3 py-2">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="font-mono text-[18px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        {entry.flags.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {entry.flags.map((f) => (
              <span key={f} className={`rounded-md px-2 py-0.5 text-[12px] ${TONE_CELL[FLAG_META[f].tone]}`}>
                {FLAG_META[f].word(entry)}
              </span>
            ))}
          </p>
        )}

        <section className="space-y-2">
          <h4 className="text-ink">Activity by week</h4>
          {weekly.some((w) => w.work + w.talk > 0) ? (
            <WeekBars rows={weekly} title={`${entry.student_name}: activity per week`} />
          ) : (
            <p className="text-[13px] text-muted">No activity recorded for this student yet.</p>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-ink">Recent tasks</h4>
          {lanes.length === 0 ? (
            <p className="text-[13px] text-muted">Holds no tasks.</p>
          ) : (
            <>
              <LaneTimeline lanes={lanes} from={addDays(laneFrom, -1)} to={addDays(laneTo, 1)} today={today} title={`${entry.student_name}: tasks from start to finish`} />
              <ul className="flex flex-wrap gap-1.5">
                {tasks.map((t) => (
                  <li key={t.task_id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(t.task_id)}
                      className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {mainBoard && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[13px] text-muted">
              Send a reminder to {mainBoard.group_name ?? 'their board'} on {mainBoard.project_title}.
            </p>
            <NudgeButton boardId={mainBoard.board_id} name={mainBoard.group_name ?? 'this board'} />
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: `StudentsView.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Roster } from '../../../../components/analytics/Roster'
import type { RosterEntry } from '../../../../components/analytics/Roster'
import { StudentDrawer } from '../../../../components/analytics/StudentDrawer'
import { idleDays, lastWeeks, manilaDay, studentFlags } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { Section } from './Section'

export function StudentsView({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)

  const entries = useMemo<RosterEntry[]>(() => {
    const now = new Date()
    const today = manilaDay(now)
    const weeks = lastWeeks(today, 8)
    const inGroup = new Map(data.people.map((p) => [`${p.class_id}:${p.student_id}`, p.in_any_group]))
    const termStarted = new Map(data.pace.map((p) => [p.class_id, p.term_start <= today]))
    return data.shownRoster.map((r) => {
      const shares = data.shownMembers
        .filter((m) => m.student_id === r.student_id && m.class_id === r.class_id && m.group_size >= 2)
        .map((m) => Number(m.held_pct))
      const lowestShare = shares.length ? Math.min(...shares) : null
      const mine = data.shownActivity.filter((a) => a.actor_id === r.student_id && a.class_id === r.class_id)
      const trend = weeks.map((w, i) => {
        const end = weeks[i + 1] ?? '9999-12-31'
        return mine.filter((a) => a.day >= w && a.day < end).reduce((s, a) => s + a.n, 0)
      })
      const flags = studentFlags(
        {
          held: r.held,
          done: r.done,
          late: r.late,
          lowestShare,
          inAnyGroup: inGroup.get(`${r.class_id}:${r.student_id}`) ?? true,
          lastActiveAt: r.last_active_at,
          termStarted: termStarted.get(r.class_id) ?? true,
        },
        now,
      )
      return { ...r, flags, lowestShare, trend, idle: idleDays(r.last_active_at, now) }
    })
  }, [data.shownRoster, data.shownMembers, data.shownActivity, data.people, data.pace])

  // Narrowing to a student in the scope bar opens their drawer, once.
  const scoped = data.scope.studentId && closedFor !== data.scope.studentId ? data.scope.studentId : null
  const openId = picked ?? scoped
  const open = entries.find((e) => e.student_id === openId) ?? null
  const flagged = entries.filter((e) => e.flags.length > 0).length

  return (
    <div className="space-y-5">
      <Section
        title="Students"
        subtitle={`${flagged} of ${entries.length} flagged. Flags are prompts for a conversation, never grades. Select a name for their full record.`}
      >
        <Roster entries={entries} onOpen={setPicked} />
      </Section>
      <StudentDrawer
        entry={open}
        data={data}
        onClose={() => {
          setPicked(null)
          setClosedFor(data.scope.studentId || null)
        }}
        onOpenTask={(id) => {
          setPicked(null)
          setClosedFor(data.scope.studentId || null)
          onOpenTask(id)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Build and lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/Roster.tsx src/components/analytics/StudentDrawer.tsx src/pages/app/analytics/views/StudentsView.tsx
git commit -m "Add the Students view: a flagged roster and a per-student record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Projects view

**Files:**
- Create: `src/components/analytics/MilestoneLanes.tsx`
- Create: `src/components/analytics/SprintReport.tsx`
- Create: `src/components/analytics/StuckWork.tsx`
- Create: `src/pages/app/analytics/views/ProjectsView.tsx`

**Interfaces:**
- Consumes:
  - `AnalyticsData`
  - `milestoneState`, `isStuck`, `addDays`, `manilaDay`, `daysBetween` (Task 3)
  - `LaneTimeline`, `ProgressBar`, `StackedBar` (Tasks 5-6)
  - `Section` (Task 7)
- Produces:
  - `<MilestoneLanes data={AnalyticsData} today={string} />`
  - `<SprintReport data={AnalyticsData} />`
  - `<StuckWork data={AnalyticsData} onOpenTask={(id: string) => void} />`
  - `<ProjectsView data={AnalyticsData} onOpenTask={(id: string) => void} />`

- [ ] **Step 1: `MilestoneLanes.tsx`**

```tsx
import { LaneTimeline } from '../charts/LaneTimeline'
import type { Lane } from '../charts/LaneTimeline'
import { addDays, milestoneState } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

/** Per project, one lane per group, a diamond per milestone in the colour of how that group met it. */
export function MilestoneLanes({ data, today }: { data: AnalyticsData; today: string }) {
  const byProject = new Map<string, typeof data.shownMilestones>()
  for (const m of data.shownMilestones) {
    byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), m])
  }
  if (byProject.size === 0) {
    return <p className="text-[13px] text-muted">No project in view has milestones. Add them on a project's Work tab.</p>
  }
  const boardName = new Map(data.shownBurns.map((b) => [b.board_id, b.group_name ?? b.student_name ?? 'Board']))
  const title = new Map(data.shownBurns.map((b) => [b.project_id, b.project_title]))

  return (
    <div className="space-y-6">
      {[...byProject].map(([projectId, rows]) => {
        const days = [today, ...rows.map((r) => r.due_on)].sort()
        const boards = [...new Set(rows.map((r) => r.board_id))]
        const lanes: Lane[] = boards.map((boardId) => ({
          key: boardId,
          label: boardName.get(boardId) ?? 'Board',
          marks: rows
            .filter((r) => r.board_id === boardId)
            .map((r) => ({ key: r.milestone_id, day: r.due_on, label: r.name, state: milestoneState(r, today) })),
        }))
        return (
          <div key={projectId} className="space-y-2">
            <p className="text-[13px] font-medium text-ink">{title.get(projectId) ?? 'Project'}</p>
            <LaneTimeline
              lanes={lanes}
              from={addDays(days[0], -3)}
              to={addDays(days[days.length - 1], 3)}
              today={today}
              title={`${title.get(projectId) ?? 'Project'} milestones by group`}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: `SprintReport.tsx`**

```tsx
import { StackedBar } from '../charts/StackedBar'
import { shortDay } from '../charts/format'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

const STATE = { planned: 'Planned', active: 'Running', completed: 'Completed' } as const

/**
 * What each sprint finished inside its own dates. What it was committed to at
 * the start is not recorded, so it is not claimed.
 */
export function SprintReport({ data }: { data: AnalyticsData }) {
  if (!data.scope.boardId) {
    return <p className="text-[13px] text-muted">Choose a group in the scope bar to see its sprints.</p>
  }
  if (data.shownSprints.length === 0) {
    return <p className="text-[13px] text-muted">This group has not planned any sprints.</p>
  }
  const max = Math.max(1, ...data.shownSprints.map((s) => s.tasks))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <caption className="sr-only">Sprints and what each finished in its window</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="px-2 py-2 font-medium">Sprint</th>
            <th scope="col" className="px-2 py-2 font-medium">Dates</th>
            <th scope="col" className="px-2 py-2 font-medium">State</th>
            <th scope="col" className="px-2 py-2 font-medium">In window · after · open</th>
          </tr>
        </thead>
        <tbody>
          {data.shownSprints.map((s) => (
            <tr key={s.sprint_id} className="border-b border-line last:border-0">
              <th scope="row" className="px-2 py-2 text-left font-normal text-ink">{s.name}</th>
              <td className="px-2 py-2 font-mono text-[12px] text-muted">{shortDay(s.starts_on)} – {shortDay(s.ends_on)}</td>
              <td className="px-2 py-2 text-muted">{STATE[s.state]}</td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-3">
                  <StackedBar
                    max={max}
                    parts={[
                      { label: 'finished in window', value: s.done_in_window, tone: 'done' },
                      { label: 'finished after', value: s.done - s.done_in_window, tone: 'late' },
                      { label: 'still open', value: s.tasks - s.done, tone: 'todo' },
                    ]}
                  />
                  <span className="shrink-0 font-mono text-[12px] text-faint">
                    {s.done_in_window} · {s.done - s.done_in_window} · {s.tasks - s.done}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

`StackedBar` scales each segment to `max`, so sprints share one scale and a small sprint draws a short bar.

- [ ] **Step 3: `StuckWork.tsx`**

```tsx
import { daysBetween, isStuck, manilaDay } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

/** Tasks in progress for a week or more, oldest first. */
export function StuckWork({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const now = new Date()
  const today = manilaDay(now)
  const stuck = data.shownTasks
    .filter((t) => isStuck(t, now))
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
  if (stuck.length === 0) {
    return <p className="text-[13px] text-muted">Nothing has been in progress for a week or more.</p>
  }
  return (
    <ul className="space-y-2">
      {stuck.map((t) => (
        <li key={t.task_id}>
          <button
            type="button"
            onClick={() => onOpenTask(t.task_id)}
            className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{t.title}</span>
              <span className="block truncate text-[12px] text-faint">
                {t.group_name ?? t.board_student_name} · {t.assignee_names || 'nobody'}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-warning-400/20 px-2 py-0.5 font-mono text-[12px] text-warning-700 dark:text-warning-300">
              {daysBetween(manilaDay(t.started_at as string), today)} days
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: `ProjectsView.tsx`**

```tsx
import { MilestoneLanes } from '../../../../components/analytics/MilestoneLanes'
import { SprintReport } from '../../../../components/analytics/SprintReport'
import { StuckWork } from '../../../../components/analytics/StuckWork'
import { ProgressBar } from '../../../../components/charts/ProgressBar'
import { manilaDay } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { Section } from './Section'

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export function ProjectsView({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const today = manilaDay(new Date())
  const projects = new Map<string, typeof data.shownBurns>()
  for (const b of data.shownBurns) projects.set(b.project_id, [...(projects.get(b.project_id) ?? []), b])
  const cycles = new Map(data.shownCycles.map((c) => [c.board_id, c]))

  return (
    <div className="space-y-5">
      <Section title="Projects compared" subtitle="Each group's progress per project, how hand-ins went, and how long they waited for your answer.">
        {projects.size === 0 ? (
          <p className="text-[13px] text-muted">No projects in view.</p>
        ) : (
          <ul className="grid gap-5 lg:grid-cols-2">
            {[...projects].map(([projectId, boards]) => {
              const handedIn = boards.filter((b) => b.submitted_at)
              const onTime = handedIn.filter((b) => !b.project_due_at || (b.submitted_at ?? '') <= b.project_due_at)
              const returns = avg(boards.map((b) => cycles.get(b.board_id)?.returns ?? 0))
              const waits = boards
                .map((b) => cycles.get(b.board_id)?.decision_hours)
                .filter((h): h is number => h !== null && h !== undefined)
                .map(Number)
              const wait = avg(waits)
              return (
                <li key={projectId} className="min-w-0 space-y-3 rounded-xl border border-line p-3.5">
                  <p className="truncate font-medium text-ink">{boards[0].project_title}</p>
                  <ul className="space-y-1.5">
                    {boards.map((b) => (
                      <li key={b.board_id} className="flex items-center gap-3 text-[12px]">
                        <span className="w-28 shrink-0 truncate text-muted">{b.group_name ?? b.student_name}</span>
                        <ProgressBar value={Number(b.done_pct)} />
                      </li>
                    ))}
                  </ul>
                  <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px]">
                    <div>
                      <dt className="text-faint">On-time hand-ins</dt>
                      <dd className="font-mono text-ink">{handedIn.length ? `${onTime.length} of ${handedIn.length}` : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Returns per group</dt>
                      <dd className="font-mono text-ink">{returns === null ? '—' : returns.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Wait for answer</dt>
                      <dd className="font-mono text-ink">{wait === null ? '—' : `${Math.round(wait)}h`}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Milestones" subtitle="Each group against each milestone. Met means every task tagged to it was done by its date.">
        <MilestoneLanes data={data} today={today} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Sprints" subtitle="What each sprint finished inside its own dates, what came after, and what is still open.">
          <SprintReport data={data} />
        </Section>
        <Section title="Stuck work" subtitle="In progress for a week or more. Usually a blocker nobody has said out loud.">
          <StuckWork data={data} onOpenTask={onOpenTask} />
        </Section>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/MilestoneLanes.tsx src/components/analytics/SprintReport.tsx src/components/analytics/StuckWork.tsx src/pages/app/analytics/views/ProjectsView.tsx
git commit -m "Add the Projects view: comparison, milestones, sprints and stuck work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the page and retire the bands

**Files:**
- Modify: `src/pages/app/analytics/Analytics.tsx` (full rewrite below)
- Delete: `src/pages/app/analytics/bands/Descriptive.tsx`, `Diagnostic.tsx`, `Predictive.tsx`, `Prescriptive.tsx`
- Delete if unused afterwards: `src/components/analytics/BandHeader.tsx`, `MemberLoad.tsx`, `ParticipationList.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2-10.

- [ ] **Step 1: Rewrite `Analytics.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FilterChain } from '../../../components/analytics/FilterChain'
import { NeedsAttention } from '../../../components/analytics/NeedsAttention'
import type { Scope } from '../../../components/analytics/scope'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Spinner } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import type { Tab } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import { readAnalyticsView, viewForAction } from '../../../lib/analyticsView'
import type { AnalyticsView } from '../../../lib/analyticsView'
import { dueSoonLabel, taskStatusLabel } from '../../../lib/types'
import { useAnalytics } from './useAnalytics'
import { ClassView } from './views/ClassView'
import { GroupsView } from './views/GroupsView'
import { ProjectsView } from './views/ProjectsView'
import { StudentsView } from './views/StudentsView'

const VIEW_TABS: Tab<AnalyticsView>[] = [
  { id: 'class', label: 'Class', icon: 'chart' },
  { id: 'groups', label: 'Groups', icon: 'users' },
  { id: 'students', label: 'Students', icon: 'user' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
]

/**
 * What is happening across a professor's classes, asked four ways: the class,
 * its groups, its students, its projects. What needs doing sits on top, and
 * every item in it points at the chart that argues for it.
 *
 * Everything is counted, not guessed. The forward-looking figures are division,
 * and each prints the division beside it.
 */
export default function Analytics({ classId }: { classId?: string }) {
  const { profile } = useAuth()
  const data = useAnalytics(classId)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const view = readAnalyticsView(params.get('view'))
  const { scope, setScope, shownTasks } = data

  useEffect(() => {
    if (!classId) document.title = 'Analytics · Collabify'
  }, [classId])

  const setView = (next: AnalyticsView) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('view', next)
        return n
      },
      { replace: true },
    )

  // Narrowing to a person or a group is a question about them: go where it is answered.
  const onScope = (next: Scope) => {
    setScope(next)
    if (next.studentId && next.studentId !== scope.studentId) setView('students')
    else if (next.boardId && next.boardId !== scope.boardId) setView('groups')
  }

  if (data.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  const empty = classId ? !data.health.some((c) => c.class_id === classId) : data.health.length === 0

  return (
    <div className="w-full space-y-6">
      {!classId && (
        <DirectoryHero
          title="Analytics,"
          accent="with context."
          description="Your class, its groups, its students and its projects, with what needs you first."
        />
      )}

      {data.error && <Alert tone="error" onRetry={data.reload}>{data.error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[12px] font-medium text-faint">Analysis scope</p>
          <p className="mt-0.5 text-[13px] text-muted">Start broad, then narrow only when needed.</p>
        </div>
        <FilterChain
          scope={scope}
          onChange={onScope}
          classes={classId ? data.health.filter((c) => c.class_id === classId) : data.health}
          burns={data.burns}
          members={data.members}
          tasks={data.tasks}
          lockClass={Boolean(classId)}
        />
      </div>

      {empty ? (
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          body="Create a class, set its term dates and give it a syllabus, and its pace shows up here."
        />
      ) : (
        <>
          <NeedsAttention actions={data.actions} onSeeWhy={(a) => setView(viewForAction(a.kind))} />

          <Tabs variant="panel" tabs={VIEW_TABS} active={view} onChange={setView} />

          {view === 'class' && <ClassView data={data} />}
          {view === 'groups' && <GroupsView data={data} />}
          {view === 'students' && <StudentsView data={data} onOpenTask={setOpenTask} />}
          {view === 'projects' && <ProjectsView data={data} onOpenTask={setOpenTask} />}

          {(scope.boardId || scope.studentId || scope.taskId) && (
            <section className="space-y-3 border-t border-line pt-6">
              <h2>
                Tasks
                <span className="ml-2 font-mono text-[13px] text-faint">{shownTasks.length}</span>
              </h2>
              <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {shownTasks.map((t) => {
                  const due = dueSoonLabel(t.due_at)
                  return (
                    <li key={t.task_id}>
                      <button
                        type="button"
                        onClick={() => setOpenTask(t.task_id)}
                        className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-ink">{t.title}</span>
                          <span className="block truncate text-[12px] text-faint">
                            {t.group_name ?? t.board_student_name} · {t.project_title}
                            {t.assignee_names && ` · ${t.assignee_names}`}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
                          {taskStatusLabel(t.status)}
                        </span>
                        {t.late && (
                          <span className="shrink-0 rounded-md bg-danger-500/15 px-1.5 py-0.5 font-mono text-[12px] text-danger-700 dark:text-danger-300">
                            late
                          </span>
                        )}
                        {due && !t.late && <span className="shrink-0 font-mono text-[12px] text-faint">{due}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <TaskDetailModal
        taskId={openTask}
        onClose={() => setOpenTask(null)}
        viewerId={profile?.id}
        role="professor"
        boardWeight={0}
        onChanged={data.reload}
      />
    </div>
  )
}
```

- [ ] **Step 2: Delete the bands and anything left unused**

```bash
git rm src/pages/app/analytics/bands/Descriptive.tsx src/pages/app/analytics/bands/Diagnostic.tsx src/pages/app/analytics/bands/Predictive.tsx src/pages/app/analytics/bands/Prescriptive.tsx
git grep -n "BandHeader\|components/analytics/MemberLoad\|ParticipationList" -- src
```

For each of `BandHeader.tsx`, `MemberLoad.tsx` and `ParticipationList.tsx` that the grep shows no importer for, run `git rm` on it.

- [ ] **Step 3: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A src/pages/app/analytics src/components/analytics
git commit -m "Arrange Analytics as Class, Groups, Students and Projects with Needs attention first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verify in the browser, record, ship

**Files:**
- Modify: `handoff.md` (append a section at the end)

- [ ] **Step 1: Run the full suite again**

Run: `npm run build && npm run lint && npm test && node scripts/db.mjs supabase/tests/analytics-trends.test.sql && node scripts/db.mjs supabase/tests/analytics.test.sql`
Expected: all pass.

- [ ] **Step 2: Start the dev server and sign in**

Start the dev server with `preview_start` (name from `.claude/launch.json`, port 5173). Sign in as a faculty account with `can_teach` that owns a class with real tasks. If no test login is on hand, stop and ask the user for one; do not skip this step.

- [ ] **Step 3: Walk every view on a class with data**

Go to Classes, open the class, then the Analytics tab. For each of Class, Groups, Students and Projects:
- Confirm `read_console_messages` shows no errors.
- Confirm `read_page` shows real figures: KPI values, burnup, health grid rows, roster rows, project cards.
- Take a screenshot.

Then:
- Choose a project in the scope bar. Confirm the group burnups appear on Groups.
- Choose a group. Confirm the view switches to Groups, the calendar heat fills in, and Sprints shows rows (or the "has not planned any sprints" line).
- Choose a student. Confirm the view switches to Students and the drawer opens. Close it, and confirm it stays closed.
- Open Needs attention and press "See why" on a card. Confirm the view switches.
- Open a task from Stuck work or the drawer. Confirm `TaskDetailModal` opens.

- [ ] **Step 4: Edge cases**

- Open Analytics on a class with no tasks. Expected: empty states, no console errors.
- Open the global page `/teaching/analytics` with no class chosen. Expected: every view renders across classes.
- `resize_window` at 1440 wide, tablet 768 and mobile 375, in light and dark. Expected: no horizontal page scroll; the grid and roster scroll inside their cards; the drawer fits the screen.
- With reduced motion emulated, or `matchMedia` checked: expected sections appear without a slide.

- [ ] **Step 5: Record it in `handoff.md`**

Append at the end:

```markdown
## Analytics redesign — Phase A (2026-10-13)

Spec: `docs/superpowers/specs/2026-10-13-class-analytics-redesign-design.md`.
Plan: `docs/superpowers/plans/2026-10-13-class-analytics-redesign.md`.

**Layout.** Analytics is four sub-views: Class, Groups, Students and Projects, kept in `?view=`. Narrowing to a group jumps to Groups, and narrowing to a student opens their record on Students.

**Recommendations moved to the top.** The "Needs attention" strip replaces the old last-place Prescriptive band. Each card has "See why", which opens the view that holds its evidence (`lib/analyticsView.ts`).

**Data.** `supabase/analytics-trends.sql` adds `analytics_daily_activity`, `analytics_student_roster`, `analytics_board_cycles`, `analytics_milestones` and `analytics_sprints`. `task_state` gained `created_at`, `sprint_id` and `milestone_id`. Days are Manila days. Reads past 1,000 rows page through `lib/api/paging.ts`.

**Thresholds** live in `lib/analyticsMath.ts`:
- `LOW_SHARE_PCT` 10, measured on `held_pct`, never `personal_pct`
- `INACTIVE_DAYS` 7
- often late: ≥3 late and ≥30% of finished
- `STUCK_DAYS` 7
- the health-grid bands in `healthTone`

**Known gap.** The sprint report cannot show "committed at start" or "carried over", because completing a sprint moves open tasks on without a trace. Phase C adds sprint-membership history.

**Next.**
1. Phase C: peer evaluation (CATME-style), rubric scores with individual adjustment, intervention notes. This reverses the "no grade" rule above (`Analytics` section and `reports.sql:26-29`). That reversal was agreed with the user on 2026-10-13.
2. Then Phase B: Reports rebuilt on the General Report Builder.
```

- [ ] **Step 6: Commit and push**

```bash
git add handoff.md
git commit -m "Record the Analytics redesign in the handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Then open dyci-collabify.vercel.app after the deploy finishes and repeat a quick pass of Step 3 on the live site.
