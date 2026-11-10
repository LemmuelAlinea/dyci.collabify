-- supabase/sprint-organization.sql
--
-- How a work project organizes its sprints: Sequential (one at a time, the
-- default), Multiple sprint streams (one at a time per team) or Flexible
-- parallel (any number at once). Spec:
-- docs/superpowers/specs/2026-11-03-sprint-organization-design.md.
--
-- Adds general_sprint_settings.organization and, on general_sprints, team_id
-- and the columns only the automation writes (auto_start_blocked_reason,
-- auto_start_blocked_at, next_auto_created). Drops the project-wide
-- general_sprints_one_running index: check_general_sprint_start replaces it
-- under one advisory lock per project. Class boards are untouched and keep
-- board_sprints_one_running.
--
-- Final owner of (redefined from their live definitions):
--   general_can_run_sprint(uuid, uuid)  new overload; the one-argument form stays
--                                       and still decides who changes settings
--   guard_sprint_run                    was sprint-settings.sql
--   guard_general_task_plan             was project-stakeholders.sql
--   reopen_general_sprint               was sprint-reopen.sql
--   complete_general_sprint             was project-notification-rules.sql
--   notify_general_sprint_completed     was project-notification-rules.sql
--   run_sprint_automation               was project-notification-rules.sql
--   send_project_reminders              was project-notification-rules.sql
--   policy general_sprints_update       was work-planning.sql
--
-- Runs after space-roles.sql and before anon-lockdown.sql. Re-running any file
-- named above, or work-planning.sql (which would bring the old index back),
-- means re-running this one afterwards.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_sprint_settings
  add column if not exists organization text not null default 'sequential';

do $$ begin
  alter table public.general_sprint_settings add constraint general_sprint_settings_organization
    check (organization in ('sequential', 'streams', 'parallel'));
exception when duplicate_object then null; end $$;

alter table public.general_sprints add column if not exists team_id uuid;
alter table public.general_sprints add column if not exists auto_start_blocked_reason text;
alter table public.general_sprints add column if not exists auto_start_blocked_at timestamptz;
alter table public.general_sprints add column if not exists next_auto_created boolean not null default false;

do $$ begin
  alter table public.general_sprints add constraint general_sprints_team_fk
    foreign key (team_id, project_id) references public.general_teams (id, project_id)
    on delete set null (team_id);
exception when duplicate_object then null; end $$;

create index if not exists general_sprints_team_idx
  on public.general_sprints (team_id) where team_id is not null;

-- The single "created after" memory moves to the sprint it points at.
update public.general_sprints s
   set next_auto_created = true
  from public.general_sprint_settings g
 where g.auto_created_after = s.id and not s.next_auto_created;

drop index if exists public.general_sprints_one_running;

-- ---------------------------------------------------------------- helpers

/** The project's mode; a project with no settings row is sequential. */
create or replace function public.general_sprint_organization(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select organization from public.general_sprint_settings
                    where project_id = p_project), 'sequential');
$$;

revoke all on function public.general_sprint_organization(uuid) from public, anon;
grant execute on function public.general_sprint_organization(uuid) to authenticated;

/**
 * May the caller run this sprint: the project manager and coordinators, and in
 * streams the active lead of the sprint's team.
 */
