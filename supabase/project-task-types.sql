-- Custom work task types. Task and Bug keep their existing kind semantics.
alter table public.general_projects
  add column if not exists task_types text[] not null default '{}';

alter table public.general_tasks
  add column if not exists task_type text;

create or replace function public.guard_general_project_task_types()
returns trigger language plpgsql set search_path = public as $$
declare
  name text;
  seen text[] := '{}';
begin
  if tg_op = 'UPDATE' and new.task_types is not distinct from old.task_types then
    return new;
  end if;
  if auth.uid() is not null and ((tg_op = 'INSERT' and cardinality(new.task_types) > 0)
     or (tg_op = 'UPDATE' and public.general_role_of(new.id, auth.uid()) is distinct from 'pm')) then
    raise exception 'Only the project manager changes task types.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and public.general_is_archived(new.id) then
    raise exception 'Restore the project before changing task types.' using errcode = 'check_violation';
  end if;
  if new.class_board_id is not null and cardinality(new.task_types) > 0 then
    raise exception 'Class board files do not use work task types.' using errcode = 'check_violation';
  end if;
  if cardinality(new.task_types) > 20 then
    raise exception 'Keep at most 20 custom task types.' using errcode = 'check_violation';
  end if;
  foreach name in array new.task_types loop
    if name is null or name <> btrim(name) or char_length(name) not between 1 and 40
       or lower(name) in ('task', 'bug') or lower(name) = any(seen) then
      raise exception 'Use distinct task type names of 1 to 40 characters, apart from Task and Bug.'
        using errcode = 'check_violation';
    end if;
    seen := array_append(seen, lower(name));
  end loop;
  return new;
end $$;

drop trigger if exists general_projects_task_types_guard on public.general_projects;
create trigger general_projects_task_types_guard
  before insert or update of task_types on public.general_projects
  for each row execute function public.guard_general_project_task_types();

create or replace function public.guard_general_task_type()
returns trigger language plpgsql set search_path = public as $$
declare
  project public.general_projects%rowtype;
begin
  if tg_op = 'UPDATE' and new.task_type is not distinct from old.task_type
     and new.kind is not distinct from old.kind and new.project_id = old.project_id then
    return new;
  end if;
  if new.task_type is null then return new; end if;
  select * into project from public.general_projects where id = new.project_id;
  if project.class_board_id is not null or new.kind <> 'task'
     or not (new.task_type = any(project.task_types)) then
    raise exception 'Choose a task type from this project.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists general_tasks_type_guard on public.general_tasks;
create trigger general_tasks_type_guard
  before insert or update of task_type, kind, project_id on public.general_tasks
  for each row execute function public.guard_general_task_type();

revoke all on function public.guard_general_project_task_types(), public.guard_general_task_type()
  from public, anon, authenticated;


drop function if exists public.create_general_member_task(uuid, text, text, timestamptz, uuid);

