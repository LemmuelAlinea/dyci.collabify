-- Collabify — why the work is behind, what is coming, and what to do about it.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/analytics-insight.sql
--
-- Depends on task_board_overview and task_member_progress. Those are dropped
-- with `cascade` by the files that own them, so after re-running any of
-- results.sql, tasks.sql, task-points.sql, task-claim-limit.sql or
-- deadline-lock.sql, rebuild the whole chain in one command:
--
--   node scripts/db.mjs supabase/results.sql supabase/analytics.sql \
--     supabase/analytics-insight.sql

/**
 * The analytics page answers four questions in order: what happened, why, what
 * is coming, what to do. `analytics.sql` covers the first. This file covers the
 * other three.
 *
 * Views only, again — nothing here is a new fact about a class, only a reading
 * of facts already recorded.
 *
 * Two rules carried over from `analytics.sql` and not to be relaxed:
 *
 *   1. `security_invoker = true` and `is_class_professor` on every view. Most of
 *      what follows measures what is *missing* — unclaimed work, a member
 *      holding nothing, a week with no project — and a negative measurement is
 *      only true for somebody who can see everything it measures.
 *
 *   2. No sentences. These views emit counts, ids and names; the copy that turns
 *      a row into "Maria holds 68% of this board" lives in `src/lib/insight.ts`,
 *      so wording is written once and in one language.
 *
 * The thresholds are inlined below and mirrored in `src/lib/insight.ts`. They
 * are:
 *
 *   stalled          7 days with nothing moving   (the figure findStalled uses)
 *   returned quiet   3 days after a return
 *   carrying alone   50% of a board held by one member (CARRYING_ALONE_PCT)
 *   pile-up          5 open tasks falling due inside one week
 *   waiting request  2 days a reassignment has gone undecided
 *
 * One rule is deliberately absent: whether a board will *finish late*. That
 * needs the burn projection, and the projection has exactly one home —
 * `projectBurn` in src/lib/types.ts. A second copy in SQL is how two answers to
 * one question start to disagree.
 */

begin;

-- The three views below feed `class_actions` at the bottom of this file, so
-- each drop cascades: a plain drop refuses while a dependant exists, and the
-- file would only run once. Everything cascade takes is rebuilt before commit.

-- ------------------------------------------------------------- diagnosis

/**
 * One row per board: every cause of trouble anybody has evidence for, with its
 * size. The page ranks these into "why" sentences; nothing is ranked here,
 * because what matters most depends on how far the deadline is, which is the
 * next view's business.
 */
drop view if exists public.board_diagnosis cascade;

