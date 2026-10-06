-- Collabify — milestones for work projects (Work tab, Part 3).
--
--   node scripts/db.mjs supabase/work-milestones.sql
--
-- A milestone is a dated goal on one project. Tasks are tagged to it; its
-- progress is how many of those are done (worked out in the app). Anyone with
-- manage_tasks runs milestones and tags tasks; everybody on the project reads.
--
-- Requires work-planning.sql (and everything before it). Recreates
-- general_task_overview with milestone_id appended, so re-run this file after
-- re-running work-planning.sql, general-schedule.sql, general-project-archive.sql
-- or general-archive-rbac.sql.
--
-- Deleting a project goes through delete_general_project, which removes the
-- project's tasks first, while the Owner is still a member, so the milestone
-- cascade and release_milestone_tasks find nothing tagged. That is the same
-- reliance work-planning.sql notes for sprints (Postgres fires the foreign
-- keys in trigger-name order; general_tasks' sorts before general_milestones').
-- A direct delete of a project row with tagged tasks still in it is not a
-- supported path; supabase/tests/work-milestones.test.sql covers the real one.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.general_milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  name        text not null,
  description text not null default '',
  due_on      date not null,
  reached_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint general_milestones_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_milestones_description_len check (char_length(description) <= 1000),
  constraint general_milestones_id_project unique (id, project_id)
);

create index if not exists general_milestones_project_idx
  on public.general_milestones (project_id, due_on);

alter table public.general_milestones enable row level security;

drop policy if exists general_milestones_read on public.general_milestones;
create policy general_milestones_read on public.general_milestones
  for select to authenticated
  using (public.can_read_general_project(project_id));

drop policy if exists general_milestones_insert on public.general_milestones;
create policy general_milestones_insert on public.general_milestones
  for insert to authenticated
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_update on public.general_milestones;
create policy general_milestones_update on public.general_milestones
  for update to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id))
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_delete on public.general_milestones;
create policy general_milestones_delete on public.general_milestones
  for delete to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id));

revoke all on public.general_milestones from anon;
grant select, insert, update, delete on public.general_milestones to authenticated;

/**
 * The server owns the bookkeeping columns. A milestone never moves to another
 * project, who made it and when are fixed at insert, and reached_at is stamped
 * with the server's clock when it first turns on (kept while it stays on,
 * cleared when it goes back to null), whatever the client sent.
 */
create or replace function public.guard_general_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if new.reached_at is not null then
      new.reached_at := now();
    end if;
    return new;
  end if;
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.reached_at is not null then
    new.reached_at := coalesce(old.reached_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_milestone() from public, anon;

drop trigger if exists general_milestones_guard on public.general_milestones;
create trigger general_milestones_guard before insert or update on public.general_milestones
  for each row execute function public.guard_general_milestone();

-- ---------------------------------------------------------------- tasks

alter table public.general_tasks add column if not exists milestone_id uuid;

do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_milestone_fk foreign key (milestone_id, project_id)
    references public.general_milestones (id, project_id) on delete set null (milestone_id);
exception when duplicate_object then null; end $$;

create index if not exists general_tasks_milestone_idx
  on public.general_tasks (milestone_id) where milestone_id is not null;

/** Tagging a task is planning: manage_tasks only. */
create or replace function public.guard_general_task_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.milestone_id is not null)
     or (tg_op = 'UPDATE' and new.milestone_id is distinct from old.milestone_id) then
    if not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks can tag a task with a milestone.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_task_milestone() from public, anon;

drop trigger if exists general_tasks_milestone_guard on public.general_tasks;
create trigger general_tasks_milestone_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task_milestone();

/**
 * Untag a milestone's tasks before it goes, archived ones included. The FK's
 * own set-null would otherwise trip guard_general_task's archived-task freeze
 * (the same trap release_sprint_tasks handles in work-planning.sql). Security
 * definer so tasks the deleter cannot see are untagged too; it only ever runs
 * for a row the delete policy allowed. The previous flag value is restored.
 */
create or replace function public.release_milestone_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was text := current_setting('collabify.general_archive_op', true);
begin
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks set milestone_id = null where milestone_id = old.id;
  perform set_config('collabify.general_archive_op', coalesce(was, 'off'), true);
  return old;
end;
$$;

revoke all on function public.release_milestone_tasks() from public, anon;

drop trigger if exists general_milestones_release on public.general_milestones;
create trigger general_milestones_release before delete on public.general_milestones
  for each row execute function public.release_milestone_tasks();

-- ---------------------------------------------------------------- the overview

-- Dropped and recreated: `create or replace` cannot drop or reorder columns,
-- and the owners before this file define it with fewer.
drop view if exists public.general_task_overview;

create view public.general_task_overview
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
       coalesce((select array_agg(a.user_id order by a.assigned_at)
                   from public.general_task_assignees a where a.task_id = t.id), '{}'::uuid[])
         as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.general_task_files f
         where f.task_id = t.id and f.archived_at is null)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at,
       t.archived_at,
       t.archived_by,
       t.sprint_id,
       t.rank,
       t.milestone_id
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.general_milestones;
exception when duplicate_object then null; end $$;

commit;