create or replace function public.create_general_member_task(
  p_project uuid, p_title text, p_description text default '',
  p_due_at timestamptz default null, p_team uuid default null, p_type text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  gp      public.general_projects%rowtype;
  v_role  public.general_role;
  v_title text := btrim(coalesce(p_title, ''));
  v_id    uuid;
  -- Restored after the insert, so the caller's session is as it was.
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  if me is null then
    raise exception 'Sign in to create a task.' using errcode = 'insufficient_privilege';
  end if;
  -- Locked so the switch can't be turned off meanwhile.
  select * into gp from public.general_projects where id = p_project for share;
  v_role := case when gp.id is not null then public.general_role_of(gp.id, me) end;
  if v_role is null then
    raise exception 'You are not on this project.' using errcode = 'insufficient_privilege';
  end if;
  if gp.class_board_id is not null then
    raise exception 'Members create tasks on work projects only.' using errcode = 'check_violation';
  end if;
  if v_role <> 'member' then
    raise exception 'Only members use this. Planners create tasks from Plan.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(gp.id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(gp.id) then
    raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
  end if;
  if not gp.members_create_tasks then
    raise exception 'This project doesn''t let members create tasks.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_title = '' then
    raise exception 'Give the task a title.' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'Keep the task''s title to 200 characters.' using errcode = 'check_violation';
  end if;
  if p_team is not null
     and not exists (select 1 from public.general_teams g
                      where g.id = p_team and g.project_id = gp.id) then
    raise exception 'Choose a team in this project.' using errcode = 'check_violation';
  end if;

  -- general_tasks_guard lets only planners and QA insert work tasks, so the
  -- insert runs as the service role would; the checks above stand in. Without
  -- claims a signed-in insert's planning default isn't applied, so it is named.
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into public.general_tasks
      (project_id, title, description, due_at, team_id, routing_state, created_by, task_type)
    values
      (gp.id, v_title, coalesce(p_description, ''), p_due_at, p_team, 'planning', me, p_type)
    returning id into v_id;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    raise;
  end;

  -- The history's created event ran without claims; it names the caller.
  update public.general_task_events set actor_id = me
   where task_id = v_id and kind = 'created' and actor_id is null;
  return v_id;
end;
$$;

revoke all on function public.create_general_member_task(uuid, text, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.create_general_member_task(uuid, text, text, timestamptz, uuid, text) to authenticated;

drop function if exists public.create_general_open_task(uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid[]);

create or replace function public.create_general_open_task(
  p_project uuid, p_title text, p_description text, p_starts_at timestamptz, p_due_at timestamptz,
  p_team uuid, p_priority text, p_kind text, p_holders uuid[], p_type text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_role public.general_role := public.general_open_task_role(p_project);
  gp public.general_projects%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_holders uuid[];
  v_id uuid;
  n int;
  d int;
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
  prior_rule_run text := coalesce(current_setting('collabify.workflow_rule_run', true), 'off');
begin
  select * into gp from public.general_projects where id = p_project for share;
  if v_role not in ('pm', 'coordinator', 'member', 'qa') then
    raise exception 'You can''t add tasks to this project.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_kind, '') not in ('task', 'bug') then
    raise exception 'Choose task or bug.' using errcode = 'invalid_parameter_value';
  end if;
  if v_role = 'qa' and p_kind <> 'bug' then
    raise exception 'QA creates bug tasks only.' using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'qa' and coalesce(cardinality(p_holders), 0) > 0 then
    raise exception 'QA can''t assign tasks. Leave the holder empty.' using errcode = 'insufficient_privilege';
  end if;
  if v_title = '' then
    raise exception 'Give the task a title.' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'Keep the task''s title to 200 characters.' using errcode = 'check_violation';
  end if;
  if p_team is not null
     and not exists (select 1 from public.general_teams g where g.id = p_team and g.project_id = p_project) then
    raise exception 'Choose a team in this project.' using errcode = 'check_violation';
  end if;
  if p_starts_at is not null and p_due_at is not null and p_starts_at > p_due_at then
    raise exception 'A task cannot start after it is due. Move one of the two dates.' using errcode = 'check_violation';
  end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Choose low, normal, high or urgent.' using errcode = 'invalid_parameter_value';
  end if;
  v_holders := public.general_open_task_holders(p_project, p_holders);

  -- general_tasks_guard turns a signed-in insert into planning and lets only
  -- planners insert, and the assignee guard lets only planners and leads
  -- assign, so both inserts run as the service role would; the checks above
  -- stand in. The holders go in once the task is live, so they're notified.
  n := public.stage_count(gp.stages);
  d := public.general_default_stage(gp.default_stage, n,
         case when public.general_project_has_qa(gp.id)
              then public.general_qa_stage_pick(gp.stages, gp.qa_stage) end);
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into public.general_tasks
      (project_id, title, description, starts_at, due_at, team_id, priority, kind, routing_state, created_by, task_type)
    values
      (p_project, v_title, coalesce(p_description, ''), p_starts_at, p_due_at, p_team, p_priority,
       p_kind::public.general_task_kind, 'released', me, p_type)
    returning id into v_id;
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by)
      select v_id, p_project, h, me from unnest(v_holders) h;
    -- An unheld insert waits in the first stage when a holder is required;
    -- with holders it moves on to the default stage, as a released insert would.
    if cardinality(v_holders) > 0 and d > 0
       and (select public.general_task_stage_at(t.status, t.stage, n) = 0 from public.general_tasks t where t.id = v_id) then
      -- A release fires only the "sent" rules (run below), never the stage it lands in.
      perform set_config('collabify.workflow_rule_run', 'on', true);
      update public.general_tasks set stage = d where id = v_id;
      perform set_config('collabify.workflow_rule_run', prior_rule_run, true);
    end if;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  exception when others then
    perform set_config('collabify.workflow_rule_run', prior_rule_run, true);
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    raise;
  end;
  -- The caller's own writes, not any rule's.
  update public.general_task_events set actor_id = me
   where task_id = v_id and actor_id is null and kind in ('created', 'updated', 'assigned');

  -- The release trigger fires on an update into released only; this task was born live.
  perform public.run_general_workflow_rules(v_id, 'task_released', me);
  return v_id;
end $$;

revoke all on function public.create_general_open_task(uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid[], text) from public, anon;
grant execute on function public.create_general_open_task(uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid[], text) to authenticated;