create view public.board_diagnosis
with (security_invoker = true) as
select b.id           as board_id,
       b.class_id,
       b.project_id,
       b.group_id,
       b.project_title,
       coalesce(b.group_name, b.student_name) as owner_name,
       b.project_due_at,
       b.project_locked_at,
       b.submitted_at,
       b.result_verdict,
       b.result_at,
       b.task_count,
       b.done_count,
       b.unclaimed_count,
       b.late_count,
       b.member_count,
       b.done_pct,
       b.last_activity,
       p.release_at,
       -- Whole days since anything on the board moved. Null when nothing ever
       -- has: "never touched" is a different problem from "quiet for a while".
       case when b.last_activity is null then null
            else (current_date - b.last_activity::date)::int end as idle_days,
       -- Tasks exist and not one has been picked up and begun.
       (b.task_count > 0 and coalesce(ov.started_count, 0) = 0) as never_started,
       coalesce(ov.overdue_open_count, 0) as overdue_open_count,
       h.top_holder_id,
       btrim(hp.first_name || ' ' || hp.last_name) as top_holder_name,
       h.top_holder_pct,
       h.members_holding_nothing,
       coalesce(e.unclaim_events, 0)  as unclaim_events,
       coalesce(e.reopened_events, 0) as reopened_events,
       coalesce(r.reassignments_total, 0)   as reassignments_total,
       coalesce(r.reassignments_pending, 0) as reassignments_pending,
       r.oldest_pending_at,
       -- A board sent back to be fixed, where nothing has moved since. The
       -- comparison is against the board's own last activity, so a group that
       -- did start fixing it is not on this list.
       (b.result_verdict = 'returned'
        and (b.last_activity is null or b.last_activity <= b.result_at)) as returned_untouched
  from public.task_board_overview b
  join public.projects p on p.id = b.project_id
  /**
   * Four correlated laterals used to hang here, each re-scanning per board:
   * `explain analyze` put this at 91 ms for 20 boards, growing as boards x
   * tasks. They are grouped joins now — one pass over each table, joined on
   * board_id — which is the same rewrite `class_participation` needed.
   *
   * Left joins with `coalesce` above, because a board with no tasks, no events
   * and no reassignments still has to appear in the diagnosis with zeros.
   */
  left join (
    select t.board_id,
           count(*) filter (
             where t.status <> 'done' and t.due_at is not null and t.due_at < now()
           )::int as overdue_open_count,
           count(*) filter (where t.started_at is not null)::int as started_count
      from public.project_tasks t
     group by t.board_id
  ) ov on ov.board_id = b.id

  -- Group boards only. On an individual board one person holding everything is
  -- the arrangement, not a symptom.
  /**
   * A plain grouped aggregate, deliberately. The obvious spelling — `distinct
   * on (board_id) ... order by held_pct desc` with a window count — measured
   * *worse*: the planner would not hash-join it, and re-ran it once per board,
   * 78 ms x 20 = 1.5 s inside `class_actions`. A GroupAggregate hash-joins, so
   * the view is scanned once.
   *
   * `array_agg(... order by held_pct desc)[1]` is the top holder; `max` is that
   * same row's percentage.
   */
  left join (
    select m.board_id,
           (array_agg(m.student_id order by m.held_pct desc))[1] as top_holder_id,
           max(m.held_pct)                                       as top_holder_pct,
           count(*) filter (where m.held_pct = 0)::int           as members_holding_nothing
      from public.task_member_progress m
     group by m.board_id
  ) h on h.board_id = b.id and b.group_id is not null
  left join public.profiles hp on hp.id = h.top_holder_id

  -- Churn: work put back, and work reopened after being called done.
  left join (
    select t.board_id,
           count(*) filter (where ev.kind = 'unclaimed')::int as unclaim_events,
           count(*) filter (where ev.kind = 'reopened')::int  as reopened_events
      from public.task_events ev
      join public.project_tasks t on t.id = ev.task_id
     group by t.board_id
  ) e on e.board_id = b.id

  left join (
    select t.board_id,
           count(*)::int                                        as reassignments_total,
           count(*) filter (where q.status = 'pending')::int     as reassignments_pending,
           min(q.created_at) filter (where q.status = 'pending') as oldest_pending_at
      from public.task_reassignments q
      join public.project_tasks t on t.id = q.task_id
     group by t.board_id
  ) r on r.board_id = b.id

  -- There is deliberately no count of work held by somebody who has left. It
  -- cannot happen: removing a class member drops their group memberships, and
  -- `group_members_release_tasks` puts every task they held back to unclaimed.
  -- The work reappears under the unclaimed rule, which is where a professor
  -- would look for it. Proven in supabase/tests/insight.test.sql.
 where p.archived_at is null
   and public.is_class_professor(b.class_id);

grant select on public.board_diagnosis to authenticated;

-- --------------------------------------------------------- participation

/**
 * One row per active member of a class, and how much of the class's work they
 * are anywhere near.
 *
 * This is what finds the student nobody has noticed: enrolled, in no group, on
 * no board, holding no task. They are invisible to every other view on the
 * page precisely because they have produced nothing to measure.
 *
 * Effort only, and never a mark: what they hold, what they finished, when they
 * last moved.
 */
drop view if exists public.class_participation cascade;

create view public.class_participation
with (security_invoker = true) as
select c.id  as class_id,
       cm.student_id,
       btrim(pr.first_name || ' ' || pr.last_name) as student_name,
       pr.avatar_url,
       coalesce(w.boards_on, 0)  as boards_on,
       coalesce(w.tasks_held, 0) as tasks_held,
       coalesce(w.tasks_done, 0) as tasks_done,
       w.last_move,
       exists (
         select 1
           from public.group_members gm
           join public.groups g on g.id = gm.group_id
           join public.group_sets gs on gs.id = g.set_id
          where gm.student_id = cm.student_id and gs.class_id = c.id
       ) as in_any_group
  from public.classes c
  join public.class_members cm on cm.class_id = c.id and cm.status = 'active'
  join public.profiles pr on pr.id = cm.student_id
  /**
   * Grouped once, not once per student. This was a correlated lateral, which
   * re-scanned every board in the class for each member: `explain analyze` on
   * the live database showed 320 loops for 16 students and 20 boards, and the
   * shape was members x boards — fine at 591 rows, quadratic at a cohort's.
   * Grouping makes it one pass over the tasks instead.
   *
   * Left join, because a student who holds nothing still belongs on the list —
   * that is the whole point of a participation view — so the counts coalesce to
   * zero above rather than vanishing.
   */
  left join (
    select pj.class_id,
           a.student_id,
           count(distinct t.board_id)::int                     as boards_on,
           count(*)::int                                       as tasks_held,
           count(*) filter (where t.status = 'done')::int      as tasks_done,
           max(greatest(t.done_at, t.started_at, t.updated_at)) as last_move
      from public.project_tasks t
      join public.task_assignees a on a.task_id = t.id
      join public.project_boards pb on pb.id = t.board_id
      join public.projects pj on pj.id = pb.project_id
     where pj.archived_at is null
     group by pj.class_id, a.student_id
  ) w on w.class_id = c.id and w.student_id = cm.student_id
 where c.archived_at is null
   and public.is_class_professor(c.id);

