-- supabase/sprint-settings.sql
--
-- Per-project sprint settings, and who may run a sprint on a work project.
--
-- general_sprint_settings holds one optional row per project: whether sprints
-- start and finish by themselves, what happens to unfinished tasks, how long a
-- sprint runs, and when. A project with no row uses the defaults. Anyone who can
-- read the project can read its settings; only the project manager and
-- coordinators can write them (and not on an archived project).
--
-- Sprint control moves from the manage_tasks grant to the role. Starting or
-- finishing a sprint (a state change to active or completed) takes the project
-- manager or a coordinator, through general_can_run_sprint(). The rule is its own
-- trigger, general_sprints_run_guard; guard_sprint_state (sprint-reopen.sql)
-- keeps owning the order of the states. A manage_tasks holder still edits
-- sprints and moves tasks into them. Three callers pass the rule without the
-- role: the service role (auth.uid() is null, the scheduled job), a transaction
-- that has set collabify.sprint_automation to on (run_sprint_automation, added
-- to this file with the automation), and a reopen, which already checks the role.
--
-- Redefines complete_general_sprint (first written by work-planning.sql) to
-- check general_can_run_sprint. Run after sprint-reopen.sql. Re-running
-- work-planning.sql or sprint-reopen.sql means re-running this file after it.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- who runs a sprint

/**
 * The project manager and coordinators run sprints. Per-team sprints will add
 * "or the lead of this sprint's team" here, and only here.
 */
create or replace function public.general_can_run_sprint(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.general_role_of(p_project)::text, '') in ('pm', 'coordinator');
$$;

revoke all on function public.general_can_run_sprint(uuid) from public, anon;
grant execute on function public.general_can_run_sprint(uuid) to authenticated;

-- ---------------------------------------------------------------- settings table

create table if not exists public.general_sprint_settings (
  project_id       uuid primary key references public.general_projects (id) on delete cascade,
  auto_finish      boolean not null default false,
  auto_start       boolean not null default false,
  auto_start_since timestamptz,
  carry            text not null default 'ask',
  length_days      int not null default 14,
  start_weekday    int,
  run_at           time not null default '09:00',
  updated_by       uuid,
  updated_at       timestamptz,
  constraint general_sprint_settings_carry check (carry in ('ask', 'next', 'backlog')),
  constraint general_sprint_settings_length check (length_days between 1 and 90),
  constraint general_sprint_settings_weekday check (start_weekday between 0 and 6),
  constraint general_sprint_settings_finish_carry check (not (auto_finish and carry = 'ask'))
);

/**
 * Stamps who saved and when, and keeps auto_start_since in step with auto_start:
 * set when it turns on, cleared when it turns off, never taken from the client.
 */
create or replace function public.prepare_sprint_settings()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  if not new.auto_start then
    new.auto_start_since := null;
  elsif tg_op = 'INSERT' or not old.auto_start then
    new.auto_start_since := now();
  else
    new.auto_start_since := old.auto_start_since;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_sprint_settings() from public, anon;

drop trigger if exists general_sprint_settings_prepare on public.general_sprint_settings;
create trigger general_sprint_settings_prepare
  before insert or update on public.general_sprint_settings
  for each row execute function public.prepare_sprint_settings();

alter table public.general_sprint_settings enable row level security;

drop policy if exists general_sprint_settings_read on public.general_sprint_settings;
create policy general_sprint_settings_read on public.general_sprint_settings
  for select to authenticated
  using (public.can_read_general_project(project_id));

drop policy if exists general_sprint_settings_insert on public.general_sprint_settings;
create policy general_sprint_settings_insert on public.general_sprint_settings
  for insert to authenticated
  with check (public.general_can_run_sprint(project_id)
              and not public.general_is_archived(project_id));

drop policy if exists general_sprint_settings_update on public.general_sprint_settings;
create policy general_sprint_settings_update on public.general_sprint_settings
  for update to authenticated
  using (public.general_can_run_sprint(project_id)
         and not public.general_is_archived(project_id))
  with check (public.general_can_run_sprint(project_id)
              and not public.general_is_archived(project_id));

revoke all on public.general_sprint_settings from anon;
grant select, insert, update on public.general_sprint_settings to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.general_sprint_settings;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- the sprint control rule

/**
 * A state change to running or finished needs the project manager or a
 * coordinator. The service role and run_sprint_automation pass too. Moves to
 * planned (a reopen stepping back) are not covered: reopen_general_sprint checks
 * the role itself. Runs as the caller so auth.uid() is theirs.
 */
create or replace function public.guard_sprint_run()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.state is distinct from old.state
     and new.state in ('active', 'completed')
     and auth.uid() is not null
     and coalesce(current_setting('collabify.sprint_automation', true), 'off') <> 'on'
     and not public.general_can_run_sprint(old.project_id) then
    raise exception 'Only the project manager or a coordinator can start or finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sprint_run() from public, anon;

drop trigger if exists general_sprints_run_guard on public.general_sprints;
create trigger general_sprints_run_guard before update on public.general_sprints
  for each row execute function public.guard_sprint_run();

-- ---------------------------------------------------------------- finishing a sprint

/**
 * Finish a running sprint. Unfinished tasks move to p_carry_to, or back to the
 * backlog when it is null. Same as work-planning.sql except that the project
 * manager or a coordinator finishes it, not any manage_tasks holder.
 */
create or replace function public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql set search_path = public as $$
declare
  s public.general_sprints;
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can_run_sprint(s.project_id) then
    raise exception 'Only the project manager or a coordinator can finish a sprint.'
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

commit;
