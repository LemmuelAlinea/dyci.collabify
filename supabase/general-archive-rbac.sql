-- Collabify — archive visibility for General projects.
--
--   node scripts/db.mjs supabase/general-archive-rbac.sql
--
-- An archived item is visible to whoever archived it, and to the project's
-- Owners and Managers. No other file defines the functions here; runs after
-- general-project-archive.sql and general-drafts.sql, which own the columns.
-- Also redefines policies and the task guard from general-tasks.sql,
-- general-schedule-guard.sql and general-spaces.sql, and the task notifications
-- from general-notify.sql, so it must run after those too.

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
    raise exception '%', case when p_archived
        then 'Only its creator, before anyone takes it, or someone who manages tasks can archive this.'
        else 'Only its creator, before anyone takes it, or someone who manages tasks can restore this.' end
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  perform set_config('collabify.general_archive_op', 'off', true);
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

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_file
   returning * into f;
  perform set_config('collabify.general_archive_op', 'off', true);
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
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
  perform set_config('collabify.general_archive_op', 'off', true);
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
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
  perform set_config('collabify.general_archive_op', 'off', true);
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
     and not public.general_task_hidden(f.task_id)
   order by f.archived_at desc;
$$;

-- Storage's remove() skips a missing object and a refused one alike, so the app
-- asks which of the archived files it just removed still have an object.
create or replace function public.archived_general_task_file_objects(p_files uuid[])
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.file_path order by f.file_path), '{}')
    from public.general_task_files f
   where f.id = any(p_files)
     and f.archived_at is not null
     and public.general_sees_archived(f.project_id, f.archived_by)
     and not public.general_task_hidden(f.task_id)
     and exists (select 1 from storage.objects o
                  where o.bucket_id = 'general-files' and o.name = f.file_path);
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
  select f.id, f.draft_id, f.project_id, f.path, f.action, f.kind,
         case when d.user_id = auth.uid() then f.content else '' end,
         case when d.user_id = auth.uid() then f.storage_path end,
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
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is not null
     and (path = v or left(path, char_length(v) + 1) = v || '/');
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

revoke all on function public.general_leads(uuid) from public, anon;
revoke all on function public.general_sees_archived(uuid, uuid) from public, anon;
revoke all on function public.general_archive_guard(uuid) from public, anon;
revoke all on function public.list_archived_general_draft_files(uuid) from public, anon;
revoke all on function public.delete_archived_general_draft_path(uuid, text, uuid) from public, anon;
revoke all on function public.archive_general_task(uuid, boolean) from public, anon;
revoke all on function public.archive_general_task_file(uuid, boolean) from public, anon;
revoke all on function public.restore_archived_general_tasks(uuid) from public, anon;
revoke all on function public.delete_archived_general_task(uuid) from public, anon;
revoke all on function public.delete_archived_general_tasks(uuid) from public, anon;
revoke all on function public.restore_archived_general_task_files(uuid) from public, anon;
revoke all on function public.delete_archived_general_task_file(uuid) from public, anon;
revoke all on function public.delete_archived_general_task_files(uuid) from public, anon;
revoke all on function public.list_archived_general_task_files(uuid) from public, anon;
revoke all on function public.list_removed_general_repo_paths(uuid) from public, anon;
revoke all on function public.archived_general_task_file_objects(uuid[]) from public, anon;
grant execute on function public.general_leads(uuid) to authenticated;
grant execute on function public.general_sees_archived(uuid, uuid) to authenticated;
grant execute on function public.general_archive_guard(uuid) to authenticated;
grant execute on function public.list_archived_general_draft_files(uuid) to authenticated;
grant execute on function public.delete_archived_general_draft_path(uuid, text, uuid) to authenticated;
grant execute on function public.archive_general_task(uuid, boolean) to authenticated;
grant execute on function public.archive_general_task_file(uuid, boolean) to authenticated;
grant execute on function public.restore_archived_general_tasks(uuid) to authenticated;
grant execute on function public.delete_archived_general_task(uuid) to authenticated;
grant execute on function public.delete_archived_general_tasks(uuid) to authenticated;
grant execute on function public.restore_archived_general_task_files(uuid) to authenticated;
grant execute on function public.delete_archived_general_task_file(uuid) to authenticated;
grant execute on function public.delete_archived_general_task_files(uuid) to authenticated;
grant execute on function public.list_archived_general_task_files(uuid) to authenticated;
grant execute on function public.list_removed_general_repo_paths(uuid) to authenticated;
grant execute on function public.archived_general_task_file_objects(uuid[]) to authenticated;