grant select on public.class_participation to authenticated;

-- ------------------------------------------------------------- pressure

/**
 * Open work, bucketed by the week it falls due — the next four weeks, plus one
 * bucket for what is already past due.
 *
 * Counting, not forecasting: it says a fortnight from now has eleven tasks
 * landing in it, which is the kind of thing a professor can still move.
 */
drop view if exists public.deadline_pressure cascade;

create view public.deadline_pressure
with (security_invoker = true) as
select b.class_id,
       (t.due_at < now())                              as overdue,
       case when t.due_at < now() then null
            else date_trunc('week', t.due_at)::date end as week_start,
       count(*)::int                        as due_count,
       count(distinct b.id)::int            as board_count,
       count(distinct b.project_id)::int    as project_count
  from public.project_tasks t
  join public.task_board_overview b on b.id = t.board_id
 where t.status <> 'done'
   and t.due_at is not null
   and t.due_at < (current_date + 28)
   and b.submitted_at is null
   and public.is_class_professor(b.class_id)
 group by 1, 2, 3;

grant select on public.deadline_pressure to authenticated;

-- -------------------------------------------------------------- actions

/**
 * The prescriptive layer: one row per thing worth doing, with the numbers that
 * argue for it. Facts only — the page writes the sentence and chooses where the
 * link goes.
 *
 * `severity` is 1 (deal with this) to 4 (worth knowing). It orders the list;
 * it is not a score of anything and does not add up.
 *
 * Every branch casts its literals. A `union all` resolves an untyped literal as
 * text in the first branch that meets it, and the column would then refuse an
 * enum from the branch below.
 */
drop view if exists public.class_actions;

/**
 * The branches below read `board_diagnosis` six times and
 * `class_participation` twice, and each read re-ran the whole thing: five
 * lateral joins over every board in the program, per branch. Measured against
 * the live database it cost **422 ms** for 45 rows.
 *
 * `materialized` forces each one to be computed once and reused. It is the
 * opposite of the usual advice — Postgres inlines CTEs by default precisely so
 * it can optimise across them — but here the inlining is what caused the
 * repetition, and the result set is tiny.
 */
create view public.class_actions
with (security_invoker = true) as
with d as materialized (select * from public.board_diagnosis),
     p as materialized (select * from public.class_participation)

-- Work already past its date and not finished. The most concrete thing here.
select d.class_id,
       'overdue_work'::text  as kind,
       1::int                as severity,
       'board'::text         as subject_kind,
       d.board_id            as subject_id,
       d.owner_name          as subject_name,
       d.project_id,
       d.board_id,
       null::uuid            as student_id,
       d.overdue_open_count  as n,
       d.project_due_at      as at
  from d
 where d.overdue_open_count > 0
   and d.submitted_at is null

union all

-- Sent back to be fixed, and nothing has happened since.
select d.class_id, 'returned_untouched'::text, 1::int, 'board'::text,
       d.board_id, d.owner_name, d.project_id, d.board_id, null::uuid,
       (current_date - d.result_at::date)::int, d.result_at
  from d
 where d.returned_untouched
   and d.result_at < (now() - interval '3 days')

union all

-- Quiet for a week. An empty board is a different rule below: nothing has moved
-- there either, but the fix is to give them work rather than to chase them.
select d.class_id, 'stalled_board'::text, 2::int, 'board'::text,
       d.board_id, d.owner_name, d.project_id, d.board_id, null::uuid,
       d.idle_days, d.last_activity
  from d
 where d.task_count > 0
   and d.done_count < d.task_count
   and d.submitted_at is null
   and d.idle_days >= 7

