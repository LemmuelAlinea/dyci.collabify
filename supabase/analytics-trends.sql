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
       coalesce(gn.names, '{}'::text[])             as group_names,
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
  left join (
    select gs.class_id, gm.student_id,
           array_agg(distinct g.name order by g.name) as names
      from public.group_members gm
      join public.groups g       on g.id = gm.group_id
      join public.group_sets gs  on gs.id = g.set_id
     where g.archived_at is null
     group by gs.class_id, gm.student_id
  ) gn on gn.class_id = c.id and gn.student_id = cm.student_id
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
