-- Collabify — Trash, for files and folders.
--
--   node scripts/db.mjs supabase/trash.sql
--
-- Archive and Trash are two different ways to put a file away:
--
--   Archive  hides a file you may want again. It sits in the project's archive
--            for everyone who can see that archive, until somebody restores it.
--   Trash    disposes of it. It sits in the Trash page of whoever trashed it,
--            and is deleted for good 30 days later unless they restore it.
--
-- What can go in: the files and folders of your own draft, task files, and a
-- professor's syllabi and curricula (teaching_resources), which also gain an
-- archive of their own here.
--
-- A trashed row keeps archived_at set as well, so every listing, count, commit
-- and submit that already skips archived files skips trashed ones with no
-- change. trashed_at is what tells Trash from Archive, so the archive's own
-- functions are redefined below to leave trashed rows out. Clearing archived_at
-- by any route clears the trash columns with it (guard_trash_columns), so a row
-- is never in Trash and live at once.
--
-- Redefines, as supersets: guard_general_draft_file, archive_general_draft_path,
-- restore_archived_general_draft_files and delete_archived_general_draft_files
-- (general-drafts.sql); list_archived_general_draft_files,
-- delete_archived_general_draft_path, archive_general_task_file,
-- restore_archived_general_task_files, delete_archived_general_task_file,
-- delete_archived_general_task_files, list_archived_general_task_files and
-- archived_general_task_file_objects (general-archive-rbac.sql). Re-run this
-- file after either of those.
--
-- Runs after storage-sweep.sql, before anon-lockdown.sql. Idempotent.

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_draft_files
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles (id) on delete set null,
  -- The file or folder the person put in Trash, so a folder comes back whole.
  add column if not exists trash_root text;

alter table public.general_task_files
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'general_draft_files_trash_hidden') then
    alter table public.general_draft_files add constraint general_draft_files_trash_hidden
      check (trashed_at is null or (archived_at is not null and trash_root is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'general_task_files_trash_hidden') then
    alter table public.general_task_files add constraint general_task_files_trash_hidden
      check (trashed_at is null or archived_at is not null);
  end if;
end $$;

create index if not exists general_draft_files_trash_idx
  on public.general_draft_files (trashed_by, trashed_at) where trashed_at is not null;
create index if not exists general_task_files_trash_idx
  on public.general_task_files (trashed_by, trashed_at) where trashed_at is not null;

-- Syllabi and curricula. Archived ones leave the library and the class pickers;
-- a class already pointing at one keeps it.
alter table public.teaching_resources
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teaching_resources_trash_hidden') then
    alter table public.teaching_resources add constraint teaching_resources_trash_hidden
      check (trashed_at is null or archived_at is not null);
  end if;
end $$;

create index if not exists teaching_resources_trash_idx
  on public.teaching_resources (trashed_by, trashed_at) where trashed_at is not null;

commit;

begin;

-- ---------------------------------------------------------------- guards

/**
 * Trash columns move only through the functions below, and fall away the
 * moment a row is live again — saving over a trashed path in your draft brings
 * that path back, so it leaves Trash too.
 */
create or replace function public.guard_trash_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is null then
    new.trashed_at := null;
    new.trashed_by := null;
    if tg_table_name = 'general_draft_files' then
      new := jsonb_populate_record(new, jsonb_build_object('trash_root', null));
    end if;
    return new;
  end if;
  if auth.uid() is not null
     and coalesce(current_setting('collabify.trash_op', true), 'off') <> 'on'
     and (new.trashed_at is distinct from old.trashed_at
          or new.trashed_by is distinct from old.trashed_by) then
    raise exception 'Move files to Trash and back with the Trash buttons.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_draft_files_trash_guard on public.general_draft_files;
create trigger general_draft_files_trash_guard before update on public.general_draft_files
  for each row execute function public.guard_trash_columns();
drop trigger if exists general_task_files_trash_guard on public.general_task_files;
create trigger general_task_files_trash_guard before update on public.general_task_files
  for each row execute function public.guard_trash_columns();
drop trigger if exists teaching_resources_trash_guard on public.teaching_resources;
create trigger teaching_resources_trash_guard before update on public.teaching_resources
  for each row execute function public.guard_trash_columns();

/**
 * As general-drafts.sql, plus one exception: emptying Trash after 30 days runs
 * with nobody signed in, which the active-account check would refuse. Only
 * purge_trash sets the flag, and nobody can set it from the app.
 */
create or replace function public.guard_general_draft_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('collabify.trash_purge', true), 'off') = 'on' then
    return old;
  end if;
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to work on files'
      using errcode = 'insufficient_privilege';
  end if;
  -- An uploaded object must sit under this project's own folder, the same rule
  -- a commit follows.
  if tg_op <> 'DELETE' and new.kind = 'binary'
     and new.storage_path !~ ('^' || new.project_id::text || '/files/') then
    raise exception 'That file was not uploaded to this project'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_trash_columns() from public, anon;
