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
-- that has set collabify.sprint_automation to on (run_sprint_automation), and a
-- reopen, which already checks the role.
--
-- run_sprint_automation() runs every 15 minutes (pg_cron job
-- collabify-sprint-automation). For each project that asks, in Manila time and
-- once the day's set time is reached, it finishes a running sprint the day after
-- it ends, creates the next sprint when nothing is planned, and starts the
-- earliest planned sprint once its day comes. The project manager and
-- coordinators get a sprint_automation notification for each finish, create and
-- start. A missed run catches up the next time.
--
-- Redefines complete_general_sprint (first written by work-planning.sql) to
-- check general_can_run_sprint. Run after sprint-reopen.sql. Re-running
-- work-planning.sql or sprint-reopen.sql means re-running this file after it.
--
-- Idempotent. Safe to re-run.

-- A new enum value must be committed before anything can use it.
begin;
do $$
begin
  alter type public.notification_type add value if not exists 'sprint_automation';
end $$;
commit;

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

-- The finished sprint run_sprint_automation last created a successor for, or
-- decided not to (the start would pass the project due date). Written by the
-- job only.
alter table public.general_sprint_settings add column if not exists auto_created_after uuid;

-- The job runs every quarter hour, so the set time falls on one.
do $$ begin
  alter table public.general_sprint_settings add constraint general_sprint_settings_run_at
    check (extract(minute from run_at) in (0, 15, 30, 45) and extract(second from run_at) = 0);
exception when duplicate_object then null; end $$;

/**
 * Stamps who saved and when, and keeps auto_start_since in step with auto_start:
 * set when it turns on, cleared when it turns off, never taken from the client.
 * auto_created_after is never taken from the client either. A write from
 * run_sprint_automation (collabify.sprint_automation on) is left as it is.
 */
create or replace function public.prepare_sprint_settings()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('collabify.sprint_automation', true), 'off') = 'on' then
    return new;
  end if;
  new.auto_created_after := case when tg_op = 'UPDATE' then old.auto_created_after end;
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

-- ---------------------------------------------------------------- sprint automation

/**
 * The day a new sprint starts: the project's start day (its setting, else the
 * weekday its first sprint started on, else Monday) on or after the day after
 * its last sprint ends, or on or after p_today once that has passed.
 */
create or replace function public.general_next_sprint_start(p_project uuid, p_today date)
returns date language sql stable security definer set search_path = public as $$
  with d as (
    select greatest((select max(ends_on) + 1 from public.general_sprints where project_id = p_project),
                    p_today) as base,
           coalesce((select start_weekday from public.general_sprint_settings
                      where project_id = p_project),
                    (select extract(dow from starts_on)::int from public.general_sprints
                      where project_id = p_project order by starts_on, created_at limit 1),
                    1) as weekday
  )
  select base + (weekday - extract(dow from base)::int + 7) % 7 from d;
$$;

revoke all on function public.general_next_sprint_start(uuid, date) from public, anon, authenticated;