create or replace function public.general_can_run_sprint(p_project uuid, p_sprint uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_can_run_sprint(p_project)
      or (public.general_sprint_organization(p_project) = 'streams'
          and exists (
            select 1
              from public.general_sprints s
              join public.general_teams t on t.id = s.team_id and t.project_id = s.project_id
              join public.general_members m on m.project_id = t.project_id and m.user_id = t.leader_id
              join public.profiles pr on pr.id = t.leader_id
             where s.id = p_sprint and s.project_id = p_project
               and t.leader_id = auth.uid() and t.archived_at is null
               and m.role <> 'stakeholder' and pr.status = 'active'));
$$;

revoke all on function public.general_can_run_sprint(uuid, uuid) from public, anon;
grant execute on function public.general_can_run_sprint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- who runs a sprint

create or replace function public.guard_sprint_run()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.state is distinct from old.state
     and new.state in ('active', 'completed')
     and auth.uid() is not null
     and coalesce(current_setting('collabify.sprint_automation', true), 'off') <> 'on'
     and not public.general_can_run_sprint(old.project_id, old.id) then
    if public.general_sprint_organization(old.project_id) = 'streams' then
      raise exception 'Only the project manager, a coordinator or this team''s lead can start or finish this sprint.'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Only the project manager or a coordinator can start or finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sprint_run() from public, anon;

-- A team's lead runs its sprint without the manage_tasks grant. The trigger
-- below keeps them to the state change.
drop policy if exists general_sprints_update on public.general_sprints;
create policy general_sprints_update on public.general_sprints
  for update to authenticated
  using ((public.general_can(project_id, 'manage_tasks') or public.general_can_run_sprint(project_id, id))
         and not public.general_is_archived(project_id))
  with check ((public.general_can(project_id, 'manage_tasks') or public.general_can_run_sprint(project_id, id))
              and not public.general_is_archived(project_id));

-- ---------------------------------------------------------------- how many can run

/**
 * Starting a sprint, by a person or by the job. One lock per project, so two
 * starts cannot both pass. general_sprints_start_rules runs after the state
 * order and rights guards.
 */
create or replace function public.check_general_sprint_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_organization text;
  v_other        text;
  v_team         text;
  v_foreign      int;
begin
  if not (old.state = 'planned' and new.state = 'active') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('sprint-organization:' || new.project_id));
  v_organization := public.general_sprint_organization(new.project_id);

  if v_organization = 'parallel' then
    return new;
  end if;

  if v_organization = 'sequential' then
    select name into v_other from public.general_sprints
     where project_id = new.project_id and state = 'active' and id <> new.id
     limit 1;
    if found then
      raise exception 'Finish % first.', v_other using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.team_id is null then
    raise exception 'Give this sprint a team first.' using errcode = 'check_violation';
  end if;

  select s.name, t.name into v_other, v_team
    from public.general_sprints s
    join public.general_teams t on t.id = s.team_id
   where s.project_id = new.project_id and s.team_id = new.team_id
     and s.state = 'active' and s.id <> new.id
   limit 1;
  if found then
    raise exception '% is already running %.', v_team, v_other using errcode = 'check_violation';
  end if;

  select count(*) into v_foreign from public.general_tasks t
   where t.sprint_id = new.id and t.status <> 'done'
     and t.archived_at is null and t.trashed_at is null
     and t.team_id is distinct from new.team_id;
  if v_foreign = 1 then
    raise exception '1 task in this sprint belongs to another team. Move it out first.'
      using errcode = 'check_violation';
  elsif v_foreign > 1 then
    raise exception '% tasks in this sprint belong to another team. Move them out first.', v_foreign
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.check_general_sprint_start() from public, anon, authenticated;

drop trigger if exists general_sprints_start_rules on public.general_sprints;
create trigger general_sprints_start_rules before update of state on public.general_sprints
  for each row execute function public.check_general_sprint_start();

-- ---------------------------------------------------------------- switching modes

/** Only a real change of mode is checked, so saving other settings still works. */
create or replace function public.guard_sprint_organization()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if new.organization = public.general_sprint_organization(new.project_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('sprint-organization:' || new.project_id));

  if new.organization <> 'sequential' and exists (
    select 1 from public.general_projects p
     where p.id = new.project_id and p.class_board_id is not null
  ) then
    raise exception 'Class boards keep their own sprints.' using errcode = 'check_violation';
  end if;

  if new.organization = 'streams' then
    select name into v_name from public.general_sprints
     where project_id = new.project_id and state = 'active' and team_id is null
     limit 1;
    if found then
      raise exception 'Give % a team first.', v_name using errcode = 'check_violation';
    end if;

    select s.name into v_name from public.general_sprints s
     where s.project_id = new.project_id and s.state = 'active'
       and exists (select 1 from public.general_tasks t
                    where t.sprint_id = s.id and t.status <> 'done'
                      and t.archived_at is null and t.trashed_at is null
                      and t.team_id is distinct from s.team_id)
     limit 1;
    if found then
      raise exception '% holds tasks of other teams. Move them out first.', v_name
        using errcode = 'check_violation';
    end if;
  elsif new.organization = 'sequential'
    and (select count(*) from public.general_sprints
          where project_id = new.project_id and state = 'active') > 1 then
    raise exception 'Finish all but one running sprint first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sprint_organization() from public, anon, authenticated;

drop trigger if exists general_sprint_settings_organization on public.general_sprint_settings;
create trigger general_sprint_settings_organization
  before insert or update of organization on public.general_sprint_settings
  for each row execute function public.guard_sprint_organization();

-- ---------------------------------------------------------------- a sprint's team

/**
 * A sprint's team, and the columns only the job writes. A planned sprint changes
 * team only while empty; a running or finished one keeps it. A team that was
 * deleted or archived releases its sprints. A lead without manage_tasks reaches
 * this table only to run the sprint, so nothing else may change with it.
 */
