-- Collabify — company roles, phase 2: team leaders.
--
--   node scripts/db.mjs supabase/project-team-leads.sql supabase/anon-lockdown.sql
--
-- A work project's team (general_teams) can have one leader. Leading is not a
-- role: the leader keeps whatever role they hold, and leading adds only this:
-- they may edit, assign and unassign tasks held by people on their team. They
-- get no power over other teams' tasks, and changing a task's points still
-- needs manage_tasks.
--
--   - The leader must be on the team and must not be a stakeholder
--     (guard_general_team_leader, on every write, the service role's too).
--   - The project manager or a coordinator picks them (manage_structure):
--     set_general_team_leader(team, user), null clears.
--   - Leaving the team, leaving the project or becoming a stakeholder leaves
--     the team with no leader (clear_general_team_leader).
--   - Every change writes a team_leader event {team_id, team_name, from, to};
--     team_name is the team's name at the time, for the activity log's line.
--   - Teams seeded from a space team start with no leader.
--
-- Class-board Files projects keep the old model: their teams have no leader,
-- and general_leads_user is false there, so the task rules below only gain an
-- allow branch for work projects.
--
-- Runs after project-visibility.sql and everything else in docs/07-backup.md,
-- and redefines from their latest (live) copies: guard_general_task
-- (task-archive.sql), sync_general_task_stage (task-stages.sql),
-- guard_general_task_plan (work-planning.sql),
-- guard_general_structure (general.sql), the general_task_assignees_insert and
-- general_task_assignees_delete policies (general-tasks.sql) and the
-- general_project_events kinds check (project-roles.sql). Re-run it after
-- re-running any of those files, then anon-lockdown.sql.
--
-- guard_general_task_plan (work-planning.sql) lets a leader reorder (rank) a
-- task somebody on their team holds; putting a task in a sprint still needs
-- manage_tasks. Not changed here, on purpose: guard_general_task_child still
-- refuses adding a second holder to a held task for anyone who does not manage
-- tasks, leaders included.
--
-- An archived work project's guards now say the project manager restores it
-- (general_archived_message); a class board's still say an Owner does.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- column

-- No foreign key: a referential action would update general_teams under the
-- caller's auth.uid() and trip guard_general_structure on an archived project.
-- The leader must be on the team, which already ties them to the project.
alter table public.general_teams add column if not exists leader_id uuid;

comment on column public.general_teams.leader_id is
  'The team''s leader, on work projects only. On the team, never a stakeholder. '
  'Leading is not a role (see general_leads_user).';

create index if not exists general_teams_leader_idx
  on public.general_teams (project_id, leader_id) where leader_id is not null;

-- ---------------------------------------------------------------- activity log

alter table public.general_project_events drop constraint if exists general_project_events_kind;
alter table public.general_project_events add constraint general_project_events_kind check (kind in (
  'task_archived', 'task_restored', 'project_status', 'project_archived',
  'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level',
  'member_role', 'pm_handover', 'team_leader'));

-- ---------------------------------------------------------------- the helper

/**
 * True when p_lead leads a team in work project p_project that p_user is on.
 * The lead must be active and not a stakeholder. Answers only somebody who can
 * read the project (or the service role), so it cannot probe other projects.
 */
create or replace function public.general_leads_user(p_project uuid, p_lead uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or coalesce(public.can_read_general_project(p_project), false))
     and exists (
    select 1
      from public.general_teams t
      join public.general_projects gp on gp.id = t.project_id and gp.class_board_id is null
      join public.general_team_members tm on tm.team_id = t.id and tm.user_id = p_user
      -- The lead is on the team too (guard_general_team_leader insists, and
      -- clear_general_team_leader keeps it so; asked here as well).
      join public.general_team_members tl on tl.team_id = t.id and tl.user_id = p_lead
      join public.general_members m on m.project_id = t.project_id and m.user_id = p_lead
      join public.profiles pr on pr.id = p_lead
     where t.project_id = p_project
       and t.leader_id = p_lead
       and m.role <> 'stakeholder'
       and pr.status = 'active'
  );
$$;

/**
 * What the guards say when a project is archived. A work project's project
 * manager restores it; a class board's Files project keeps "an Owner".
 * Not security definer: it is only called from security-definer guards.
 */
create or replace function public.general_archived_message(p_project uuid)
returns text language sql stable set search_path = public as $$
  select case
    when exists (select 1 from public.general_projects
                  where id = p_project and class_board_id is not null)
      then 'This project is archived. An Owner can restore it to make changes.'
    else 'This project is archived. The project manager can restore it to make changes.'
  end;
$$;

-- ---------------------------------------------------------------- who may lead

create or replace function public.guard_general_team_leader()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.leader_id is null
     or (tg_op = 'UPDATE' and new.leader_id is not distinct from old.leader_id) then
    return new;
  end if;
  if exists (select 1 from public.general_projects p
              where p.id = new.project_id and p.class_board_id is not null) then
    raise exception 'Teams in a class board''s files have no leader. Pick leaders for teams in a work project.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.general_team_members tm
                  where tm.team_id = new.id and tm.user_id = new.leader_id) then
    raise exception 'They are not on this team. Add them to the team first, then make them its leader.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_members m
              where m.project_id = new.project_id and m.user_id = new.leader_id
                and m.role = 'stakeholder') then
    raise exception 'A stakeholder cannot lead a team. Pick someone else on the team.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_teams_leader_guard on public.general_teams;