commit;

-- ---------------------------------------------------------------- the tables themselves

begin;

drop policy if exists general_tasks_select on public.general_tasks;
create policy general_tasks_select on public.general_tasks
  for select using (
    public.can_read_general_project(project_id)
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
  );

drop policy if exists general_tasks_delete on public.general_tasks;
create policy general_tasks_delete on public.general_tasks
  for delete using (
    (public.general_can(project_id, 'manage_tasks')
     or (created_by = auth.uid()
         and public.is_general_member(project_id)
         and not public.general_task_held(id)
         and not public.general_is_archived(project_id)))
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
  );

create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if not public.is_general_member(v_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    raise exception 'Archive and restore through the archive buttons.'
      using errcode = 'insufficient_privilege';
  end if;

  if public.general_is_archived(old.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- A team delete still cascades team_id to null on an archived task.
  if old.archived_at is not null
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on'
     and not (
       new.team_id is null
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.status is not distinct from old.status
       and new.due_at is not distinct from old.due_at
       and new.starts_at is not distinct from old.starts_at
       and new.weight is not distinct from old.weight
     ) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
  end if;

  if not public.general_can(old.project_id, 'manage_tasks') then
    if not (
      public.is_general_task_assignee(old.id)
      or (old.created_by = auth.uid() and not public.general_task_held(old.id))
      or (
        -- A team delete cascades into an UPDATE (team_id set null) that runs
        -- under the deleting caller's own auth.uid(), even though referential
        -- actions bypass RLS — BEFORE triggers still fire. Someone who
        -- manages structure but not tasks still needs that cascade to reach
        -- this row, as long as nothing besides team_id actually changed.
        new.team_id is null
        and new.title is not distinct from old.title
        and new.description is not distinct from old.description
        and new.status is not distinct from old.status
        and new.due_at is not distinct from old.due_at
        and new.starts_at is not distinct from old.starts_at
        and new.weight is not distinct from old.weight
        and public.general_can(old.project_id, 'manage_structure')
      )
    ) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

create or replace function public.guard_general_task_file_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    raise exception 'Archive and restore through the archive buttons.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_task_files_archive_guard on public.general_task_files;
create trigger general_task_files_archive_guard before update on public.general_task_files
  for each row execute function public.guard_general_task_file_archive();

commit;

-- ---------------------------------------------------------------- storage and task activity

begin;

create or replace function public.general_task_hidden(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t
     where t.id = p_task and t.archived_at is not null
       and not public.general_sees_archived(t.project_id, t.archived_by)
  );
$$;

create or replace function public.general_task_file_hidden(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_task_files f
     where f.file_path = p_path
       and ((f.archived_at is not null
             and not public.general_sees_archived(f.project_id, f.archived_by))
            or public.general_task_hidden(f.task_id))
  );
$$;

revoke all on function public.general_task_hidden(uuid) from public, anon;
revoke all on function public.general_task_file_hidden(text) from public, anon;
grant execute on function public.general_task_hidden(uuid) to authenticated;
grant execute on function public.general_task_file_hidden(text) to authenticated;

drop policy if exists general_task_files_select on public.general_task_files;
create policy general_task_files_select on public.general_task_files
  for select using (
    public.can_read_general_project(project_id)
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
    and not public.general_task_hidden(task_id)
  );

drop policy if exists general_task_files_delete on public.general_task_files;
create policy general_task_files_delete on public.general_task_files
  for delete using (
    ((uploaded_by = auth.uid() and public.is_general_member(project_id))
     or public.general_can(project_id, 'edit_files'))
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
    and not public.general_task_hidden(task_id)
  );

do $$
declare
  t text;
begin
  foreach t in array array[
    'general_task_assignees', 'general_task_comments', 'general_task_logs', 'general_task_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.can_read_general_project(project_id) and not public.general_task_hidden(task_id))',
      t || '_select', t);
  end loop;
end $$;

drop policy if exists general_files_read on storage.objects;
create policy general_files_read on storage.objects
  for select using (
    bucket_id = 'general-files'
    and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
    and not public.general_task_file_hidden(name)
  );

drop policy if exists general_files_remove on storage.objects;
create policy general_files_remove on storage.objects
  for delete using (
    bucket_id = 'general-files'
    and (
      (exists (select 1 from public.general_task_files f
                where f.file_path = name and f.uploaded_by = auth.uid())
       and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1])))
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
    and not public.general_task_file_hidden(name)
  );

