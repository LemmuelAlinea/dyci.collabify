-- Collabify — who sees an archived General project, and deleting one for good.
--
--   node scripts/db.mjs supabase/general-project-archive-rbac.sql
--
-- A space let everybody in it read every project in it, archived or not, so a
-- project one person put away turned up in everybody's Archive. An archived
-- project now follows the rule archived tasks and files already follow
-- (general_sees_archived): whoever archived it, while still on it, and the
-- project's Owners and Managers. Everybody else loses it entirely — the list,
-- the counts, the project page and everything inside it.
--
-- It is enforced in can_read_general_project, which every project-scoped
-- SELECT policy goes through, so no page has to remember to filter.
--
-- Owners can also delete an archived project. The row goes, and every table
-- hanging off it goes with it through its foreign key. Its uploaded files are
-- handed back to the caller to remove from Storage, which a policy here allows
-- only once no project claims them.
--
-- Run after supabase/general-archive-rbac.sql and supabase/general-spaces.sql.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.general_projects
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

commit;

begin;

-- ---------------------------------------------------------------- reading

/*
 * A direct project member, or anyone in the space that holds it — unless the
 * project is archived, when only its archiver and its leads read it.
 */
create or replace function public.can_read_general_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p.archived_at is not null then public.general_sees_archived(p.id, p.archived_by)
    else public.is_general_member(p.id) or public.is_general_space_member(p.space_id)
  end
    from public.general_projects p
   where p.id = p_project;
$$;

-- ---------------------------------------------------------------- archiving

create or replace function public.archive_general_project(p_project uuid, p_archived boolean)
returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_owner_op', 'on', true);
  update public.general_projects
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end
   where id = p_project
  returning * into p;
  perform set_config('collabify.general_owner_op', 'off', true);

  -- Archiving closes the door too; restoring leaves it closed.
  if p_archived then
    update public.general_join_codes set open = false, updated_at = now()
     where project_id = p_project;
  end if;

  return p;
end;
$$;

/**
 * Archiving changes only through the Owner's RPC, which raises a
 * transaction-local flag. Everything else on the row is `edit_project`, which
 * the update policy already checks. Who archived it rides with the same flag.
 */
create or replace function public.guard_general_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if current_setting('collabify.general_owner_op', true) is distinct from 'on'
     and (new.archived_at is distinct from old.archived_at
          or new.archived_by is distinct from old.archived_by) then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  if old.archived_at is not null and new.archived_at is not null then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- deleting

/** As general-repo.sql, except while delete_general_project removes its own project. */
create or replace function public.guard_general_commit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and current_setting('collabify.general_project_delete', true) = old.project_id::text then
    return old;
  end if;
  raise exception 'A commit cannot be changed or removed once it is made'
    using errcode = 'insufficient_privilege';
end;
$$;

/**
 * Deletes an archived project and everything in it, and answers the Storage
 * objects it leaves behind so the caller can remove them.
 *
 * Archived first on purpose: deleting is the second of two deliberate steps,
 * never the first thing somebody does to live work.
 */
create or replace function public.delete_general_project(p_project uuid)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  p     public.general_projects%rowtype;
  names text[];
begin
  select * into p from public.general_projects where id = p_project;
  if not found then
    raise exception 'That project is gone' using errcode = 'no_data_found';
  end if;
  if not public.general_viewer_active() or not public.is_general_owner(p_project) then
    raise exception 'Only an Owner deletes a project' using errcode = 'insufficient_privilege';
  end if;
  if p.archived_at is null then
    raise exception 'Archive the project first, then delete it from the Archive'
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(o.name), '{}') into names
    from storage.objects o
   where o.bucket_id = 'general-files'
     and o.name like p_project::text || '/%';

  -- The guards that freeze an archived project's contents would refuse the
  -- cascade, so the project is live again for the rest of this transaction —
  -- nobody else ever sees it that way. Tasks go first, while the caller is
  -- still a member, because their children's guard checks membership and the
  -- members row may otherwise cascade away before them.
  perform set_config('collabify.general_owner_op', 'on', true);
  update public.general_projects set archived_at = null, archived_by = null where id = p_project;
  perform set_config('collabify.general_owner_op', 'off', true);

  delete from public.general_tasks where project_id = p_project;

  -- Commits are frozen against everything but deleting their whole project.
  perform set_config('collabify.general_project_delete', p_project::text, true);
  delete from public.general_projects where id = p_project;
  perform set_config('collabify.general_project_delete', '', true);

  return names;
end;
$$;

revoke all on function public.can_read_general_project(uuid) from public, anon;
revoke all on function public.archive_general_project(uuid, boolean) from public, anon;
revoke all on function public.delete_general_project(uuid) from public, anon;
revoke all on function public.guard_general_project() from public, anon;
revoke all on function public.guard_general_commit() from public, anon;
grant execute on function public.can_read_general_project(uuid) to authenticated;
grant execute on function public.archive_general_project(uuid, boolean) to authenticated;
grant execute on function public.delete_general_project(uuid) to authenticated;

-- ---------------------------------------------------------------- storage

/*
 * Files whose project no longer exists. Only ever reachable after a delete, so
 * clearing them up cannot touch anybody's live work, and a cleanup that failed
 * halfway can simply be run again.
 */
drop policy if exists general_files_remove_orphans on storage.objects;
create policy general_files_remove_orphans on storage.objects
  for delete to authenticated using (
    bucket_id = 'general-files'
    and public.general_safe_uuid((storage.foldername(name))[1]) is not null
    and not exists (
      select 1 from public.general_projects gp
       where gp.id = public.general_safe_uuid((storage.foldername(name))[1])
    )
  );

commit;
