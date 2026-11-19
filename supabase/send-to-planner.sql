-- supabase/send-to-planner.sql
-- Send to planner: the project manager sends planning tasks straight to
-- themselves or an active coordinator, skipping a team lead. One call releases
-- each task and assigns the holder, so a task is never released without its
-- holder. The team is optional and needs no lead.
--
-- Owns send_work_tasks_to_planner only and redefines nothing. History reuses
-- the sent_to_team kind with holder_id in its detail; the assignee insert fires
-- the usual assignment notice and "assigned" history row. The "sent" workflow
-- rules (project-workflow-rules.sql) are held back during the release with
-- collabify.workflow_rule_run and run by hand after the holder insert.
--
-- Runs after file-history.sql and before anon-lockdown.sql. Idempotent.
begin;

create or replace function public.send_work_tasks_to_planner(p_project uuid, p_rows jsonb, p_holder uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
  destination uuid;
  n int := 0;
  prior_flag text := coalesce(current_setting('collabify.work_task_handoff', true), 'off');
  prior_rule_run text;
begin
  if public.general_role_of(p_project, auth.uid()) is distinct from 'pm' then
    raise exception 'Only the project manager sends work straight to a person.' using errcode = 'insufficient_privilege';
  end if;
  select * into gp from public.general_projects where id = p_project and class_board_id is null
    and archived_at is null and trashed_at is null for share;
  if not found or public.general_is_archived(p_project) then
    raise exception 'This project cannot receive handoffs. Restore it first.' using errcode = 'check_violation';
  end if;
  if p_holder is distinct from auth.uid() then
    perform 1 from public.general_members m join public.profiles pr on pr.id = m.user_id
      where m.project_id = p_project and m.user_id = p_holder and m.role = 'coordinator' and pr.status = 'active'
      for share of m, pr nowait;
    if not found then
      raise exception 'Choose yourself or an active coordinator on this project.' using errcode = 'check_violation';
    end if;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Select tasks to send.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows) = 0 or exists (
    select 1 from jsonb_to_recordset(p_rows) r(id uuid, team_id uuid, updated_at timestamptz)
    group by r.id having r.id is null or count(*) > 1) then
    raise exception 'Select each task once.' using errcode = 'invalid_parameter_value';
  end if;

  -- Check every row first; write only once all of them pass.
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid) on r.id = gt.id
    order by gt.id for update of gt
  loop
    n := n + 1;
    if t.project_id <> p_project or t.archived_at is not null or t.trashed_at is not null then
      raise exception 'Select live tasks in this project.' using errcode = 'check_violation';
    end if;
    if t.updated_at is distinct from (select r.updated_at from jsonb_to_recordset(p_rows) r(id uuid, updated_at timestamptz) where r.id = t.id) then
      raise exception 'A task changed. Reload the tasks and try again.' using errcode = 'serialization_failure';
    end if;
    if t.routing_state <> 'planning' or t.parent_id is not null or public.general_task_held(t.id) then
      raise exception 'Send planning tasks only.' using errcode = 'check_violation';
    end if;
    select r.team_id into destination from jsonb_to_recordset(p_rows) r(id uuid, team_id uuid) where r.id = t.id;
    if destination is not null then
      perform 1 from public.general_teams g
        where g.id = destination and g.project_id = p_project and g.archived_at is null for share of g;
      if not found then
        raise exception 'Choose a live team in this project.' using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  if n <> jsonb_array_length(p_rows) then
    raise exception 'A task changed. Reload the tasks and try again.' using errcode = 'serialization_failure';
  end if;

  perform set_config('collabify.work_task_handoff', 'on', true);
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid) on r.id = gt.id order by gt.id
  loop
    select r.team_id into destination from jsonb_to_recordset(p_rows) r(id uuid, team_id uuid) where r.id = t.id;
    -- Hold the "sent" workflow rules back during the release, so they run once
    -- the holder is in place (an assign rule then sees them; notify holders
    -- reaches them) instead of racing the holder insert below.
    prior_rule_run := coalesce(current_setting('collabify.workflow_rule_run', true), 'off');
    perform set_config('collabify.workflow_rule_run', 'on', true);
    update public.general_tasks set routing_state = 'released', team_id = destination, reviewer_id = null,
      sent_at = clock_timestamp() where id = t.id;
    perform set_config('collabify.workflow_rule_run', prior_rule_run, true);
    insert into public.general_task_events(task_id, project_id, actor_id, kind, detail)
      values(t.id, p_project, auth.uid(), 'sent_to_team',
        jsonb_build_object('actor_id', auth.uid(), 'old_team_id', t.team_id, 'new_team_id', destination,
          'holder_id', p_holder, 'reviewer_id', t.reviewer_id, 'reason', null,
          'former_holder_ids', '[]'::jsonb));
    insert into public.general_task_assignees(task_id, project_id, user_id) values(t.id, p_project, p_holder);
    perform public.run_general_workflow_rules(t.id, 'task_released', auth.uid());
  end loop;
  perform set_config('collabify.work_task_handoff', prior_flag, true);
  return n;
end $$;

revoke all on function public.send_work_tasks_to_planner(uuid, jsonb, uuid) from public, anon;
grant execute on function public.send_work_tasks_to_planner(uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
