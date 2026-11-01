-- supabase/project-member-rules.sql
--
-- A work project's member options: letting Members manage milestones and
-- create tasks.
--
-- Two general_projects columns, both off by default, written through the
-- existing update policy (general_has edit_project, so the project manager):
-- members_manage_milestones and members_create_tasks. "Member" is
-- general_members.role = 'member' (team leads included); QA, stakeholders and
-- workspace viewers get nothing from either switch.
--
-- general_can_manage_milestones(project): manage_tasks (the project manager, a
-- coordinator, a member with the grant), or the milestone switch on and the
-- caller a writing Member. It covers creating, editing, deleting and marking
-- milestones reached. Tagging tasks (general_tasks.milestone_id,
-- guard_general_task_milestone) and linking sprints (general_sprints policies)
-- keep manage_tasks; neither is touched here.
--
-- Redefines the general_milestones insert, update and delete policies (first
-- written by work-milestones.sql) from their live definitions, with
-- general_can_manage_milestones in place of general_can manage_tasks and the
-- archive check kept. guard_general_milestone is not redefined: it never
-- checks manage_tasks. Also redefines release_milestone_tasks (the milestone
-- delete trigger, first written by work-milestones.sql) from its live body:
-- it now untags the milestone's tasks and sprints with the request's claims
-- cleared, so a Member who may delete a milestone isn't stopped by the task
-- tagging and holder guards the untagging reaches.
--
-- create_general_member_task adds a task for a Member while the task switch is
-- on. general_tasks_guard (owned by work-task-handoff.sql, not redefined) lets
-- only planners and QA insert work tasks, so after its own checks the function
-- inserts with the request's JWT claims cleared (as the service role would),
-- created_by set to the caller, and restores them straight after; the history's
-- created event is then given the caller as its actor. The task is always
-- private planning work with no holder, sprint or milestone, in the project's
-- default priority, at the end of the backlog. The release boundary
-- (general_task_readable) gives creators their unsent work only for QA bugs,
-- so a Member does not read their task until a planner sends it.
--
-- Class boards (class_board_id is not null) are untouched.
--
-- Run after project-task-rules.sql, then anon-lockdown.sql. Re-running
-- work-milestones.sql means re-running this file afterwards, then
-- anon-lockdown.sql; otherwise milestones go back to manage_tasks only and a
-- Member's milestone delete is refused once the milestone tags a task.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_projects
  add column if not exists members_manage_milestones boolean not null default false,
  add column if not exists members_create_tasks boolean not null default false;

-- ---------------------------------------------------------------- milestones

/**
 * The caller may create, edit, delete and mark reached the project's
 * milestones: manage_tasks, or a writing Member while the project lets
 * Members manage milestones. Never on an archived project, like general_can.
 */
create or replace function public.general_can_manage_milestones(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.general_can(p_project, 'manage_tasks')
    or (exists (select 1 from public.general_projects gp
                 where gp.id = p_project and gp.class_board_id is null
                   and gp.members_manage_milestones and gp.archived_at is null)
        and public.general_role_of(p_project, auth.uid()) = 'member'
        and public.general_can_write(p_project)),
    false);
$$;

drop policy if exists general_milestones_insert on public.general_milestones;
create policy general_milestones_insert on public.general_milestones
  for insert to authenticated
  with check (public.general_can_manage_milestones(project_id)
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_update on public.general_milestones;
create policy general_milestones_update on public.general_milestones
  for update to authenticated
  using (public.general_can_manage_milestones(project_id)
         and not public.general_is_archived(project_id))
  with check (public.general_can_manage_milestones(project_id)
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_delete on public.general_milestones;
create policy general_milestones_delete on public.general_milestones
  for delete to authenticated
  using (public.general_can_manage_milestones(project_id)
         and not public.general_is_archived(project_id));

/**
 * A deleted milestone leaves its tasks and sprints untagged. The delete policy
 * has already decided who may delete, so the untagging runs as the service
 * role would: a Member who may delete a milestone still may not tag or untag
 * a task (guard_general_task_milestone) or edit tasks they don't hold
 * (general_tasks_guard, which sprint_milestone_retag reaches when a sprint
 * loses the milestone). Sprints are untagged here, under the same cleared
 * claims, before their foreign key would do it as the caller. The request's
 * claims and the archive flag are restored straight after.
 */
create or replace function public.release_milestone_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was          text := current_setting('collabify.general_archive_op', true);
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  begin
    perform set_config('collabify.general_archive_op', 'on', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.general_tasks set milestone_id = null where milestone_id = old.id;
    update public.general_sprints set milestone_id = null where milestone_id = old.id;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.general_archive_op', coalesce(nullif(was, ''), 'off'), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.general_archive_op', coalesce(nullif(was, ''), 'off'), true);
    raise;
  end;
  return old;
end;
$$;

-- ---------------------------------------------------------------- member tasks

/**
 * Adds a private planning task for a Member while the project lets Members
 * create tasks. p_team, when given, is one of the project's teams (a
 * suggestion for the planners; nothing is sent). Returns the task's id.
 */
create or replace function public.create_general_member_task(
  p_project uuid, p_title text, p_description text default '',
  p_due_at timestamptz default null, p_team uuid default null)
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
      (project_id, title, description, due_at, team_id, routing_state, created_by)
    values
      (gp.id, v_title, coalesce(p_description, ''), p_due_at, p_team, 'planning', me)
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

-- ---------------------------------------------------------------- grants

-- The milestone policies call the helper as the signed-in caller.
revoke all on function public.general_can_manage_milestones(uuid) from public, anon;
grant execute on function public.general_can_manage_milestones(uuid) to authenticated;
revoke all on function public.create_general_member_task(uuid, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.create_general_member_task(uuid, text, text, timestamptz, uuid) to authenticated;
revoke all on function public.release_milestone_tasks() from public, anon;

commit;
