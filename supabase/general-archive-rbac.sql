-- Collabify — archive visibility for General projects.
--
--   node scripts/db.mjs supabase/general-archive-rbac.sql
--
-- An archived item is visible to whoever archived it, and to the project's
-- Owners and Managers. Redefines the archive functions from
-- general-project-archive.sql and general-drafts.sql; run after both.

begin;

create or replace function public.general_leads(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = auth.uid()
       and m.level in ('owner', 'manager')
  );
$$;

create or replace function public.general_sees_archived(p_project uuid, p_archived_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_archived_by = auth.uid() and public.is_general_member(p_project))
      or public.general_leads(p_project);
$$;

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
  from public.general_tasks t
 where t.archived_at is null
    or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

create or replace function public.archive_general_task(p_task uuid, p_archived boolean)
returns public.general_tasks
language plpgsql security definer set search_path = public as $$
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
  if not p_archived and t.archived_at is not null
     and not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or (t.created_by = auth.uid() and not public.general_task_held(t.id))
    or (not p_archived and t.archived_by = auth.uid())
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
language plpgsql security definer set search_path = public as $$
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
  if not p_archived and f.archived_at is not null
     and not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()
          or (not p_archived and f.archived_by = auth.uid())) then
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

create or replace function public.general_archive_guard(p_project uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.restore_archived_general_tasks(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  update public.general_tasks
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.delete_archived_general_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task and archived_at is not null;
  if not found then return; end if;
  perform public.general_archive_guard(t.project_id);
  if not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_tasks where id = p_task and archived_at is not null;
end;
$$;

create or replace function public.delete_archived_general_tasks(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  delete from public.general_tasks
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.restore_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  update public.general_task_files
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.delete_archived_general_task_file(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file and archived_at is not null;
  if not found then return; end if;
  perform public.general_archive_guard(f.project_id);
  if not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_task_files where id = p_file and archived_at is not null;
end;
$$;

create or replace function public.delete_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  delete from public.general_task_files
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.list_archived_general_task_files(p_project uuid)
returns table (
  id uuid, task_id uuid, project_id uuid, uploaded_by uuid, file_path text, file_name text,
  mime_type text, size_bytes bigint, created_at timestamptz, archived_at timestamptz,
  archived_by uuid, task_title text
)
language sql security definer set search_path = public as $$
  select f.id, f.task_id, f.project_id, f.uploaded_by, f.file_path, f.file_name, f.mime_type,
         f.size_bytes, f.created_at, f.archived_at, f.archived_by, t.title as task_title
    from public.general_task_files f
    join public.general_tasks t on t.id = f.task_id
   where f.project_id = p_project
     and f.archived_at is not null
     and public.general_sees_archived(p_project, f.archived_by)
   order by f.archived_at desc;
$$;

create or replace function public.list_removed_general_repo_paths(p_project uuid)
returns table (
  repo_id uuid, repo_name text, path text, kind public.general_file_kind,
  seq integer, removed_at timestamptz
)
language sql security definer set search_path = public as $$
  select latest.repo_id, r.name as repo_name, latest.path, latest.kind, latest.seq,
         latest.created_at as removed_at
    from (
      select distinct on (b.repo_id, b.path)
             b.repo_id, b.path, b.kind, b.seq, b.created_at, b.action, b.commit_id
        from public.general_blobs b
       where b.project_id = p_project
       order by b.repo_id, b.path, b.seq desc
    ) latest
    join public.general_repos r on r.id = latest.repo_id
    join public.general_commits c on c.id = latest.commit_id
   where latest.action = 'removed'
     and public.general_sees_archived(p_project, c.author_id)
   order by latest.created_at desc;
$$;

drop function if exists public.list_archived_general_draft_files(uuid);
create function public.list_archived_general_draft_files(p_repo uuid)
returns table (
  id uuid, draft_id uuid, project_id uuid, path text, action public.general_file_action,
  kind public.general_file_kind, content text, storage_path text, updated_at timestamptz,
  archived_at timestamptz, archived_by uuid, owner_id uuid
)
language sql security definer set search_path = public as $$
  select f.id, f.draft_id, f.project_id, f.path, f.action, f.kind, f.content, f.storage_path,
         f.updated_at, f.archived_at, f.archived_by, d.user_id
    from public.general_drafts d
    join public.general_draft_files f on f.draft_id = d.id
   where d.repo_id = p_repo
     and f.archived_at is not null
     and (d.user_id = auth.uid() or public.general_leads(d.project_id))
   order by f.archived_at desc, f.path;
$$;

drop function if exists public.delete_archived_general_draft_path(uuid, text);
create or replace function public.delete_archived_general_draft_path(
  p_repo uuid,
  p_path text,
  p_owner uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  v text := btrim(p_path);
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = coalesce(p_owner, auth.uid());
  if not found then return; end if;
  if d.user_id <> auth.uid() and not public.general_leads(d.project_id) then
    raise exception 'Only its owner, or an Owner or Manager, can delete this.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is not null
     and (path = v or path like v || '/%');
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

revoke all on function public.general_leads(uuid) from public, anon;
revoke all on function public.general_sees_archived(uuid, uuid) from public, anon;
revoke all on function public.general_archive_guard(uuid) from public, anon;
revoke all on function public.list_archived_general_draft_files(uuid) from public, anon;
revoke all on function public.delete_archived_general_draft_path(uuid, text, uuid) from public, anon;
grant execute on function public.general_leads(uuid) to authenticated;
grant execute on function public.general_sees_archived(uuid, uuid) to authenticated;
grant execute on function public.general_archive_guard(uuid) to authenticated;
grant execute on function public.list_archived_general_draft_files(uuid) to authenticated;
grant execute on function public.delete_archived_general_draft_path(uuid, text, uuid) to authenticated;

commit;
