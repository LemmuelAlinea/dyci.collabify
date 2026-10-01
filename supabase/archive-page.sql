-- Collabify — the Archive page, and Trash for everything it holds.
--
--   node scripts/db.mjs supabase/archive-page.sql
--
-- The Archive page lists, in one place, everything the reader archived or may
-- act on in an archive: classes, groups, class projects, class tasks, class
-- project files, syllabi and curricula on the class side; spaces, space teams,
-- work projects, work tasks and work files on the work side. Which sections a
-- person sees is decided by the screen from what they can do (src/lib/archive.ts);
-- which rows come back, and whether each may be restored or moved to Trash, is
-- decided here.
--
-- Until now only files, folders, syllabi, curricula and discussions could go to
-- Trash. This file gives the rest the same 30 days: classes, groups, class
-- projects, class tasks, spaces, space teams, work projects and work tasks.
-- Each is moved to Trash from its archive, never from live:
--
--   Archive  -> Trash      trash_archived_item, by whoever may delete it for good
--   Trash    -> Archive    restore_trashed_item, by whoever put it in Trash
--   Trash    -> gone       delete_trashed_item, the same person, or purge_trash
--                          after 30 days (as that person, so the same rules hold)
--
-- A trashed row keeps archived_at, so every listing, count, notice and report
-- that already leaves archived work out leaves trashed work out with no change.
-- Restrictive read policies below also hide a trashed row from everyone, so the
-- per-place archives (a space's archived projects, a project's archived tasks,
-- Archived classes) stop showing it; Trash reads it through its own functions.
-- Restoring an archived row by any route clears its trash columns
-- (guard_trash_columns), so nothing is ever live and in Trash at once.
--
-- Redefines, as supersets: guard_trash_columns, list_my_trash, empty_my_trash and
-- purge_trash (trash.sql); guard_general_project (general-project-archive-rbac.sql);
-- guard_group_delete (groups.sql);
-- list_my_archived_class_tasks (task-archive.sql); list_general_space_teams
-- (general-space-teams.sql). Re-run this file after any of those, then
-- anon-lockdown.sql. Its restrictive `<table>_not_trashed` read policies stand
-- beside whatever other policies those tables have, so re-running theirs is safe.
--
-- Runs after trash.sql and task-archive.sql, before anon-lockdown.sql. Idempotent.

begin;

-- ---------------------------------------------------------------- columns

do $$
declare
  t text;