commit;

-- ---------------------------------------------------------------- notifications

begin;

-- Whether p_user, not the caller, may see the task: notifications go to other people.
create or replace function public.general_user_sees_task(p_task uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t
     where t.id = p_task
       and (t.archived_at is null
            or exists (select 1 from public.general_members m
                        where m.project_id = t.project_id and m.user_id = p_user
                          and (m.user_id = t.archived_by or m.level in ('owner', 'manager'))))
  );
$$;

revoke all on function public.general_user_sees_task(uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_general_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Claiming a task yourself is not news to you.
  if new.assigned_by is null or new.assigned_by = new.user_id then
    return new;
  end if;
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select new.user_id,
         'general_task_assigned'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         p.name
    from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = new.user_id
   where t.id = new.task_id and np.task_assignments
     and public.general_user_sees_task(t.id, new.user_id);
  return new;
end;
$$;

/** Reaches whoever holds the task now, plus whoever has commented on it
    before, while they are still on the project and may see the task.
    Comment rows outlive membership, so the join to general_members filters a
    departed commenter back out rather than letting a stale row notify them. */
create or replace function public.notify_general_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select r.user_id,
         'general_comment_posted'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         left(new.body, 140)
    from (
      select a.user_id from public.general_task_assignees a where a.task_id = new.task_id
      union
      select c.author_id from public.general_task_comments c
       where c.task_id = new.task_id and c.author_id is not null and c.id <> new.id
    ) r
    join public.general_tasks t on t.id = new.task_id
    join public.general_members gm on gm.project_id = t.project_id and gm.user_id = r.user_id
    join public.notification_prefs np on np.user_id = r.user_id
   where r.user_id is distinct from new.author_id
     and np.comments_mentions
     and public.general_user_sees_task(t.id, r.user_id);
  return new;
end;
$$;

/** One nudge per task per person, the day before, on a live project. */
create or replace function public.send_general_deadline_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select a.user_id,
         'general_deadline_soon'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         'Due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
    from public.general_tasks t
    join public.general_task_assignees a on a.task_id = t.id
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = a.user_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.due_at > now()
     and t.due_at <= now() + interval '24 hours'
     and p.archived_at is null
     and np.deadline_reminders
     and public.general_user_sees_task(t.id, a.user_id)
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.user_id
          and n.general_task_id = t.id
          and n.type = 'general_deadline_soon'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke execute on function public.send_general_deadline_reminders() from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------- archived tasks are read-only

begin;

create or replace function public.general_task_archived(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.general_tasks where id = p_task and archived_at is not null);
$$;

revoke all on function public.general_task_archived(uuid) from public, anon;
grant execute on function public.general_task_archived(uuid) to authenticated;

/** Holders, comments, logs and files of an archived task change only through the archive RPCs. */
create or replace function public.guard_general_archived_task_child()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.general_archive_op', true), 'off') = 'on' then
    return new;
  end if;
  if public.general_task_archived(new.task_id) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_archived_task_child() from public, anon;

do $$
declare
  t text;
begin
  foreach t in array array[
    'general_task_assignees', 'general_task_comments', 'general_task_logs', 'general_task_files'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archived_task_guard', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.guard_general_archived_task_child()',
      t || '_archived_task_guard', t);
  end loop;
end $$;

drop policy if exists general_files_write on storage.objects;
create policy general_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and public.general_task_project(public.general_safe_uuid((storage.foldername(name))[2]))
        = public.general_safe_uuid((storage.foldername(name))[1])
    and not public.general_task_archived(public.general_safe_uuid((storage.foldername(name))[2]))
    and (
      (public.is_general_task_assignee(public.general_safe_uuid((storage.foldername(name))[2]))
       and public.is_general_member(public.general_safe_uuid((storage.foldername(name))[1]))
       and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1])))
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
  );

commit;
