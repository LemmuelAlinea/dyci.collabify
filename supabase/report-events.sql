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
