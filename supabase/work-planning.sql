-- Collabify — sprints and backlog order for work projects (Work tab, Part 2).
--
--   node scripts/db.mjs supabase/work-planning.sql
--
-- A sprint is a short time box on one project: planned, then running, then
-- finished, in that order. One runs at a time. A task in no sprint is in the
-- backlog, and `rank` orders a list top to bottom (lower = sooner).
--
-- Who plans: anyone with manage_tasks (Owners and Managers). Members still
-- add tasks; theirs land in the backlog. guard_general_task is left alone: a
-- second trigger, general_tasks_plan_guard, owns the planning columns.
--
-- Also defines what class-planning.sql reuses: the sprint_state enum and the
-- prepare_sprint / guard_sprint_state trigger functions. Run this file first.
-- The finished-sprint refusal binds the service role too: a future copy or
-- restore function must not point tasks at a completed sprint.
--
-- Redefines general_task_overview (owner: general-archive-rbac.sql) to append
-- sprint_id and rank. Re-run this file after re-running that one, then re-run
-- work-milestones.sql, which recreates the view again to append milestone_id.
--
-- Deleting a project relies on general_tasks' foreign key firing before
-- general_sprints' (Postgres runs them in trigger-name order, and the live
-- RI_ConstraintTrigger names sort that way), so the tasks are gone before
-- release_sprint_tasks runs.
--
-- Idempotent. Safe to re-run.

begin;

do $$ begin
  create type public.sprint_state as enum ('planned', 'active', 'completed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- shared triggers

/** A new sprint always starts out planned, whatever the client sent. */
create or replace function public.prepare_sprint()
returns trigger language plpgsql set search_path = public as $$
begin
  new.state        := 'planned';
  new.started_at   := null;
  new.completed_at := null;
  new.created_by   := coalesce(auth.uid(), new.created_by);
  new.created_at   := now();
  return new;
end;
$$;

/**
 * Planned → running → finished, never backwards, and a finished sprint is
 * fixed except for its milestone (supabase/sprint-milestones.sql, which
 * carries the same body; keep the two in step). The timestamps are stamped
 * here so a client cannot backdate them. Shared by general_sprints and
 * board_sprints, so the owning column is pinned by table name.
 */
create or replace function public.guard_sprint_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.state = 'completed'
     and (new.name, new.goal, new.starts_on, new.ends_on, new.state)
         is distinct from (old.name, old.goal, old.starts_on, old.ends_on, old.state) then
    raise exception 'This sprint is finished, so it can no longer change.'
      using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    if old.state = 'planned' and new.state = 'active' then
      new.started_at := now();
    elsif old.state = 'active' and new.state = 'completed' then
      new.completed_at := now();
    else
      raise exception 'A sprint goes from planned to running to finished, in that order.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.state = old.state then
    new.started_at   := old.started_at;
    new.completed_at := old.completed_at;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if tg_table_name = 'general_sprints' then
    new.project_id := old.project_id;
  else
    new.board_id := old.board_id;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_sprint() from public, anon;
revoke all on function public.guard_sprint_state() from public, anon;

-- ---------------------------------------------------------------- sprints

create table if not exists public.general_sprints (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  name         text not null,
  goal         text not null default '',
  starts_on    date not null,
  ends_on      date not null,
  state        public.sprint_state not null default 'planned',
  started_at   timestamptz,
  completed_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint general_sprints_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_sprints_goal_len check (char_length(goal) <= 500),
  constraint general_sprints_dates check (ends_on >= starts_on),
  constraint general_sprints_id_project unique (id, project_id)
);

create unique index if not exists general_sprints_one_running
  on public.general_sprints (project_id) where state = 'active';
create index if not exists general_sprints_project_idx
  on public.general_sprints (project_id, starts_on);

drop trigger if exists general_sprints_prepare on public.general_sprints;
create trigger general_sprints_prepare before insert on public.general_sprints
  for each row execute function public.prepare_sprint();
drop trigger if exists general_sprints_guard on public.general_sprints;
create trigger general_sprints_guard before update on public.general_sprints
  for each row execute function public.guard_sprint_state();

alter table public.general_sprints enable row level security;

drop policy if exists general_sprints_read on public.general_sprints;
create policy general_sprints_read on public.general_sprints
  for select to authenticated
  using (public.can_read_general_project(project_id));

drop policy if exists general_sprints_insert on public.general_sprints;
create policy general_sprints_insert on public.general_sprints
  for insert to authenticated
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_sprints_update on public.general_sprints;
create policy general_sprints_update on public.general_sprints
  for update to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id))
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

-- Only a sprint that never started can go; its tasks fall back to the backlog.
drop policy if exists general_sprints_delete on public.general_sprints;
create policy general_sprints_delete on public.general_sprints
  for delete to authenticated
  using (state = 'planned'
         and public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id));

revoke all on public.general_sprints from anon;
grant select, insert, update, delete on public.general_sprints to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.general_tasks add column if not exists sprint_id uuid;
alter table public.general_tasks add column if not exists rank double precision;

-- Existing tasks keep the order they were made in.
update public.general_tasks set rank = extract(epoch from created_at) where rank is null;
alter table public.general_tasks
  alter column rank set default extract(epoch from clock_timestamp()),
  alter column rank set not null;