create trigger general_teams_leader_guard
  before insert or update of leader_id on public.general_teams
  for each row execute function public.guard_general_team_leader();

/**
 * A change of leader, however it happened, writes a team_leader event. The
 * team's name goes with it, so the activity log can say which team without
 * reading teams the reader may no longer see.
 */
create or replace function public.log_general_team_leader()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.general_projects where id = new.project_id) then
    return new;
  end if;
  insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
  values (new.project_id, auth.uid(), coalesce(new.leader_id, old.leader_id), 'team_leader',
          jsonb_build_object('team_id', new.id, 'team_name', new.name,
                             'from', old.leader_id, 'to', new.leader_id));
  return new;
end;
$$;

drop trigger if exists general_teams_leader_event on public.general_teams;
create trigger general_teams_leader_event
  after update of leader_id on public.general_teams
  for each row when (old.leader_id is distinct from new.leader_id)
  execute function public.log_general_team_leader();

/**
 * Leaves a team with no leader when its leader leaves it (directly, or by
 * leaving the project, which cascades here) or becomes a stakeholder. Runs on
 * archived projects too: guard_general_structure lets this one update through.
 */
create or replace function public.clear_general_team_leader()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'general_team_members' then
    -- A deleted project or team takes its rows with it; nothing to clear.
    if not exists (select 1 from public.general_projects where id = old.project_id)
       or exists (select 1 from public.general_team_members
                   where team_id = old.team_id and user_id = old.user_id) then
      return null;
    end if;
    perform set_config('collabify.team_leader_clear', 'on', true);
    update public.general_teams set leader_id = null
     where id = old.team_id and leader_id = old.user_id;
    perform set_config('collabify.team_leader_clear', 'off', true);
  else
    perform set_config('collabify.team_leader_clear', 'on', true);
    update public.general_teams set leader_id = null
     where project_id = new.project_id and leader_id = new.user_id;
    perform set_config('collabify.team_leader_clear', 'off', true);
  end if;
  return null;
end;
$$;

drop trigger if exists general_team_members_leader_clear on public.general_team_members;
create trigger general_team_members_leader_clear
  after update or delete on public.general_team_members
  for each row execute function public.clear_general_team_leader();

drop trigger if exists general_members_leader_clear on public.general_members;
create trigger general_members_leader_clear
  after update of role on public.general_members
  for each row when (new.role = 'stakeholder' and old.role is distinct from new.role)
  execute function public.clear_general_team_leader();

/**
 * general.sql's guard, as live, with two changes: clear_general_team_leader's
 * update goes through on an archived project, so a leader can still leave it;
 * and the archived message names the project manager on a work project.
 */
create or replace function public.guard_general_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'general_teams'
     and coalesce(current_setting('collabify.team_leader_clear', true), 'off') = 'on' then
    new.project_id := old.project_id;
    return new;
  end if;
  if auth.uid() is not null and public.general_is_archived(p) then
    raise exception '%', public.general_archived_message(p)
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------- picking a leader

create or replace function public.set_general_team_leader(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.general_teams%rowtype;
begin
  select * into t from public.general_teams where id = p_team for update;
  if t.id is null or not coalesce(public.can_read_general_project(t.project_id), false) then
    raise exception 'That team is not on a project you can see. Refresh the page and pick a team again.'
      using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.general_projects p
              where p.id = t.project_id and p.class_board_id is not null) then
    raise exception 'Teams in a class board''s files have no leader. Pick leaders for teams in a work project.'
      using errcode = 'check_violation';
  end if;
  if not public.general_has(t.project_id, 'manage_structure') then
    raise exception 'Only someone who manages teams can pick a team''s leader.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception '%', public.general_archived_message(t.project_id)
      using errcode = 'check_violation';
  end if;
  if t.leader_id is not distinct from p_user then
    return;
  end if;
  -- guard_general_team_leader checks the person; log_general_team_leader logs it.
  update public.general_teams set leader_id = p_user where id = p_team;