create or replace function public.guard_general_sprint_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_person   boolean := auth.uid() is not null
                        and coalesce(current_setting('collabify.sprint_automation', true), 'off') <> 'on';
  v_streams  boolean := public.general_sprint_organization(new.project_id) = 'streams';
  v_released boolean := false;
begin
  if tg_op = 'INSERT' then
    if v_person then
      new.auto_start_blocked_reason := null;
      new.auto_start_blocked_at := null;
      new.next_auto_created := false;
    end if;
    if new.team_id is null and v_streams then
      raise exception 'Choose the team this sprint is for.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.general_teams t
                where t.id = new.team_id and t.archived_at is not null) then
      raise exception 'Restore that team before planning a sprint for it.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if v_person then
    new.auto_start_blocked_reason := old.auto_start_blocked_reason;
    new.auto_start_blocked_at := old.auto_start_blocked_at;
    new.next_auto_created := old.next_auto_created;
  end if;
  if old.state = 'planned' and new.state = 'active' then
    new.auto_start_blocked_reason := null;
    new.auto_start_blocked_at := null;
  end if;

  if new.team_id is distinct from old.team_id then
    v_released := new.team_id is null and not exists (
      select 1 from public.general_teams t where t.id = old.team_id and t.archived_at is null);
    if not v_released then
      if old.state <> 'planned' then
        raise exception 'A running or finished sprint keeps its team.' using errcode = 'check_violation';
      end if;
      if exists (select 1 from public.general_tasks t where t.sprint_id = old.id) then
        raise exception 'Move its tasks out first.' using errcode = 'check_violation';
      end if;
      if new.team_id is null and v_streams then
        raise exception 'Choose the team this sprint is for.' using errcode = 'check_violation';
      end if;
      if exists (select 1 from public.general_teams t
                  where t.id = new.team_id and t.archived_at is not null) then
        raise exception 'Restore that team before planning a sprint for it.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- pg_trigger_depth: a foreign key clearing a milestone or team is not an edit.
  if v_person and pg_trigger_depth() = 1
     and coalesce(current_setting('collabify.sprint_reopen', true), 'off') <> 'on'
     and not public.general_can(old.project_id, 'manage_tasks')
     and (new.name, new.goal, new.starts_on, new.ends_on, new.milestone_id, new.archived, new.team_id)
         is distinct from (old.name, old.goal, old.starts_on, old.ends_on, old.milestone_id, old.archived, old.team_id) then
    raise exception 'Only someone who manages tasks can change a sprint.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_sprint_team() from public, anon, authenticated;

drop trigger if exists general_sprints_team_guard on public.general_sprints;
create trigger general_sprints_team_guard before insert or update on public.general_sprints
  for each row execute function public.guard_general_sprint_team();

-- ---------------------------------------------------------------- archiving a team

create or replace function public.guard_general_team_archive_sprint()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if new.archived_at is not null and old.archived_at is null then
    select name into v_name from public.general_sprints
     where team_id = old.id and state = 'active' limit 1;
    if found then
      raise exception 'Finish % first.', v_name using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_team_archive_sprint() from public, anon, authenticated;

drop trigger if exists general_team_archive_sprint_guard on public.general_teams;
create trigger general_team_archive_sprint_guard before update of archived_at on public.general_teams
  for each row execute function public.guard_general_team_archive_sprint();

/** An archived team's planned sprints wait for a new team. */
create or replace function public.release_archived_team_sprints()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.general_sprints set team_id = null
     where team_id = new.id and state = 'planned';
  end if;
  return null;
end;
$$;

revoke all on function public.release_archived_team_sprints() from public, anon, authenticated;

drop trigger if exists general_team_archive_release_sprints on public.general_teams;
create trigger general_team_archive_release_sprints after update of archived_at on public.general_teams
  for each row execute function public.release_archived_team_sprints();

-- ---------------------------------------------------------------- tasks in a team's sprint

/**
 * In streams a sprint holds only its team's tasks. A task joins only its own
 * team's sprint. An open task whose team changes goes back to the backlog, and
 * its history says so; Done and archived tasks stay, so the sprint's record
 * stays whole. Named to run after general_tasks_plan_guard, which must not take
 * this move for a person planning the task.
 */
create or replace function public.keep_general_task_in_team_sprint()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sprint public.general_sprints;
  v_team   text;