-- Tasks made in the same instant tie; nudge all but the first of each tie
-- apart so a move between them has room. A second run finds no ties.
update public.general_tasks t
   set rank = t.rank + (d.rn - 1) * 1e-3
  from (select id, row_number() over (partition by project_id, rank order by id) as rn
          from public.general_tasks) d
 where t.id = d.id and d.rn > 1;

-- A task can only join a sprint on its own project. Deleting a sprint puts its
-- tasks back in the backlog (the column list needs Postgres 15 or later).
do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_sprint_fk foreign key (sprint_id, project_id)
    references public.general_sprints (id, project_id) on delete set null (sprint_id);
exception when duplicate_object then null; end $$;

create index if not exists general_tasks_sprint_idx
  on public.general_tasks (sprint_id) where sprint_id is not null;

/**
 * Planning (sprint and order) is manage_tasks only; everything else is
 * guard_general_task's. A finished sprint takes no new tasks from anyone, and
 * a task that comes back to life in one (reopened, or restored unfinished)
 * returns to the backlog. The checks read the change the client asked for, so
 * that move back to the backlog never trips them.
 */
create or replace function public.guard_general_task_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sprint_id is not null
     and (tg_op = 'INSERT' or new.sprint_id is distinct from old.sprint_id)
     and exists (select 1 from public.general_sprints s
                  where s.id = new.sprint_id and s.state = 'completed') then
    raise exception 'This sprint is finished, so tasks can no longer join it. Pick a planned sprint or the backlog.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.general_can(new.project_id, 'manage_tasks') then
      if new.sprint_id is not null then
        raise exception 'Only someone who manages tasks can put a task in a sprint.'
          using errcode = 'check_violation';
      end if;
      -- A member's task joins the end of the backlog, whatever rank was sent.
      new.rank := extract(epoch from clock_timestamp());
    end if;
    return new;
  end if;

  if auth.uid() is not null
     and (new.sprint_id is distinct from old.sprint_id or new.rank is distinct from old.rank)
     and not public.general_can(old.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks can plan sprints and order the backlog.'
      using errcode = 'check_violation';
  end if;

  if old.sprint_id is not null
     and new.sprint_id is not distinct from old.sprint_id
     and new.status <> 'done'
     and (old.status = 'done' or (old.archived_at is not null and new.archived_at is null))
     and exists (select 1 from public.general_sprints s
                  where s.id = old.sprint_id and s.state = 'completed') then
    new.sprint_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_task_plan() from public, anon;

drop trigger if exists general_tasks_plan_guard on public.general_tasks;
create trigger general_tasks_plan_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task_plan();

/**
 * Deleting a planned sprint puts its tasks back in the backlog. The foreign
 * key's own set null runs as an UPDATE under the caller, and guard_general_task
 * refuses that on an archived task that has a team. So clear sprint_id here
 * first, holding collabify.general_archive_op, the flag guard_general_task
 * honours for archive operations, and restoring whatever it was before.
 * Security definer, because the tasks' select policy hides a task somebody
 * else archived from a Member who holds a manage_tasks grant: as the caller,
 * the update would miss it and the foreign key's own update would still trip
 * the guard. The trigger only fires for a row the caller's delete policy let
 * through (planned sprint, manage_tasks, project not archived), and both task
 * guards still run on each task with auth.uid() unchanged.
 */
create or replace function public.release_sprint_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was text := current_setting('collabify.general_archive_op', true);
begin
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks set sprint_id = null where sprint_id = old.id;
  perform set_config('collabify.general_archive_op', coalesce(was, 'off'), true);
  return old;
end;
$$;

revoke all on function public.release_sprint_tasks() from public, anon;

drop trigger if exists general_sprints_release on public.general_sprints;
create trigger general_sprints_release before delete on public.general_sprints
  for each row execute function public.release_sprint_tasks();

-- ---------------------------------------------------------------- finishing

/**
 * Finish the running sprint in one step: its unfinished tasks move to a
 * planned sprint (or the backlog, when p_carry_to is null), then it closes.
 * Security invoker, so RLS and the guards apply to the caller as usual.
 */
create or replace function public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  s public.general_sprints;
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can(s.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks can finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'active' then
    raise exception 'Only a running sprint can be finished.' using errcode = 'check_violation';
  end if;
  if p_carry_to is not null and not exists (
    select 1 from public.general_sprints
     where id = p_carry_to and project_id = s.project_id and state = 'planned'
  ) then
    raise exception 'Unfinished tasks can only move to a planned sprint on this project.'
      using errcode = 'check_violation';
  end if;

  -- Archived unfinished tasks stay in the finished sprint on purpose.
  update public.general_tasks
     set sprint_id = p_carry_to
   where sprint_id = p_sprint and status <> 'done' and archived_at is null;

  update public.general_sprints set state = 'completed' where id = p_sprint;
end;
$$;

revoke all on function public.complete_general_sprint(uuid, uuid) from public, anon;
grant execute on function public.complete_general_sprint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the overview

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
       t.rank
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.general_sprints;
exception when duplicate_object then null; end $$;

commit;
