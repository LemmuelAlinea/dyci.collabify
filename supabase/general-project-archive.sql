-- Collabify — per-project archive for General tasks and files.
--
--   node scripts/db.mjs supabase/general-project-archive.sql
--
-- Deletion inside a project is now a soft archive for tasks and task
-- attachments. This file owns the columns, indexes and views; every archive
-- function lives in general-archive-rbac.sql, which must run after this one.

begin;

alter table public.general_tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

alter table public.general_task_files
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

create index if not exists general_tasks_archive_idx
  on public.general_tasks (project_id, archived_at) where archived_at is not null;
create index if not exists general_task_files_archive_idx
  on public.general_task_files (project_id, archived_at) where archived_at is not null;

commit;

begin;

create or replace view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce(
         (select array_agg(a.user_id order by a.assigned_at)
            from public.general_task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int as comment_count,
       (select count(*) from public.general_task_files f where f.task_id = t.id and f.archived_at is null)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at,
       t.archived_at,
       t.archived_by
  from public.general_tasks t;

grant select on public.general_task_overview to authenticated;

create or replace view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       (select jc.code from public.general_join_codes jc where jc.project_id = p.id) as join_code,
       coalesce((select jc.open from public.general_join_codes jc where jc.project_id = p.id), false)
         as join_open,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at,
       m.level as my_level,
       (select count(*) from public.general_members x where x.project_id = p.id)::int as member_count,
       coalesce(t.task_count, 0) as task_count,
       coalesce(t.done_count, 0) as done_count,
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset,
       p.has_code,
       p.space_id
  from public.general_projects p
  left join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id and x.archived_at is null
  ) t on true;

grant select on public.general_project_overview to authenticated;

commit;