union all

-- Released to the students, and nobody has put a single task on it.
select d.class_id, 'empty_board'::text, 2::int, 'board'::text,
       d.board_id, d.owner_name, d.project_id, d.board_id, null::uuid,
       0::int, d.project_due_at
  from d
 where d.task_count = 0
   and (d.release_at is null or d.release_at <= now())

union all

-- Tasks nobody has taken. Common, and the usual reason a group is at zero.
select d.class_id, 'unclaimed_work'::text, 3::int, 'board'::text,
       d.board_id, d.owner_name, d.project_id, d.board_id, null::uuid,
       d.unclaimed_count, d.project_due_at
  from d
 where d.unclaimed_count > 0
   and d.submitted_at is null
   and (d.release_at is null or d.release_at <= now())

union all

-- One member carrying a group while somebody on it holds nothing at all.
-- Both halves matter: half the board is a fair share of a pair.
select d.class_id, 'carrying_alone'::text, 3::int, 'student'::text,
       d.top_holder_id, d.top_holder_name, d.project_id, d.board_id, d.top_holder_id,
       round(d.top_holder_pct)::int, d.last_activity
  from d
 where d.group_id is not null
   and d.member_count >= 3
   and d.top_holder_pct >= 50
   and d.members_holding_nothing > 0
   and d.submitted_at is null

union all

-- Enrolled, in no group at all, while the class runs group work. Nothing else
-- on the page can see this student, because they have produced nothing.
select p.class_id, 'not_in_a_group'::text, 3::int, 'student'::text,
       p.student_id, p.student_name, null::uuid, null::uuid, p.student_id,
       0::int, null::timestamptz
  from p
 where not p.in_any_group
   and exists (
     select 1 from public.projects pj
      where pj.class_id = p.class_id
        and pj.archived_at is null
        and pj.audience = 'group'
        and (pj.release_at is null or pj.release_at <= now())
   )

union all

-- On a board and holding nothing on it. Their groupmates are carrying the work.
select p.class_id, 'holding_nothing'::text, 4::int, 'student'::text,
       p.student_id, p.student_name, null::uuid, null::uuid, p.student_id,
       0::int, p.last_move
  from p
 where p.in_any_group
   and p.tasks_held = 0
   and exists (
     select 1 from public.projects pj
      where pj.class_id = p.class_id
        and pj.archived_at is null
        and (pj.release_at is null or pj.release_at <= now())
   )

union all

-- A reassignment nobody has ruled on. The student is stuck until it is decided.
select b.class_id, 'pending_reassignment'::text, 2::int, 'board'::text,
       b.id, coalesce(b.group_name, b.student_name), b.project_id, b.id, q.requested_by,
       (current_date - q.created_at::date)::int, q.created_at
  from public.task_reassignments q
  join public.project_tasks t on t.id = q.task_id
  join public.task_board_overview b on b.id = t.board_id
 where q.status = 'pending'
   and q.created_at < (now() - interval '2 days')
   and public.is_class_professor(b.class_id)

union all

-- A week with a pile of work landing in it, while there is still time to move
-- something. Five is the point at which a class stops being able to do it all.
select d.class_id, 'deadline_pile_up'::text, 4::int, 'week'::text,
       null::uuid, to_char(d.week_start, 'FMDay DD Mon')::text,
       null::uuid, null::uuid, null::uuid,
       d.due_count, d.week_start::timestamptz
  from public.deadline_pressure d
 where not d.overdue
   and d.due_count >= 5

union all

-- The syllabus asked for something in a week that has nothing against it.
select g.class_id, 'syllabus_gap'::text,
       case when g.phase = 'past' then 3 else 4 end::int, 'week'::text,
       null::uuid, ('Week ' || g.week_no)::text, null::uuid, null::uuid, null::uuid,
       g.week_no, g.week_start::timestamptz
  from public.class_gaps g
 where g.phase in ('past', 'current')

union all

-- The class cannot be measured at all until somebody finishes setting it up.
select u.class_id, 'class_unmeasured'::text, 4::int, 'class'::text,
       u.class_id, u.class_name, null::uuid, null::uuid, null::uuid,
       (u.needs_term::int + u.needs_syllabus::int), null::timestamptz
  from public.class_unmeasured u;

grant select on public.class_actions to authenticated;

commit;