/** Tells the project manager and active coordinators what the job just did. */
create or replace function public.notify_sprint_automation(p_project uuid, p_title text, p_preview text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select m.user_id, 'sprint_automation'::public.notification_type, p_project, p_title, p_preview
    from public.general_members m
    join public.profiles pr on pr.id = m.user_id
   where m.project_id = p_project and m.role in ('pm', 'coordinator') and pr.status = 'active';
end;
$$;

revoke all on function public.notify_sprint_automation(uuid, text, text) from public, anon, authenticated;

/**
 * Finish, create and start sprints for every work project that asks, or only
 * p_project. Per project, in Manila time, in this order:
 * - create: with auto start on and nothing planned, once for each finished
 *   sprint since auto start was turned on (the one finishing now, else the
 *   latest one while nothing runs). auto_created_after records it, so a
 *   deleted sprint is not made again. Never one that would start after the
 *   project due date; that finished sprint counts as handled all the same.
 *   It comes first so carried tasks have somewhere to go.
 * - finish: the running sprint, from the set time on the day after its end
 *   date, or any time later if a run was missed. Unfinished tasks go to the
 *   earliest planned sprint (carry next) or back to the backlog (carry
 *   backlog, or nothing planned).
 * - start: with auto start on and nothing running, the earliest planned
 *   sprint, from the set time on its start date, or any time later if a run
 *   was missed.
 * The project manager and active coordinators get a notice for each. Each
 * project runs in its own block, so one that fails is logged and skipped.
 * Running again with the same p_now changes nothing. Returns how many projects
 * changed. p_now and p_project let the tests set the clock and keep to their
 * own projects.
 */
drop function if exists public.run_sprint_automation(timestamptz);

create or replace function public.run_sprint_automation(p_now timestamptz default now(),
                                                        p_project uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  was       text := current_setting('collabify.sprint_automation', true);
  today     date := (p_now at time zone 'Asia/Manila')::date;
  cfg       record;
  running   public.general_sprints;
  nxt       public.general_sprints;
  made      public.general_sprints;
  due       boolean;
  finishing boolean;
  changed   boolean;
  handled   uuid;
  starts    date;
  target    uuid;
  moved     int;
  total     int := 0;
begin
  perform set_config('collabify.sprint_automation', 'on', true);

  for cfg in
    select s.*, p.ends_on as due_on
      from public.general_sprint_settings s
      join public.general_projects p on p.id = s.project_id
     where (s.auto_finish or s.auto_start)
       and p.archived_at is null and p.class_board_id is null
       and (p_project is null or s.project_id = p_project)
     order by s.project_id
  loop
    begin
      perform pg_advisory_xact_lock(hashtext('sprint-automation:' || cfg.project_id));
      changed := false;
      due := (p_now at time zone 'Asia/Manila')::time >= cfg.run_at;

      select * into running from public.general_sprints
       where project_id = cfg.project_id and state = 'active';
      finishing := found and cfg.auto_finish
                   and (running.ends_on < today - 1 or (running.ends_on < today and due));

      handled := null;
      if finishing then
        handled := running.id;
      elsif running.id is null then
        select id into handled from public.general_sprints
         where project_id = cfg.project_id and state = 'completed'
           and completed_at >= cfg.auto_start_since
         order by completed_at desc, created_at desc limit 1;
      end if;

      if cfg.auto_start and handled is not null
         and handled is distinct from cfg.auto_created_after
         and not exists (select 1 from public.general_sprints
                          where project_id = cfg.project_id and state = 'planned') then
        starts := public.general_next_sprint_start(cfg.project_id, today);
        if cfg.due_on is null or starts <= cfg.due_on then
          insert into public.general_sprints (project_id, name, starts_on, ends_on)
          select cfg.project_id, 'Sprint ' || (count(*) + 1), starts, starts + cfg.length_days - 1
            from public.general_sprints where project_id = cfg.project_id
          returning * into made;
          perform public.notify_sprint_automation(cfg.project_id,
            made.name || ' was created on its own',
            'It runs ' || to_char(made.starts_on, 'Mon FMDD') || ' to '
              || to_char(made.ends_on, 'Mon FMDD, YYYY') || '.');
          changed := true;
        end if;
        update public.general_sprint_settings set auto_created_after = handled
         where project_id = cfg.project_id;
      end if;

      if finishing then
        target := null;
        if cfg.carry = 'next' then
          select id into target from public.general_sprints
           where project_id = cfg.project_id and state = 'planned'
           order by starts_on, created_at limit 1;
        end if;

        -- As complete_general_sprint: archived unfinished tasks stay behind.
        update public.general_tasks set sprint_id = target
         where sprint_id = running.id and status <> 'done' and archived_at is null;
        get diagnostics moved = row_count;

        update public.general_sprints set state = 'completed' where id = running.id;

        perform public.notify_sprint_automation(cfg.project_id,
          running.name || ' finished on its own',
          case when moved = 0 then 'Every task was done.'
               else moved || ' unfinished ' || case when moved = 1 then 'task' else 'tasks' end
                    || coalesce(' moved to ' || (select name from public.general_sprints where id = target),
                                ' returned to the backlog') || '.'
          end);
        changed := true;
      end if;

      if cfg.auto_start
         and not exists (select 1 from public.general_sprints
                          where project_id = cfg.project_id and state = 'active') then
        select * into nxt from public.general_sprints
         where project_id = cfg.project_id and state = 'planned'
         order by starts_on, created_at limit 1;
        if found and (nxt.starts_on < today or (nxt.starts_on = today and due)) then
          update public.general_sprints set state = 'active' where id = nxt.id;
          perform public.notify_sprint_automation(cfg.project_id,
            nxt.name || ' started on its own',
            to_char(nxt.starts_on, 'Mon FMDD') || ' to ' || to_char(nxt.ends_on, 'Mon FMDD, YYYY'));
          changed := true;
        end if;
      end if;

      if changed then
        total := total + 1;
      end if;
    exception when others then
      raise warning 'Sprint automation skipped project %: %', cfg.project_id, sqlerrm;
    end;
  end loop;

  perform set_config('collabify.sprint_automation', coalesce(nullif(was, ''), 'off'), true);
  return total;
end;
$$;

revoke all on function public.run_sprint_automation(timestamptz, uuid) from public, anon, authenticated;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-sprint-automation');
exception when others then null; end $$;

-- Every 15 minutes, so a sprint finishes or starts within a quarter hour of its set time.
select cron.schedule(
  'collabify-sprint-automation',
  '*/15 * * * *',
  $cron$ select public.run_sprint_automation() $cron$
);

commit;
