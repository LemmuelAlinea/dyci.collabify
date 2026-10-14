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
-- Not materialized, so a caller's class_id filter reaches projects through its
-- index instead of judging every board the professor can see first.
with base as not materialized (
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
