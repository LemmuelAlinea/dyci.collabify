-- supabase/project-open-tasks.sql
-- Open task flow: a work project's task flow is either planned handoff (the
-- default, every new task starts in private planning for a planner to send) or
-- open (no review: the project manager, coordinators and Members add live tasks
-- and set anyone who can hold tasks as their holder).
--
-- Owns general_projects.task_flow, guard_general_task_flow and its trigger,
-- set_general_task_flow, preview_general_task_flow, create_general_open_task
-- and set_general_task_holders. Redefines nothing: the task guards keep their
-- rules, and the two writers check the caller themselves, then write with the
-- request's claims cleared (as create_general_member_task does), so the guards
-- take their no-claims branch. Edit rights don't widen; only creating and
-- setting holders do. QA adds bugs only and assigns nobody.
--
-- Only the project manager switches the flow, through set_general_task_flow. A
-- switch to open releases every live top-level planning or review task (their
-- subtasks follow), each with a sent_to_team history row. A switch back moves
-- nothing. Open-created tasks keep sent_at null, so their creator keeps the
-- creator rule (guard_general_task_sent_creator) while nobody holds them.
--
-- Runs after message-mentions.sql and before anon-lockdown.sql. Idempotent.
begin;

-- ---------------------------------------------------------------- column

alter table public.general_projects
  add column if not exists task_flow text not null default 'planned';
alter table public.general_projects drop constraint if exists general_projects_task_flow;
alter table public.general_projects add constraint general_projects_task_flow
  check (task_flow in ('planned', 'open'));

/** A signed-in change of task_flow goes through set_general_task_flow, so its release can't be skipped. */
create or replace function public.guard_general_task_flow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.task_flow is distinct from old.task_flow and auth.uid() is not null
     and coalesce(current_setting('collabify.task_flow_set', true), 'off') <> 'on' then
    raise exception 'Change the task flow in Settings.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists general_projects_task_flow_guard on public.general_projects;
create trigger general_projects_task_flow_guard
  before update of task_flow on public.general_projects
  for each row execute function public.guard_general_task_flow();

-- ---------------------------------------------------------------- switching