begin
  if new.sprint_id is null
     or public.general_sprint_organization(new.project_id) <> 'streams' then
    return new;
  end if;

  select * into v_sprint from public.general_sprints where id = new.sprint_id;

  if tg_op = 'UPDATE' and new.sprint_id is not distinct from old.sprint_id then
    if new.team_id is not distinct from old.team_id
       or new.status = 'done' or new.archived_at is not null or new.trashed_at is not null
       or v_sprint.team_id is null or v_sprint.state = 'completed'
       or new.team_id is not distinct from v_sprint.team_id then
      return new;
    end if;
    new.sprint_id := null;
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'updated',
            jsonb_build_object('status', new.status, 'fields', jsonb_build_array('sprint_id'),
                               'sprint_from', v_sprint.name, 'reason', 'team_changed'));
    return new;
  end if;

  if new.team_id is null then
    raise exception 'Give the task a team before planning it into a sprint.' using errcode = 'check_violation';
  end if;
  if v_sprint.team_id is null then
    raise exception 'Give this sprint a team first.' using errcode = 'check_violation';
  end if;
  if new.team_id is distinct from v_sprint.team_id then
    select name into v_team from public.general_teams where id = v_sprint.team_id;
    raise exception 'This sprint is for %. Move the task to that team''s sprint.', v_team
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_general_task_in_team_sprint() from public, anon, authenticated;

drop trigger if exists general_tasks_sprint_team on public.general_tasks;
create trigger general_tasks_sprint_team before insert or update of sprint_id, team_id on public.general_tasks
  for each row execute function public.keep_general_task_in_team_sprint();

-- ---------------------------------------------------------------- finishing moves work for a lead

/**
 * As project-stakeholders.sql, live; one change: while complete_general_sprint
 * is moving a finished sprint's work (collabify.sprint_finish set) a team lead
 * passes the manage_tasks rule, because finishing is theirs in streams.
 */
create or replace function public.guard_general_task_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_general_member(new.project_id) and not public.general_can_write(new.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

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
     and coalesce(current_setting('collabify.sprint_finish', true), '') = ''
     and (new.sprint_id is distinct from old.sprint_id
          or (new.rank is distinct from old.rank
              -- A team leader reorders tasks somebody on their team holds.
              and not exists (
                select 1 from public.general_task_assignees a
                 where a.task_id = old.id
                   and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
              )))
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

-- ---------------------------------------------------------------- finishing a sprint

/**
 * Finish a running sprint. Unfinished tasks move to p_carry_to, or back to the
 * backlog when it is null. Definer rights, because a team's lead finishes it
 * without the task rights the move needs; general_can_run_sprint is the gate.
 */
create or replace function public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.general_sprints;
  v_arc text := current_setting('collabify.general_archive_op', true);
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can_run_sprint(s.project_id, s.id) then
    if public.general_sprint_organization(s.project_id) = 'streams' then
      raise exception 'Only the project manager, a coordinator or this team''s lead can finish a sprint.'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Only the project manager or a coordinator can finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(s.project_id) then
    raise exception '%', public.general_archived_message(s.project_id) using errcode = 'check_violation';
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

  -- The sprint team and the counts as the sprint ends, before work moves.
  perform set_config('collabify.sprint_finish', p_sprint::text, true);
  perform public.notify_general_sprint_completed(p_sprint, p_carry_to);

  -- Archived unfinished tasks stay in the finished sprint on purpose.
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set sprint_id = p_carry_to
   where sprint_id = p_sprint and status <> 'done' and archived_at is null;
  perform set_config('collabify.general_archive_op', coalesce(nullif(v_arc, ''), 'off'), true);
  perform set_config('collabify.sprint_finish', '', true);

  update public.general_sprints set state = 'completed' where id = p_sprint;
end;
$$;

revoke all on function public.complete_general_sprint(uuid, uuid) from public, anon;
grant execute on function public.complete_general_sprint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- reopening a sprint

create or replace function public.reopen_general_sprint(p_sprint uuid)
returns void language plpgsql set search_path = public as $$
declare
  s public.general_sprints;
  was text := current_setting('collabify.sprint_reopen', true);
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can_run_sprint(s.project_id, s.id) then
    raise exception 'Only the project manager or a coordinator can run a finished sprint again.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'completed' then
    raise exception 'Only a finished sprint can run again.' using errcode = 'check_violation';
  end if;

  perform set_config('collabify.sprint_reopen', 'on', true);

  update public.general_sprints set state = 'planned'
   where project_id = s.project_id and state = 'active';

  update public.general_sprints set state = 'active', archived = false
   where id = p_sprint;
  if not found then
    raise exception 'That sprint could not run again. Reload the page and try again.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.sprint_reopen', coalesce(nullif(was, ''), 'off'), true);
end;
$$;

revoke all on function public.reopen_general_sprint(uuid) from public, anon;
grant execute on function public.reopen_general_sprint(uuid) to authenticated;

commit;