revoke all on function public.guard_general_draft_file() from public, anon;

commit;

begin;

-- ---------------------------------------------------------------- the archive, without Trash

create or replace function public.archive_general_draft_path(
  p_repo uuid,
  p_path text,
  p_archived boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  v text := btrim(p_path);
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    return;
  end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_draft_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end,
         updated_at = now()
   where draft_id = d.id
     and trashed_at is null
     and (path = v or left(path, char_length(v) + 1) = v || '/');

  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

create or replace function public.restore_archived_general_draft_files(p_repo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then return; end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_draft_files
     set archived_at = null, archived_by = null, updated_at = now()
   where draft_id = d.id and archived_at is not null and trashed_at is null;
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

create or replace function public.delete_archived_general_draft_files(p_repo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then return; end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  delete from public.general_draft_files
   where draft_id = d.id and archived_at is not null and trashed_at is null;
  update public.general_drafts set updated_at = now() where id = d.id;
end;
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
     and f.trashed_at is null
     and (d.user_id = auth.uid() or public.general_leads(d.project_id))
   order by f.archived_at desc, f.path;
$$;

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
     and trashed_at is null
     and (path = v or left(path, char_length(v) + 1) = v || '/');
  update public.general_drafts set updated_at = now() where id = d.id;
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
  if f.trashed_at is not null then
    raise exception 'This file is in Trash. Restore it from Trash first.'
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

create or replace function public.restore_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null and trashed_at is null
     and public.general_sees_archived(project_id, archived_by);
  perform set_config('collabify.general_archive_op', 'off', true);
end;
$$;

create or replace function public.delete_archived_general_task_file(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files
   where id = p_file and archived_at is not null and trashed_at is null;
  if not found then return; end if;
  perform public.general_archive_guard(f.project_id);
  if not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.'
      using errcode = 'insufficient_privilege';
  end if;
  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files where id = p_file and archived_at is not null and trashed_at is null;
  perform set_config('collabify.general_archive_op', 'off', true);
end;
$$;

create or replace function public.delete_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files
   where project_id = p_project and archived_at is not null and trashed_at is null
     and public.general_sees_archived(project_id, archived_by);
  perform set_config('collabify.general_archive_op', 'off', true);
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
     and f.trashed_at is null
     and public.general_sees_archived(p_project, f.archived_by)
     and not public.general_task_hidden(f.task_id)
   order by f.archived_at desc;
$$;

create or replace function public.archived_general_task_file_objects(p_files uuid[])
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.file_path order by f.file_path), '{}')
    from public.general_task_files f
   where f.id = any(p_files)
     and f.archived_at is not null
     and f.trashed_at is null
     and public.general_sees_archived(f.project_id, f.archived_by)
     and not public.general_task_hidden(f.task_id)
     and exists (select 1 from storage.objects o
                  where o.bucket_id = 'general-files' and o.name = f.file_path);
$$;

commit;

begin;

-- ---------------------------------------------------------------- into Trash

/** Puts a file or folder of your own draft in Trash. Answers how many files went. */
create or replace function public.trash_general_draft_path(p_repo uuid, p_path text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  v text := btrim(p_path);
  n int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    return 0;
  end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  perform set_config('collabify.trash_op', 'on', true);
  update public.general_draft_files
     set archived_at = now(), archived_by = auth.uid(),
         trashed_at = now(), trashed_by = auth.uid(), trash_root = v,
         updated_at = now()
   where draft_id = d.id
     and archived_at is null
     and (path = v or left(path, char_length(v) + 1) = v || '/');
  get diagnostics n = row_count;
  perform set_config('collabify.trash_op', 'off', true);

  update public.general_drafts set updated_at = now() where id = d.id;
  return n;
end;
$$;

/** Puts a task file in Trash, for whoever added it or somebody who can edit files. */
create or replace function public.trash_general_task_file(p_file uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file for update;
  if not found then
    raise exception 'That file is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_archive_guard(f.project_id);
  if f.trashed_at is not null then
    return;
  end if;
  if public.general_task_hidden(f.task_id)
     or (f.archived_at is not null and not public.general_sees_archived(f.project_id, f.archived_by)) then
    raise exception 'That file is gone' using errcode = 'no_data_found';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()) then
    raise exception 'Only whoever added this file, or somebody who can edit files, can put it in Trash.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  perform set_config('collabify.trash_op', 'on', true);
  update public.general_task_files
     set archived_at = now(), archived_by = auth.uid(),
         trashed_at = now(), trashed_by = auth.uid()
   where id = p_file;
  perform set_config('collabify.trash_op', 'off', true);
  perform set_config('collabify.general_archive_op', 'off', true);
end;
$$;

/** A syllabus or curriculum into, or back out of, its owner's archive. */
create or replace function public.archive_teaching_resource(p_resource uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.teaching_resources%rowtype;
begin
  select * into r from public.teaching_resources where id = p_resource for update;
  if not found or r.professor_id <> auth.uid() or not public.general_viewer_active() then
    raise exception 'Only whoever uploaded this can archive it.' using errcode = 'insufficient_privilege';
  end if;
  if r.trashed_at is not null then
    raise exception 'This file is in Trash. Restore it from Trash first.' using errcode = 'check_violation';
  end if;
  update public.teaching_resources
     set archived_at = case when p_archived then coalesce(archived_at, now()) end
   where id = p_resource;
end;
$$;

/** A syllabus or curriculum into Trash, from the library or from its archive. */
create or replace function public.trash_teaching_resource(p_resource uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.teaching_resources%rowtype;
begin
  select * into r from public.teaching_resources where id = p_resource for update;
  if not found or r.professor_id <> auth.uid() or not public.general_viewer_active() then
    raise exception 'Only whoever uploaded this can put it in Trash.' using errcode = 'insufficient_privilege';
  end if;
  if r.trashed_at is not null then
    return;
  end if;
  perform set_config('collabify.trash_op', 'on', true);
  update public.teaching_resources
     set archived_at = coalesce(archived_at, now()), trashed_at = now(), trashed_by = auth.uid()
   where id = p_resource;
  perform set_config('collabify.trash_op', 'off', true);
end;
$$;

-- ---------------------------------------------------------------- the Trash page

/**
 * What the caller put in Trash, newest first. A folder is one row, however
 * many files it held. `frozen` means the project is archived or its board is
 * handed in, so nothing can come back until that changes.
 */
drop function if exists public.list_my_trash();
create function public.list_my_trash()
returns table (
  kind text,
  id uuid,
  repo_id uuid,
  root text,
  name text,
  is_folder boolean,
  file_count int,
  size_bytes bigint,
  trashed_at timestamptz,
  purge_at timestamptz,
  project_id uuid,
  project_name text,
  class_project_id uuid,
  task_title text,
  frozen boolean,
  resource_kind text
)
language sql stable security definer set search_path = public as $$
  with drafts as (
    select d.repo_id, d.project_id, f.trash_root,
           max(f.trashed_at) as trashed_at,
           bool_or(f.path <> f.trash_root) as is_folder,
           count(*) filter (where f.path !~ '(^|/)\.keep$')::int as file_count,
           sum(case when f.kind = 'binary'
                    then coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                    where o.bucket_id = 'general-files' and o.name = f.storage_path), 0)
                    else octet_length(f.content) end)::bigint as size_bytes
      from public.general_drafts d
      join public.general_draft_files f on f.draft_id = d.id
     where d.user_id = auth.uid()
       and f.trashed_at is not null
     group by d.repo_id, d.project_id, f.trash_root
  ),
  rows as (
    select 'draft'::text as kind, null::uuid as id, x.repo_id, x.trash_root as root,
           regexp_replace(x.trash_root, '^.*/', '') as name,
           x.is_folder, x.file_count, x.size_bytes, x.trashed_at, x.project_id,
           null::text as task_title, null::text as resource_kind
      from drafts x
    union all
    select 'task_file', f.id, null, null, f.file_name, false, 1, f.size_bytes, f.trashed_at,
           f.project_id, t.title, null
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
     where f.trashed_by = auth.uid()
       and f.trashed_at is not null
       and public.is_general_member(f.project_id)
    union all
    select 'resource', tr.id, null, null, tr.title, false, 1, tr.size_bytes, tr.trashed_at,
           null, null, tr.kind::text
      from public.teaching_resources tr
     where tr.professor_id = auth.uid()
       and tr.trashed_at is not null
  )
  select r.kind, r.id, r.repo_id, r.root, r.name, r.is_folder, r.file_count, r.size_bytes,
         r.trashed_at, r.trashed_at + interval '30 days',
         r.project_id,
         case r.resource_kind when 'syllabus' then 'Syllabi' when 'curriculum' then 'Curriculum'
              else coalesce(cp.title, gp.name) end,
         b.project_id,
         r.task_title,
         coalesce(gp.archived_at is not null or public.class_board_frozen(gp.class_board_id), false),
         r.resource_kind
    from rows r
    left join public.general_projects gp on gp.id = r.project_id
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.projects cp on cp.id = b.project_id
   order by r.trashed_at desc, r.name;
$$;

/** Brings a trashed file or folder back into your draft, where it was. */
create or replace function public.restore_trashed_draft_path(p_repo uuid, p_root text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then return; end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  update public.general_draft_files
     set archived_at = null, archived_by = null, updated_at = now()
   where draft_id = d.id and trashed_at is not null and trash_root = p_root;
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

create or replace function public.delete_trashed_draft_path(p_repo uuid, p_root text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then return; end if;
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  delete from public.general_draft_files
   where draft_id = d.id and trashed_at is not null and trash_root = p_root;
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

/** The task file back on its task. Only whoever trashed it, while still on the project. */
create or replace function public.restore_trashed_task_file(p_file uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files
   where id = p_file and trashed_at is not null and trashed_by = auth.uid()
   for update;
  if not found then return; end if;
  perform public.general_archive_guard(f.project_id);
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files set archived_at = null, archived_by = null where id = p_file;
  perform set_config('collabify.general_archive_op', 'off', true);
end;
$$;

create or replace function public.delete_trashed_task_file(p_file uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files
   where id = p_file and trashed_at is not null and trashed_by = auth.uid();
  if not found then return; end if;
  perform public.general_archive_guard(f.project_id);
  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files where id = p_file;
  perform set_config('collabify.general_archive_op', 'off', true);
end;
$$;

/** A syllabus or curriculum back in the library, where it was. */
create or replace function public.restore_trashed_resource(p_resource uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to restore this' using errcode = 'insufficient_privilege';
  end if;
  update public.teaching_resources set archived_at = null
   where id = p_resource and professor_id = auth.uid() and trashed_at is not null;
end;
$$;

/** For good. A class pointing at it loses the link; its week map goes with it. */
create or replace function public.delete_trashed_resource(p_resource uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to delete this' using errcode = 'insufficient_privilege';
  end if;
  delete from public.teaching_resources
   where id = p_resource and professor_id = auth.uid() and trashed_at is not null;
end;
$$;

/** Deletes everything the caller can still act on. Answers how many files went. */
create or replace function public.empty_my_trash()
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
  m int;
  k int;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to empty Trash'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_draft_files f
   using public.general_drafts d
   where d.id = f.draft_id and d.user_id = auth.uid()
     and f.trashed_at is not null
     and not public.general_is_archived(d.project_id);
  get diagnostics n = row_count;

  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files f
   where f.trashed_by = auth.uid() and f.trashed_at is not null
     and public.is_general_member(f.project_id)
     and not public.general_is_archived(f.project_id);
  get diagnostics m = row_count;
  perform set_config('collabify.general_archive_op', 'off', true);

  delete from public.teaching_resources where professor_id = auth.uid() and trashed_at is not null;
  get diagnostics k = row_count;
  return n + m + k;
end;
$$;

-- ---------------------------------------------------------------- 30 days on

/** Deletes whatever has sat in Trash for 30 days. The storage sweep takes the bytes. */
create or replace function public.purge_trash()
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
  m int;
  k int;
begin
  perform set_config('collabify.trash_purge', 'on', true);
  delete from public.general_draft_files where trashed_at < now() - interval '30 days';
  get diagnostics n = row_count;
  perform set_config('collabify.trash_purge', 'off', true);

  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files where trashed_at < now() - interval '30 days';
  get diagnostics m = row_count;
  perform set_config('collabify.general_archive_op', 'off', true);

  delete from public.teaching_resources where trashed_at < now() - interval '30 days';
  get diagnostics k = row_count;
  return n + m + k;
end;
$$;

revoke all on function public.trash_general_draft_path(uuid, text) from public, anon;
revoke all on function public.trash_general_task_file(uuid) from public, anon;
revoke all on function public.list_my_trash() from public, anon;
revoke all on function public.restore_trashed_draft_path(uuid, text) from public, anon;
revoke all on function public.delete_trashed_draft_path(uuid, text) from public, anon;
revoke all on function public.restore_trashed_task_file(uuid) from public, anon;
revoke all on function public.delete_trashed_task_file(uuid) from public, anon;
revoke all on function public.empty_my_trash() from public, anon;
revoke all on function public.archive_teaching_resource(uuid, boolean) from public, anon;
revoke all on function public.trash_teaching_resource(uuid) from public, anon;
revoke all on function public.restore_trashed_resource(uuid) from public, anon;
revoke all on function public.delete_trashed_resource(uuid) from public, anon;
revoke all on function public.purge_trash() from public, anon, authenticated;
grant execute on function public.trash_general_draft_path(uuid, text) to authenticated;
grant execute on function public.trash_general_task_file(uuid) to authenticated;
grant execute on function public.list_my_trash() to authenticated;
grant execute on function public.restore_trashed_draft_path(uuid, text) to authenticated;
grant execute on function public.delete_trashed_draft_path(uuid, text) to authenticated;
grant execute on function public.restore_trashed_task_file(uuid) to authenticated;
grant execute on function public.delete_trashed_task_file(uuid) to authenticated;
grant execute on function public.empty_my_trash() to authenticated;
grant execute on function public.archive_teaching_resource(uuid, boolean) to authenticated;
grant execute on function public.trash_teaching_resource(uuid) to authenticated;
grant execute on function public.restore_trashed_resource(uuid) to authenticated;
grant execute on function public.delete_trashed_resource(uuid) to authenticated;

-- Once a day. Rescheduled by name, so re-running this file is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'collabify-trash-purge') then
    perform cron.unschedule('collabify-trash-purge');
  end if;
  perform cron.schedule('collabify-trash-purge', '30 18 * * *', 'select public.purge_trash()');
end;
$$;

commit;

begin;

-- ---------------------------------------------------------------- work reports

-- general-reports.sql's check, now leaving Trash out. A trashed file keeps
-- archived_at, so without this the activity feed logged the trashing as
-- "archived" and the counts kept it when archived work was asked for. Trash
-- is on its way to deletion, and a report treats it as already gone.
create or replace function public.general_report_file_ok(
  f public.general_task_files, p_include_archived boolean
) returns boolean language sql stable set search_path = public as $$
  select f.trashed_at is null
     and (f.archived_at is null or coalesce(p_include_archived, false));
$$;

commit;