end;
$$;

-- ---------------------------------------------------------------- the lead and tasks

/**
 * task-archive.sql's guard, as live, with two changes: someone who leads a
 * current holder of the task (general_leads_user) may change it like a holder
 * can, and the archived message names the project manager on a work project.
 * Points still need manage_tasks (the weight check below is unchanged).
 */
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
      raise exception '%', public.general_archived_message(new.project_id)
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
    raise exception '%', public.general_archived_message(old.project_id)
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

  -- archive_general_task decides who may archive; while it holds the flag, the
  -- holder rule below would wrongly stop a creator archiving a task somebody took.
  if not public.general_can(old.project_id, 'manage_tasks')
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    if not (
      public.is_general_task_assignee(old.id)
      or (old.created_by = auth.uid() and not public.general_task_held(old.id))
      -- A team leader, for a task somebody on their team holds.
      or exists (
        select 1 from public.general_task_assignees a
         where a.task_id = old.id
           and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
      )
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

/**
 * task-stages.sql's copy, as live. One addition: a team leader may move the
 * stage of a task somebody on their team holds, as guard_general_task allows.
 */
create or replace function public.sync_general_task_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  r record;
begin
  if tg_op = 'UPDATE'
     and new.stage is not distinct from old.stage
     and new.status is not distinct from old.status then
    return new;
  end if;

  select public.stage_count(p.stages) into n
    from public.general_projects p where p.id = new.project_id;

  -- The same people who may change its status: whoever holds it, its creator
  -- while nobody does, a leader of whoever holds it, or someone who manages
  -- tasks.
  if tg_op = 'UPDATE'
     and new.stage is distinct from old.stage
     and auth.uid() is not null
     and not public.general_can(old.project_id, 'manage_tasks')
     and not public.is_general_task_assignee(old.id)
     and not (old.created_by = auth.uid() and not public.general_task_held(old.id))
     and not exists (
       select 1 from public.general_task_assignees a
        where a.task_id = old.id
          and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
     ) then
    raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
      using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.align_task_stage(
    coalesce(n, 3), tg_op = 'INSERT',
    case when tg_op = 'UPDATE' then old.status::text end,
    case when tg_op = 'UPDATE' then old.stage end,
    new.status::text, new.stage);
  new.status := r.status::public.general_task_status;
  new.stage := r.stage;
  return new;
end;
$$;

/**
 * work-planning.sql's guard, as live. One addition: a team leader may change
 * the rank (backlog order) of a task somebody on their team holds. Moving a
 * task into or out of a sprint still needs manage_tasks.
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

-- general-tasks.sql's policies, as live, plus a lead branch: a team leader may
-- assign someone they lead to a task (guard_general_task_child still refuses a
-- task somebody already holds), and unassign someone they lead.
drop policy if exists general_task_assignees_insert on public.general_task_assignees;
create policy general_task_assignees_insert on public.general_task_assignees
  for insert with check (
    (public.general_can(project_id, 'manage_tasks')
     and exists (select 1 from public.profiles p
                  where p.id = general_task_assignees.user_id and p.status <> 'rejected'))
    or (user_id = auth.uid() and public.is_general_member(project_id)
        and not public.general_task_held(task_id))
    or (public.is_general_member(project_id)
        and public.general_leads_user(project_id, auth.uid(), user_id)
        and exists (select 1 from public.profiles p
                     where p.id = general_task_assignees.user_id and p.status <> 'rejected'))
  );

drop policy if exists general_task_assignees_delete on public.general_task_assignees;
create policy general_task_assignees_delete on public.general_task_assignees
  for delete using (
    public.general_can(project_id, 'manage_tasks')
    or user_id = auth.uid()
    or public.general_leads_user(project_id, auth.uid(), user_id)
  );

-- ---------------------------------------------------------------- grants

revoke all on function public.guard_general_team_leader() from public, anon, authenticated;
revoke all on function public.log_general_team_leader() from public, anon, authenticated;
revoke all on function public.clear_general_team_leader() from public, anon, authenticated;
grant execute on function public.general_leads_user(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_general_team_leader(uuid, uuid) to authenticated;

commit;