/** What a switch to open would release: live top-level tasks in planning and in review. Project manager only. */
create or replace function public.preview_general_task_flow(p_project uuid)
returns table(planning int, review int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.general_role_of(p_project, auth.uid()) is distinct from 'pm' then
    raise exception 'Only the project manager changes the task flow.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select count(*) filter (where t.routing_state = 'planning')::int,
           count(*) filter (where t.routing_state = 'coordinator_review')::int
      from public.general_tasks t
     where t.project_id = p_project and t.parent_id is null
       and t.archived_at is null and t.trashed_at is null
       and t.routing_state in ('planning', 'coordinator_review');
end $$;

/**
 * Sets the project's task flow. To open, releases every live top-level task in
 * planning or review, keeping its team. Returns how many tasks it released.
 */
create or replace function public.set_general_task_flow(p_project uuid, p_flow text)
returns int language plpgsql security definer set search_path = public as $$
declare
  gp public.general_projects%rowtype;
  t public.general_tasks%rowtype;
  n int := 0;
  prior_handoff text := coalesce(current_setting('collabify.work_task_handoff', true), 'off');
begin
  if public.general_role_of(p_project, auth.uid()) is distinct from 'pm' then
    raise exception 'Only the project manager changes the task flow.' using errcode = 'insufficient_privilege';
  end if;
  if p_flow is null or p_flow not in ('planned', 'open') then
    raise exception 'Choose planned handoff or open.' using errcode = 'invalid_parameter_value';
  end if;
  select * into gp from public.general_projects where id = p_project for update;
  if gp.class_board_id is not null then
    raise exception 'Task flow is for work projects.' using errcode = 'check_violation';
  end if;
  if public.general_is_archived(p_project) then
    raise exception '%', public.general_archived_message(p_project) using errcode = 'check_violation';
  end if;
  if gp.task_flow = p_flow then
    return 0;
  end if;

  perform set_config('collabify.task_flow_set', 'on', true);
  update public.general_projects set task_flow = p_flow where id = p_project;
  perform set_config('collabify.task_flow_set', 'off', true);

  if p_flow = 'open' then
    perform set_config('collabify.work_task_handoff', 'on', true);
    for t in select * from public.general_tasks
              where project_id = p_project and parent_id is null
                and archived_at is null and trashed_at is null
                and routing_state in ('planning', 'coordinator_review')
              order by id for update
    loop
      update public.general_tasks set routing_state = 'released', reviewer_id = null,
        sent_at = clock_timestamp() where id = t.id;
      insert into public.general_task_events(task_id, project_id, actor_id, kind, detail)
        values(t.id, p_project, auth.uid(), 'sent_to_team',
          jsonb_build_object('actor_id', auth.uid(), 'old_team_id', t.team_id, 'new_team_id', t.team_id,
            'holder_id', null, 'reviewer_id', t.reviewer_id, 'reason', null,
            'former_holder_ids', '[]'::jsonb));
      n := n + 1;
    end loop;
    perform set_config('collabify.work_task_handoff', prior_handoff, true);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- open writes

/**
 * The caller's role, when they may write to this open project. Refuses with the
 * reason otherwise. Shared by the two open writers; not callable on its own.
 */
create or replace function public.general_open_task_role(p_project uuid)
returns public.general_role language plpgsql stable security definer set search_path = public as $$
declare
  gp public.general_projects%rowtype;
  v_role public.general_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change tasks.' using errcode = 'insufficient_privilege';
  end if;
  select * into gp from public.general_projects where id = p_project;
  v_role := case when gp.id is not null then public.general_role_of(gp.id, auth.uid()) end;
  if v_role is null then
    raise exception 'You are not on this project.' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(gp.id) then
    raise exception 'Stakeholders can view this project but not change it.' using errcode = 'insufficient_privilege';
  end if;
  if gp.class_board_id is not null or gp.task_flow <> 'open' then
    raise exception 'This project uses planned handoff. Ask the project manager to open it.'
      using errcode = 'check_violation';
  end if;
  if public.general_is_archived(gp.id) then
    raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
  end if;
  return v_role;
end $$;

/** Deduplicated holders, each an active project member who can hold tasks, within the one-holder rule. */
create or replace function public.general_open_task_holders(p_project uuid, p_holders uuid[])
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare
  v uuid[] := coalesce((select array_agg(distinct h) from unnest(p_holders) h where h is not null), '{}');
begin
  if exists (select 1 from unnest(v) h
              where not exists (select 1 from public.general_members m
                                  join public.profiles pr on pr.id = m.user_id
                                 where m.project_id = p_project and m.user_id = h
                                   and pr.status = 'active' and m.role not in ('qa', 'stakeholder'))) then
    raise exception 'Choose active project members who can hold tasks.' using errcode = 'check_violation';
  end if;
  if cardinality(v) > 1 and not (select allow_multiple_assignees from public.general_projects where id = p_project) then
    raise exception 'This project allows one holder per task.' using errcode = 'check_violation';
  end if;
  return v;
end $$;

/**
 * Adds a live task to an open project and sets its holders in one step. The
 * project manager, coordinators and Members add tasks or bugs; QA adds bugs
 * with no holders. A task with holders starts in the project's default stage.
 * Returns the new task's id.
 */
create or replace function public.create_general_open_task(
  p_project uuid, p_title text, p_description text, p_starts_at timestamptz, p_due_at timestamptz,
  p_team uuid, p_priority text, p_kind text, p_holders uuid[])
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
      (project_id, title, description, starts_at, due_at, team_id, priority, kind, routing_state, created_by)
    values
      (p_project, v_title, coalesce(p_description, ''), p_starts_at, p_due_at, p_team, p_priority,
       p_kind::public.general_task_kind, 'released', me)
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

/**
 * Replaces a live task's holders in an open project. The project manager,
 * coordinators and Members set anyone who can hold tasks; an empty list clears
 * them. Work in an active QA stage or done must reopen first.
 */
create or replace function public.set_general_task_holders(p_task uuid, p_holders uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  t public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
  v_role public.general_role;
  v_holders uuid[];
  v_prior uuid[];
  n int;
  idx int;
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  select * into t from public.general_tasks where id = p_task for update;
  if t.id is null then
    raise exception 'This task no longer exists.' using errcode = 'check_violation';
  end if;
  v_role := public.general_open_task_role(t.project_id);
  if v_role = 'qa' then
    raise exception 'QA can''t assign tasks.' using errcode = 'insufficient_privilege';
  end if;
  if v_role not in ('pm', 'coordinator', 'member') then
    raise exception 'You can''t assign tasks in this project.' using errcode = 'insufficient_privilege';
  end if;
  if t.routing_state <> 'released' or t.archived_at is not null or t.trashed_at is not null then
    raise exception 'Choose a live task in this project.' using errcode = 'check_violation';
  end if;
  select * into gp from public.general_projects where id = t.project_id;
  n := public.stage_count(gp.stages);
  idx := public.general_task_stage_at(t.status, t.stage, n);
  if t.status = 'done'
     or (public.general_project_has_qa(gp.id) and idx >= public.general_qa_stage_pick(gp.stages, gp.qa_stage)) then
    raise exception 'Reopen it before changing who holds it.' using errcode = 'check_violation';
  end if;
  v_holders := public.general_open_task_holders(t.project_id, p_holders);
  -- Rows without an actor from before this call (a rule's assign) keep it.
  select coalesce(array_agg(e.id), '{}') into v_prior from public.general_task_events e
   where e.task_id = t.id and e.actor_id is null;

  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    delete from public.general_task_assignees a where a.task_id = t.id and a.user_id <> all(v_holders);
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by)
      select t.id, t.project_id, h, me from unnest(v_holders) h
       where not exists (select 1 from public.general_task_assignees a where a.task_id = t.id and a.user_id = h);
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    raise;
  end;
  update public.general_task_events set actor_id = me
   where task_id = t.id and actor_id is null and kind in ('assigned', 'unassigned') and id <> all(v_prior);
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.guard_general_task_flow() from public, anon, authenticated;
revoke all on function public.general_open_task_role(uuid) from public, anon, authenticated;
revoke all on function public.general_open_task_holders(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.preview_general_task_flow(uuid) from public, anon;
revoke all on function public.set_general_task_flow(uuid, text) from public, anon;
revoke all on function public.create_general_open_task(uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid[]) from public, anon;
revoke all on function public.set_general_task_holders(uuid, uuid[]) from public, anon;
grant execute on function public.preview_general_task_flow(uuid) to authenticated;
grant execute on function public.set_general_task_flow(uuid, text) to authenticated;
grant execute on function public.create_general_open_task(uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid[]) to authenticated;
grant execute on function public.set_general_task_holders(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