begin
  foreach t in array array['classes', 'groups', 'projects', 'project_tasks', 'general_spaces',
                           'general_space_teams', 'general_projects', 'general_tasks'] loop
    execute format('alter table public.%I add column if not exists trashed_at timestamptz', t);
    execute format('alter table public.%I add column if not exists trashed_by uuid
                      references public.profiles (id) on delete set null', t);
    if not exists (select 1 from pg_constraint where conname = t || '_trash_hidden') then
      execute format('alter table public.%I add constraint %I
                        check (trashed_at is null or archived_at is not null)', t, t || '_trash_hidden');
    end if;
    execute format('create index if not exists %I on public.%I (trashed_by, trashed_at)
                      where trashed_at is not null', t || '_trash_idx', t);
  end loop;
end $$;

commit;

begin;

-- ---------------------------------------------------------------- guards

/**
 * trash.sql's guard, plus one exception. trashed_by is `on delete set null`,
 * so deleting an account nulls it wherever that person trashed something — an
 * update this guard would refuse as a direct write, and with it the account
 * delete. The referential action is the only thing that nulls the column while
 * the person no longer exists, which is how it is told apart. purge_trash then
 * returns such a row to Archive.
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
    if new.trashed_at is not distinct from old.trashed_at
       and new.trashed_by is null and old.trashed_by is not null
       and not exists (select 1 from public.profiles p where p.id = old.trashed_by) then
      return new;
    end if;
    raise exception 'Move things to Trash and back with the Trash buttons.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['classes', 'groups', 'projects', 'project_tasks', 'general_spaces',
                           'general_space_teams', 'general_projects', 'general_tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_trash_guard', t);
    execute format('create trigger %I before update on public.%I
                      for each row execute function public.guard_trash_columns()', t || '_trash_guard', t);
  end loop;
end $$;

/**
 * As live (general-project-archive-rbac.sql), plus: while a Trash function holds
 * `collabify.trash_op`, an archived project may change its trash columns and
 * nothing else. Everything else about an archived project stays frozen.
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

  if coalesce(current_setting('collabify.trash_op', true), 'off') = 'on'
     and new.archived_at is not distinct from old.archived_at
     and new.archived_by is not distinct from old.archived_by then
    return new;
  end if;

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

/**
 * As groups.sql, plus one exception: deleting a whole class from Trash. A
 * group's work goes with its class there, which is what the person asked for
 * and was warned about; the guard is for a group deleted on its own. Only
 * delete_trashed_item sets the flag, and nobody can set it from the app.
 */
create or replace function public.guard_group_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  held text;
begin
  if coalesce(current_setting('collabify.class_delete', true), '') = 'on' then
    return old;
  end if;
  held := public.group_work_summary(old.id);
  if held is not null then
    raise exception
      '% has % on it. Archive it instead — deleting would take that with it.',
      old.name, held
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_trash_columns() from public, anon;
revoke all on function public.guard_group_delete() from public, anon;
revoke all on function public.guard_general_project() from public, anon;

-- ---------------------------------------------------------------- reading

-- What sits in somebody's Trash is out of every list, page and count, theirs
-- included. Restrictive, so it holds whatever permissive policies a table has
-- (groups_write and projects_write are FOR ALL, so they grant reads too). Trash
-- reads trashed rows through its own functions.
do $$
declare
  t text;
begin
  foreach t in array array['classes', 'groups', 'projects', 'general_spaces',
                           'general_space_teams', 'general_projects', 'general_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_not_trashed', t);
    execute format('create policy %I on public.%I as restrictive for select using (trashed_at is null)',
                   t || '_not_trashed', t);
  end loop;
end $$;

/** As live, leaving trashed teams out of a space's archive. */
create or replace function public.list_general_space_teams(p_space uuid, p_archived boolean)
returns table (
  id uuid, space_id uuid, name text, description text, created_by uuid,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz,
  my_level public.general_level, member_count int, project_count int
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select t.id, t.space_id, t.name, t.description, t.created_by, t.created_at, t.updated_at,
           t.archived_at,
           mine.level as my_level,
           (select count(*) from public.general_space_team_members m where m.team_id = t.id)::int,
           (select count(distinct gt.project_id) from public.general_teams gt where gt.space_team_id = t.id)::int
      from public.general_space_teams t
      join public.general_space_team_members mine
        on mine.team_id = t.id and mine.user_id = auth.uid()
     where t.space_id = p_space
       and t.trashed_at is null
       and ((p_archived and t.archived_at is not null)
            or (not p_archived and t.archived_at is null))
     order by t.name;
end;
$$;

/** As task-archive.sql, leaving trashed tasks out of My tasks → Archived tasks. */
create or replace function public.list_my_archived_class_tasks()
returns table (
  id uuid, title text, status public.task_status, archived_at timestamptz,
  project_id uuid, project_title text, class_initial text, class_name text, group_name text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.status, t.archived_at, p.id, p.title, c.initial, c.name, g.name
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.classes c on c.id = p.class_id
    left join public.groups g on g.id = b.group_id
   where t.archived_at is not null
     and t.trashed_at is null
     and t.archived_by = auth.uid()
     and public.is_board_member(t.board_id)
     and p.archived_at is null
   order by t.archived_at desc;
$$;

commit;

begin;

-- ---------------------------------------------------------------- who may

/**
 * Why the caller may not move this archived item to Trash — or, with
 * p_in_trash, delete it out of Trash — or null when they may. Moving to Trash
 * is asking for it to be deleted in 30 days, so it takes exactly the rights a
 * delete for good does, and the Archive page shows the same words this returns.
 */
create or replace function public.archive_trash_block(p_kind text, p_id uuid, p_in_trash boolean default false)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  gone constant text := 'That is no longer in the archive. Reload to see where things stand.';
  c  public.classes%rowtype;
  g  public.groups%rowtype;
  p  public.projects%rowtype;
  t  public.project_tasks%rowtype;
  s  public.general_spaces%rowtype;
  st public.general_space_teams%rowtype;
  gp public.general_projects%rowtype;
  gt public.general_tasks%rowtype;
  held text;
begin
  if not public.general_viewer_active() then
    return 'Sign in with an active account to do this.';
  end if;

  if p_kind = 'class' then
    select * into c from public.classes where id = p_id;
    if not found or c.archived_at is null or (c.trashed_at is not null) <> p_in_trash then return gone; end if;
    if c.professor_id <> auth.uid() then return 'Only the class Owner can delete it.'; end if;

  elsif p_kind = 'group' then
    select * into g from public.groups where id = p_id;
    if not found or g.archived_at is null or (g.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_set_professor(g.set_id) then return 'Only the class''s faculty can delete a group.'; end if;
    held := public.group_work_summary(g.id);
    if held is not null then
      return g.name || ' has ' || held || ' on it, so it stays in Archive.';
    end if;

  elsif p_kind = 'class_project' then
    select * into p from public.projects where id = p_id;
    if not found or p.archived_at is null or (p.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_class_professor(p.class_id) then
      return 'Only the class''s faculty can delete a project.';
    end if;

  elsif p_kind = 'class_task' then
    select * into t from public.project_tasks where id = p_id;
    if not found or t.archived_at is null or (t.trashed_at is not null) <> p_in_trash then return gone; end if;
    if public.is_board_professor(t.board_id) then return null; end if;
    if t.archived_by is distinct from auth.uid() or not public.is_board_member(t.board_id) then
      return 'Only whoever archived this task, or the professor, can delete it.';
    end if;
    if public.board_project_locked(t.board_id) or public.board_submitted(t.board_id) then
      return 'This project is closed or handed in, so its tasks can no longer change.';
    end if;

  elsif p_kind = 'space' then
    select * into s from public.general_spaces where id = p_id;
    if not found or s.kind <> 'work' or s.archived_at is null or (s.trashed_at is not null) <> p_in_trash then
      return gone;
    end if;
    if not public.is_general_space_owner(s.id) then return 'Only an Owner can delete a space.'; end if;

  elsif p_kind = 'team' then
    select * into st from public.general_space_teams where id = p_id;
    if not found or st.archived_at is null or (st.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.general_space_team_can_manage(st.id) then
      return 'Only the team''s Owner or Manager can delete it.';
    end if;

  elsif p_kind = 'project' then
    select * into gp from public.general_projects where id = p_id;
    if not found or gp.class_board_id is not null or gp.archived_at is null
       or (gp.trashed_at is not null) <> p_in_trash then
      return gone;
    end if;
    if not public.is_general_owner(gp.id) then return 'Only an Owner can delete a project.'; end if;

  elsif p_kind = 'work_task' then
    select * into gt from public.general_tasks where id = p_id;
    if not found or gt.archived_at is null or (gt.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_general_member(gt.project_id) then return 'You are no longer on this project.'; end if;
    if public.general_is_archived(gt.project_id) then
      return 'This project is archived. An Owner can restore it to make changes.';
    end if;
    if not public.general_sees_archived(gt.project_id, gt.archived_by) then
      return 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.';
    end if;

  else
    return 'That cannot go to Trash.';
  end if;

  return null;
end;
$$;

/**
 * Why the caller may not restore this archived item, or null when they may.
 * Restoring runs through each item's own archive function or policy; this only
 * says ahead of time what that would answer, in the same words.
 */
create or replace function public.archive_restore_block(p_kind text, p_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c  public.classes%rowtype;
  g  public.groups%rowtype;
  p  public.projects%rowtype;
  t  public.project_tasks%rowtype;
  st public.general_space_teams%rowtype;
  gt public.general_tasks%rowtype;
begin
  if not public.general_viewer_active() then
    return 'Sign in with an active account to do this.';
  end if;

  if p_kind = 'class' then
    select * into c from public.classes where id = p_id;
    if not (c.professor_id = auth.uid() or public.teaches_in_space(c.space_id)) then
      return 'Only the class''s faculty can restore it.';
    end if;
  elsif p_kind = 'group' then
    select * into g from public.groups where id = p_id;
    if not public.is_set_professor(g.set_id) then return 'Only the class''s faculty can restore it.'; end if;
  elsif p_kind = 'class_project' then
    -- projects_write: a project changes only for the faculty member who set it.
    select * into p from public.projects where id = p_id;
    if not (public.is_class_professor(p.class_id) and p.created_by = auth.uid()) then
      return 'Only whoever set this project can restore it.';
    end if;
  elsif p_kind = 'class_task' then
    select * into t from public.project_tasks where id = p_id;
    if public.is_board_professor(t.board_id) then return null; end if;
    if t.archived_by is distinct from auth.uid() or not public.is_board_member(t.board_id) then
      return 'Only whoever archived this task, or the professor, can restore it.';
    end if;
    if public.board_project_locked(t.board_id) or public.board_submitted(t.board_id) then
      return 'This project is closed or handed in, so its tasks can no longer change.';
    end if;
  elsif p_kind = 'space' then
    if not public.is_general_space_owner(p_id) then return 'Only an Owner can restore a space.'; end if;
  elsif p_kind = 'team' then
    select * into st from public.general_space_teams where id = p_id;
    if not public.general_space_team_can_manage(st.id) then
      return 'Only the team''s Owner or Manager can restore it.';
    end if;
  elsif p_kind = 'project' then
    if not public.is_general_owner(p_id) then return 'Only an Owner can restore a project.'; end if;
  elsif p_kind = 'work_task' then
    select * into gt from public.general_tasks where id = p_id;
    if not (public.general_can(gt.project_id, 'manage_tasks')
            or gt.created_by = auth.uid() or gt.archived_by = auth.uid()) then
      return 'Only whoever added this task, or someone who manages tasks, can restore it.';
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- the Archive page

/**
 * Everything archived that the caller may read in an archive, newest first,
 * with whether they may restore it or move it to Trash (null = yes, otherwise
 * the reason). Archived items inside something that is itself archived are
 * left out: the class, space or project stands for them.
 */
create or replace function public.list_my_archive()
returns table (
  kind text,
  area text,
  id uuid,
  name text,
  detail text,
  file_source text,
  class_id uuid,
  class_name text,
  space_id uuid,
  space_name text,
  project_id uuid,
  project_name text,
  class_project_id uuid,
  repo_id uuid,
  path text,
  archived_at timestamptz,
  archived_by uuid,
  archived_by_name text,
  restore_block text,
  trash_block text
)
language sql stable security definer set search_path = public as $$
  with rows as (
    -- Classes the caller teaches.
    select 'class'::text as kind, 'classes'::text as area, c.id, c.name,
           c.initial || ' · ' || c.section as detail, null::text as file_source,
           c.id as class_id, c.name as class_name, null::uuid as space_id, null::text as space_name,
           null::uuid as project_id, null::text as project_name, null::uuid as class_project_id,
           null::uuid as repo_id, null::text as path,
           c.archived_at, null::uuid as archived_by
      from public.classes c
     where c.archived_at is not null and c.trashed_at is null
       and ((c.professor_id = auth.uid() and public.general_viewer_active())
            or public.teaches_in_space(c.space_id))

    union all
    -- Groups in a live class the caller teaches.
    select 'group', 'classes', g.id, g.name, s.name, null,
           c.id, c.name, null, null, null, null, null, null, null,
           g.archived_at, null
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.archived_at is not null and g.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and public.is_set_professor(g.set_id)

    union all
    -- Class projects in a live class the caller teaches.
    select 'class_project', 'classes', p.id, p.title,
           'Weeks ' || p.start_week || '–' || p.end_week, null,
           c.id, c.name, null, null, null, null, p.id, null, null,
           p.archived_at, null
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.archived_at is not null and p.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and public.is_class_professor(p.class_id)

    union all
    -- Class tasks: the ones the caller archived from their own board, and for
    -- faculty, every task archived in a class they teach.
    select 'class_task', 'classes', t.id, t.title,
           coalesce(g.name, public.display_name(b.student_id)), null,
           c.id, c.name, null, null, null, p.title, p.id, null, null,
           t.archived_at, t.archived_by
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
      join public.classes c on c.id = p.class_id
      left join public.groups g on g.id = b.group_id
     where t.archived_at is not null and t.trashed_at is null
       and p.archived_at is null and p.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and ((t.archived_by = auth.uid() and public.is_board_member(b.id))
            or public.is_board_professor(b.id))

    union all
    -- Files the caller archived in their own draft, on a class board or in a work project.
    select case when gp.class_board_id is null then 'work_file' else 'class_file' end,
           case when gp.class_board_id is null then 'work' else 'classes' end,
           f.id, regexp_replace(f.path, '^.*/', ''), 'My draft', 'draft',
           cc.id, cc.name,
           case when gp.class_board_id is null then gs.id end,
           case when gp.class_board_id is null then gs.name end,
           gp.id, coalesce(cp.title, gp.name), cp.id, d.repo_id, f.path,
           f.archived_at, f.archived_by
      from public.general_draft_files f
      join public.general_drafts d on d.id = f.draft_id
      join public.general_projects gp on gp.id = d.project_id
      left join public.general_spaces gs on gs.id = gp.space_id
      left join public.project_boards b on b.id = gp.class_board_id
      left join public.projects cp on cp.id = b.project_id
      left join public.classes cc on cc.id = cp.class_id
     where d.user_id = auth.uid()
       and f.archived_at is not null and f.trashed_at is null
       and f.action <> 'removed'
       and f.path !~ '(^|/)\.keep$'
       and gp.archived_at is null and gp.trashed_at is null

    union all
    -- Task files in a live work project, for whoever may read that archive.
    select 'work_file', 'work', f.id, f.file_name, t.title, 'task',
           null, null, gs.id, gs.name, gp.id, gp.name, null, null, null,
           f.archived_at, f.archived_by
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
      join public.general_projects gp on gp.id = f.project_id
      left join public.general_spaces gs on gs.id = gp.space_id
     where f.archived_at is not null and f.trashed_at is null
       and t.archived_at is null
       and gp.archived_at is null and gp.trashed_at is null and gp.class_board_id is null
       and public.general_sees_archived(f.project_id, f.archived_by)

    union all
    -- The caller's own syllabi and curricula.
    select r.kind::text, 'classes', r.id, r.title, r.file_name, null,
           null, null, null, null, null, null, null, null, null,
           r.archived_at, r.professor_id
      from public.teaching_resources r
     where r.professor_id = auth.uid()
       and r.archived_at is not null and r.trashed_at is null
       and public.general_viewer_active()

    union all
    -- Work spaces the caller leads.
    select 'space', 'work', s.id, s.name, nullif(s.description, ''), null,
           null, null, s.id, s.name, null, null, null, null, null,
           s.archived_at, null
      from public.general_spaces s
     where s.kind = 'work' and s.archived_at is not null and s.trashed_at is null
       and public.is_general_space_member(s.id)
       and exists (select 1 from public.general_space_members m
                    where m.space_id = s.id and m.user_id = auth.uid()
                      and m.level in ('owner', 'manager'))

    union all
    -- Space teams the caller runs, in a live space.
    select 'team', 'work', t.id, t.name, nullif(t.description, ''), null,
           null, null, s.id, s.name, null, null, null, null, null,
           t.archived_at, null
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.archived_at is not null and t.trashed_at is null
       and s.archived_at is null and s.trashed_at is null
       and public.general_space_team_can_manage(t.id)

    union all
    -- Work projects the caller archived or leads, outside an archived space.
    select 'project', 'work', p.id, p.name, nullif(p.description, ''), null,
           null, null, s.id, s.name, p.id, p.name, null, null, null,
           p.archived_at, p.archived_by
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.class_board_id is null
       and p.archived_at is not null and p.trashed_at is null
       and (s.id is null or (s.archived_at is null and s.trashed_at is null))
       and ((p.archived_by = auth.uid() and public.is_general_member(p.id))
            or public.general_leads(p.id))

    union all
    -- Work tasks in a live project, for whoever may read that archive.
    select 'work_task', 'work', t.id, t.title,
           case t.status when 'todo' then 'To do' when 'in_progress' then 'In progress' else 'Done' end, null,
           null, null, s.id, s.name, p.id, p.name, null, null, null,
           t.archived_at, t.archived_by
      from public.general_tasks t
      join public.general_projects p on p.id = t.project_id
      left join public.general_spaces s on s.id = p.space_id
     where t.archived_at is not null and t.trashed_at is null
       and p.archived_at is null and p.trashed_at is null and p.class_board_id is null
       and public.general_sees_archived(t.project_id, t.archived_by)
  )
  select r.kind, r.area, r.id, r.name, r.detail, r.file_source,
         r.class_id, r.class_name, r.space_id, r.space_name,
         r.project_id, r.project_name, r.class_project_id, r.repo_id, r.path,
         r.archived_at, r.archived_by,
         case when r.archived_by is not null then public.display_name(r.archived_by) end,
         case
           when r.kind in ('class_file', 'work_file') and r.file_source = 'draft' then
             case when public.class_board_frozen(gp.class_board_id)
                  then 'The project is closed or handed in, so its files cannot change.' end
           when r.kind = 'work_file' then
             case when not (public.general_can(r.project_id, 'edit_files')
                            or tf.uploaded_by = auth.uid() or tf.archived_by = auth.uid())
                  then 'Only whoever added this file, or somebody who can edit files, can restore it.' end
           when r.kind in ('syllabus', 'curriculum') then null
           else public.archive_restore_block(r.kind, r.id)
         end,
         case
           when r.kind in ('class_file', 'work_file') and r.file_source = 'draft' then
             case when public.class_board_frozen(gp.class_board_id)
                  then 'The project is closed or handed in, so its files cannot change.' end
           when r.kind = 'work_file' then
             case when not (public.general_can(r.project_id, 'edit_files') or tf.uploaded_by = auth.uid())
                  then 'Only whoever added this file, or somebody who can edit files, can move it to Trash.' end
           when r.kind in ('syllabus', 'curriculum') then null
           else public.archive_trash_block(r.kind, r.id)
         end
    from rows r
    left join public.general_projects gp on gp.id = r.project_id and r.file_source = 'draft'
    left join public.general_task_files tf on tf.id = r.id and r.file_source = 'task'
   order by r.archived_at desc, r.name;
$$;

-- ---------------------------------------------------------------- into Trash and back

/**
 * Clears the trash columns, which puts the item back in its archive. Internal:
 * restore_trashed_item checks who is asking, purge_trash calls it as nobody.
 */
create or replace function public.archive_untrash(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('collabify.trash_op', 'on', true);
  perform set_config('collabify.task_archive_op', 'on', true);
  perform set_config('collabify.general_archive_op', 'on', true);
  if p_kind = 'class' then
    update public.classes set trashed_at = null, trashed_by = null where id = p_id;
    update public.general_spaces set trashed_at = null, trashed_by = null
     where id = (select space_id from public.classes where id = p_id);
  elsif p_kind = 'group' then
    update public.groups set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'class_project' then
    update public.projects set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'class_task' then
    update public.project_tasks set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'space' then
    update public.general_spaces set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'team' then
    update public.general_space_teams set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'project' then
    update public.general_projects set trashed_at = null, trashed_by = null where id = p_id;
  elsif p_kind = 'work_task' then
    update public.general_tasks set trashed_at = null, trashed_by = null where id = p_id;
  end if;
  perform set_config('collabify.general_archive_op', 'off', true);
  perform set_config('collabify.task_archive_op', 'off', true);
  perform set_config('collabify.trash_op', 'off', true);
end;
$$;

/** Moves an archived class, group, project, task, space or team to Trash. */
create or replace function public.trash_archived_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  reason text := public.archive_trash_block(p_kind, p_id);
begin
  if reason is not null then
    raise exception '%', reason using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.trash_op', 'on', true);
  perform set_config('collabify.task_archive_op', 'on', true);
  perform set_config('collabify.general_archive_op', 'on', true);
  if p_kind = 'class' then
    update public.classes set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
    -- The class's own space goes with it, or Spaces would still list it.
    update public.general_spaces set trashed_at = now(), trashed_by = auth.uid()
     where id = (select space_id from public.classes where id = p_id) and archived_at is not null;
  elsif p_kind = 'group' then
    update public.groups set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'class_project' then
    update public.projects set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'class_task' then
    update public.project_tasks set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'space' then
    update public.general_spaces set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'team' then
    update public.general_space_teams set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'project' then
    update public.general_projects set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  elsif p_kind = 'work_task' then
    update public.general_tasks set trashed_at = now(), trashed_by = auth.uid() where id = p_id;
  end if;
  perform set_config('collabify.general_archive_op', 'off', true);
  perform set_config('collabify.task_archive_op', 'off', true);
  perform set_config('collabify.trash_op', 'off', true);
end;
$$;

/** Back to its archive, for whoever put it in Trash. */
create or replace function public.restore_trashed_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  mine boolean;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to restore this' using errcode = 'insufficient_privilege';
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and trashed_by = $2)',
                 case p_kind
                   when 'class' then 'classes' when 'group' then 'groups'
                   when 'class_project' then 'projects' when 'class_task' then 'project_tasks'
                   when 'space' then 'general_spaces' when 'team' then 'general_space_teams'
                   when 'project' then 'general_projects' when 'work_task' then 'general_tasks'
                   else 'classes' end)
    into mine using p_id, auth.uid();
  if not coalesce(mine, false) or p_kind not in ('class', 'group', 'class_project', 'class_task',
                                                  'space', 'team', 'project', 'work_task') then
    raise exception 'That is no longer in your Trash. Reload to see where things stand.'
      using errcode = 'no_data_found';
  end if;
  perform public.archive_untrash(p_kind, p_id);
end;
$$;

/**
 * Deletes a trashed item for good, for whoever put it in Trash and only while
 * they still have the rights a delete takes. Each kind goes the way its own
 * delete already does.
 */
create or replace function public.delete_trashed_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  reason text;
  mine boolean;
begin
  execute format('select exists (select 1 from public.%I where id = $1 and trashed_by = $2)',
                 case p_kind
                   when 'class' then 'classes' when 'group' then 'groups'
                   when 'class_project' then 'projects' when 'class_task' then 'project_tasks'
                   when 'space' then 'general_spaces' when 'team' then 'general_space_teams'
                   when 'project' then 'general_projects' when 'work_task' then 'general_tasks'
                   else 'classes' end)
    into mine using p_id, auth.uid();
  if not coalesce(mine, false) then
    return;
  end if;
  reason := public.archive_trash_block(p_kind, p_id, true);
  if reason is not null then
    raise exception '%', reason using errcode = 'insufficient_privilege';
  end if;

  if p_kind = 'class' then
    perform set_config('collabify.class_delete', 'on', true);
    delete from public.classes where id = p_id;
    perform set_config('collabify.class_delete', 'off', true);
  elsif p_kind = 'group' then
    delete from public.groups where id = p_id;
  elsif p_kind = 'class_project' then
    delete from public.projects where id = p_id;
  elsif p_kind = 'class_task' then
    delete from public.project_tasks where id = p_id;
  elsif p_kind = 'space' then
    perform public.delete_general_space(p_id);
  elsif p_kind = 'team' then
    perform public.delete_general_space_team(p_id);
  elsif p_kind = 'project' then
    -- The storage sweep takes the uploaded bytes once nothing points at them.
    perform public.delete_general_project(p_id);
  elsif p_kind = 'work_task' then
    perform public.delete_archived_general_task(p_id);
  end if;
end;
$$;

/** An archived file or folder of your own draft into Trash. Answers how many files went. */
create or replace function public.trash_archived_draft_path(p_repo uuid, p_path text)
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
     set trashed_at = now(), trashed_by = auth.uid(), trash_root = v, updated_at = now()
   where draft_id = d.id
     and archived_at is not null
     and trashed_at is null
     and (path = v or left(path, char_length(v) + 1) = v || '/');
  get diagnostics n = row_count;
  perform set_config('collabify.trash_op', 'off', true);

  update public.general_drafts set updated_at = now() where id = d.id;
  return n;
end;
$$;

-- ---------------------------------------------------------------- the Trash page

/** trash.sql's list, plus the kinds this file adds. `place_id` is where it lived. */
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
  resource_kind text,
  place_id uuid
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
           null::text as task_title, null::text as resource_kind,
           null::text as label, null::uuid as place_id
      from drafts x
    union all
    select 'task_file', f.id, null, null, f.file_name, false, 1, f.size_bytes, f.trashed_at,
           f.project_id, t.title, null, null, null
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
     where f.trashed_by = auth.uid()
       and f.trashed_at is not null
       and public.is_general_member(f.project_id)
    union all
    select 'resource', tr.id, null, null, tr.title, false, 1, tr.size_bytes, tr.trashed_at,
           null, null, tr.kind::text, null, null
      from public.teaching_resources tr
     where tr.professor_id = auth.uid()
       and tr.trashed_at is not null
    union all
    select 'discussion', gd.id, null, null, gd.topic, false, 1, octet_length(gd.content_html)::bigint,
           gd.trashed_at, gd.project_id, null, null, null, null
      from public.general_discussions gd
     where gd.trashed_by = auth.uid()
       and gd.trashed_at is not null
       and public.is_general_member(gd.project_id)
    union all
    select 'class', c.id, null, null, c.name, false, 1, null, c.trashed_at,
           null, null, null, c.initial || ' · ' || c.section, null
      from public.classes c
     where c.trashed_by = auth.uid() and c.trashed_at is not null
    union all
    select 'group', g.id, null, null, g.name, false, 1, null, g.trashed_at,
           null, null, null, c.name, c.id
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.trashed_by = auth.uid() and g.trashed_at is not null
    union all
    select 'class_project', p.id, null, null, p.title, false, 1, null, p.trashed_at,
           null, null, null, c.name, c.id
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'class_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           null, null, null, p.title, p.id
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'space', s.id, null, null, s.name, false, 1, null, s.trashed_at,
           null, null, null, 'Spaces', null
      from public.general_spaces s
     where s.kind = 'work' and s.trashed_by = auth.uid() and s.trashed_at is not null
    union all
    select 'team', t.id, null, null, t.name, false, 1, null, t.trashed_at,
           null, null, null, s.name, s.id
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'project', p.id, null, null, p.name, false, 1, null, p.trashed_at,
           null, null, null, coalesce(s.name, 'Projects'), s.id
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'work_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           t.project_id, null, null, null, null
      from public.general_tasks t
     where t.trashed_by = auth.uid() and t.trashed_at is not null
  )
  select r.kind, r.id, r.repo_id, r.root, r.name, r.is_folder, r.file_count, r.size_bytes,
         r.trashed_at, r.trashed_at + interval '30 days',
         r.project_id,
         coalesce(r.label,
                  case r.resource_kind when 'syllabus' then 'Syllabi' when 'curriculum' then 'Curriculum' end,
                  cp.title, gp.name),
         b.project_id,
         r.task_title,
         coalesce(gp.archived_at is not null or public.class_board_frozen(gp.class_board_id), false),
         r.resource_kind,
         r.place_id
    from rows r
    left join public.general_projects gp on gp.id = r.project_id
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.projects cp on cp.id = b.project_id
   order by r.trashed_at desc, r.name;
$$;

/** Everything trashed by the caller of the kinds this file adds, tasks before what holds them. */
create or replace function public.archive_trash_rows(p_user uuid, p_before timestamptz)
returns table (kind text, id uuid, trashed_by uuid)
language sql stable security definer set search_path = public as $$
  select x.kind, x.id, x.trashed_by from (
    select 1 as rank, 'class_task'::text as kind, id, trashed_by, trashed_at from public.project_tasks
    union all select 1, 'work_task', id, trashed_by, trashed_at from public.general_tasks
    union all select 2, 'group', id, trashed_by, trashed_at from public.groups
    union all select 2, 'class_project', id, trashed_by, trashed_at from public.projects
    union all select 2, 'team', id, trashed_by, trashed_at from public.general_space_teams
    union all select 3, 'project', id, trashed_by, trashed_at from public.general_projects
    union all select 4, 'class', id, trashed_by, trashed_at from public.classes
    union all select 4, 'space', g.id, g.trashed_by, g.trashed_at from public.general_spaces g where g.kind = 'work'
  ) x
   where x.trashed_at is not null
     and (p_user is null or x.trashed_by = p_user)
     and (p_before is null or x.trashed_at < p_before)
   order by x.rank, x.trashed_at;
$$;

/** Deletes everything the caller can still act on. Answers how many items went. */
create or replace function public.empty_my_trash()
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
  m int;
  k int;
  j int;
  x int := 0;
  r record;
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

  delete from public.general_discussions gd
   where gd.trashed_by = auth.uid() and gd.trashed_at is not null
     and public.is_general_member(gd.project_id)
     and not public.general_is_archived(gd.project_id);
  get diagnostics j = row_count;

  -- Whatever may not go yet (a project now locked, a right since lost) stays.
  for r in select * from public.archive_trash_rows(auth.uid(), null) loop
    begin
      perform public.delete_trashed_item(r.kind, r.id);
      x := x + 1;
    exception when others then
      null;
    end;
  end loop;
  return n + m + k + j + x;
end;
$$;

-- ---------------------------------------------------------------- 30 days on

/**
 * Deletes whatever has sat in Trash for 30 days. The storage sweep takes the
 * bytes. The kinds this file adds are deleted as whoever trashed them, so a
 * delete obeys the same rules it would from the Trash page; one they may no
 * longer delete, or whose account is gone, goes back to Archive instead of
 * waiting in Trash for good.
 */
create or replace function public.purge_trash()
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
  m int;
  k int;
  j int;
  x int := 0;
  r record;
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

  delete from public.general_discussions where trashed_at < now() - interval '30 days';
  get diagnostics j = row_count;

  for r in select * from public.archive_trash_rows(null, now() - interval '30 days') loop
    if r.trashed_by is null then
      perform public.archive_untrash(r.kind, r.id);
      continue;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.trashed_by, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.trashed_by::text, true);
    begin
      perform public.delete_trashed_item(r.kind, r.id);
      x := x + 1;
    exception when others then
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform public.archive_untrash(r.kind, r.id);
    end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
  end loop;
  return n + m + k + j + x;
end;
$$;

revoke all on function public.archive_trash_block(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.archive_restore_block(text, uuid) from public, anon, authenticated;
revoke all on function public.archive_untrash(text, uuid) from public, anon, authenticated;
revoke all on function public.archive_trash_rows(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.list_my_archive() from public, anon;
revoke all on function public.trash_archived_item(text, uuid) from public, anon;
revoke all on function public.restore_trashed_item(text, uuid) from public, anon;
revoke all on function public.delete_trashed_item(text, uuid) from public, anon;
revoke all on function public.trash_archived_draft_path(uuid, text) from public, anon;
revoke all on function public.list_my_trash() from public, anon;
revoke all on function public.empty_my_trash() from public, anon;
revoke all on function public.purge_trash() from public, anon, authenticated;
revoke all on function public.list_general_space_teams(uuid, boolean) from public, anon;
revoke all on function public.list_my_archived_class_tasks() from public, anon;
grant execute on function public.list_my_archive() to authenticated;
grant execute on function public.trash_archived_item(text, uuid) to authenticated;
grant execute on function public.restore_trashed_item(text, uuid) to authenticated;
grant execute on function public.delete_trashed_item(text, uuid) to authenticated;
grant execute on function public.trash_archived_draft_path(uuid, text) to authenticated;
grant execute on function public.list_my_trash() to authenticated;
grant execute on function public.empty_my_trash() to authenticated;
grant execute on function public.list_general_space_teams(uuid, boolean) to authenticated;
grant execute on function public.list_my_archived_class_tasks() to authenticated;

commit;
