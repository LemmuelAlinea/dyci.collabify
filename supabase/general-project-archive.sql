-- Collabify — per-project archive for General tasks and files.
--
--   node scripts/db.mjs supabase/general-project-archive.sql
--
-- Deletion inside a project is now a soft archive for tasks and task
-- attachments. Repository files already record removals as commits; this adds
-- a read model for the latest removed paths so the project archive can show
-- them beside archived task items.

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

begin;

create or replace function public.archive_general_task(p_task uuid, p_archived boolean)
returns public.general_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(t.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or (t.created_by = auth.uid() and not public.general_task_held(t.id))
  ) then
    raise exception 'Only its creator, before anyone takes it, or someone who manages tasks can archive this.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  return t;
end;
$$;

create or replace function public.archive_general_task_file(p_file uuid, p_archived boolean)
returns public.general_task_files
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file for update;
  if not found then
    raise exception 'File not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(f.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()) then
    raise exception 'Only whoever added this file, or somebody who can edit files, can archive it.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.general_task_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_file
   returning * into f;
  return f;
end;
$$;

create or replace function public.list_archived_general_task_files(p_project uuid)
returns table (
  id uuid,
  task_id uuid,
  project_id uuid,
  uploaded_by uuid,
  file_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  archived_at timestamptz,
  archived_by uuid,
  task_title text
)
language sql
security definer
set search_path = public
as $$
  select f.id, f.task_id, f.project_id, f.uploaded_by, f.file_path, f.file_name, f.mime_type,
         f.size_bytes, f.created_at, f.archived_at, f.archived_by, t.title as task_title
    from public.general_task_files f
    join public.general_tasks t on t.id = f.task_id
   where f.project_id = p_project
     and f.archived_at is not null
     and public.is_general_member(p_project)
   order by f.archived_at desc;
$$;

create or replace function public.list_removed_general_repo_paths(p_project uuid)
returns table (
  repo_id uuid,
  repo_name text,
  path text,
  kind public.general_file_kind,
  seq integer,
  removed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select latest.repo_id, r.name as repo_name, latest.path, latest.kind, latest.seq, latest.created_at as removed_at
    from (
      select distinct on (b.repo_id, b.path)
             b.repo_id, b.path, b.kind, b.seq, b.created_at, b.action
        from public.general_blobs b
       where b.project_id = p_project
       order by b.repo_id, b.path, b.seq desc
    ) latest
    join public.general_repos r on r.id = latest.repo_id
   where latest.action = 'removed'
     and public.is_general_member(p_project)
   order by latest.created_at desc;
$$;

revoke all on function public.archive_general_task(uuid, boolean) from public, anon;
revoke all on function public.archive_general_task_file(uuid, boolean) from public, anon;
revoke all on function public.list_archived_general_task_files(uuid) from public, anon;
revoke all on function public.list_removed_general_repo_paths(uuid) from public, anon;
grant execute on function public.archive_general_task(uuid, boolean) to authenticated;
grant execute on function public.archive_general_task_file(uuid, boolean) to authenticated;
grant execute on function public.list_archived_general_task_files(uuid) to authenticated;
grant execute on function public.list_removed_general_repo_paths(uuid) to authenticated;

commit;
