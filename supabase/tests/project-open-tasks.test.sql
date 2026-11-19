-- supabase/tests/project-open-tasks.test.sql
-- The open task flow: only the project manager switches it, switching to Open
-- releases waiting work, and in an Open project the project manager,
-- coordinators and Members add live tasks and set anyone as holder. QA adds
-- bugs only, stakeholders nothing, and edit rights don't widen. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/project-open-tasks.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

/** Runs a statement and asserts it is refused with a message containing the needle. */
create or replace function pg_temp.refuse(p_label text, p_sql text, p_needle text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS %', p_label;
      return;
    end if;
    raise exception 'FAIL % (refused for another reason: %)', p_label, sqlerrm;
  end;
  raise exception 'FAIL % (not refused)', p_label;
end $$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 coordinator, 3 member A, 4 member B, 5 qa, 6 stakeholder
  p uuid; q uuid; team uuid;
  t_plan1 uuid; t_plan2 uuid; t_review uuid; t_arch uuid;
  t_open uuid; t_bare uuid; t_bug uuid; t_qa uuid; t_done uuid; t_after uuid; t_rule uuid; t_direct uuid; t_stage uuid; e_rule uuid;
  n int; pl int; rv int;
begin
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-open-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_manage_projects)
      values(u[k], 'zz-open-'||k||'@example.test', 'Open', k::text, 'member', 'active', k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz open flow', '')).id;
  q := (public.create_general_project('Zz planned flow', '')).id;

  perform pg_temp.service();
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'qa'), (p, u[6], 'stakeholder'),
    (q, u[3], 'member'), (q, u[4], 'member');
  update public.general_projects
     set stages = array['To do', 'Doing', 'Testing', 'Revision', 'Done'], qa_stage = 'Testing',
         default_stage = 1, require_assignee = true
   where id = p;
  insert into public.general_teams(project_id, name) values(p, 'Zz team') returning id into team;
  update public.notification_prefs set task_assignments = true where user_id in (u[3], u[4]);
  update public.general_projects set task_assignment_notices = true where id = p;

  perform pg_temp.check('default planned',
    (select task_flow = 'planned' from public.general_projects where id = p));

  -- Waiting work: two planning tasks, one in coordinator review, one archived.
  perform pg_temp.act_as(u[1]);
  insert into public.general_tasks(project_id, title, team_id) values(p, 'Zz plan 1', team) returning id into t_plan1;
  insert into public.general_tasks(project_id, title) values(p, 'Zz plan 2') returning id into t_plan2;
  insert into public.general_tasks(project_id, title) values(p, 'Zz review') returning id into t_review;
  insert into public.general_tasks(project_id, title) values(p, 'Zz archived') returning id into t_arch;
  perform pg_temp.service();
  update public.general_tasks set routing_state = 'coordinator_review', reviewer_id = u[2] where id = t_review;
  update public.general_tasks set archived_at = now(), archived_by = u[1] where id = t_arch;

  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('direct update refused',
    format('update public.general_projects set task_flow = %L where id = %L', 'open', p), 'Change the task flow in Settings');
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('coordinator can''t switch',
    format('select public.set_general_task_flow(%L, %L)', p, 'open'), 'Only the project manager');
  perform pg_temp.refuse('member can''t open-create in a planned project',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      p, 'Zz early', '', 'task', '{}'), 'This project uses planned handoff');

  perform pg_temp.act_as(u[1]);
  select planning, review into pl, rv from public.preview_general_task_flow(p);
  perform pg_temp.check('preview counts', pl = 2 and rv = 1);

  n := public.set_general_task_flow(p, 'open');
  perform pg_temp.service();
  perform pg_temp.check('switch releases', n = 3
    and (select task_flow = 'open' from public.general_projects where id = p)
    and (select bool_and(routing_state = 'released' and reviewer_id is null and sent_at is not null)
           from public.general_tasks where id in (t_plan1, t_plan2, t_review))
    and (select team_id = team from public.general_tasks where id = t_plan1)
    and (select count(*) = 3 from public.general_task_events
          where task_id in (t_plan1, t_plan2, t_review) and kind = 'sent_to_team' and actor_id = u[1]));
  perform pg_temp.check('switch skips archived',
    (select routing_state = 'planning' from public.general_tasks where id = t_arch));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('same value is a no-op', public.set_general_task_flow(p, 'open') = 0);

  -- A Member adds a live task with a holder and a priority.
  perform pg_temp.act_as(u[3]);
  t_open := public.create_general_open_task(p, '  Zz open task  ', 'Body', null, null, team, 'high', 'task', array[u[4]]);
  perform pg_temp.service();
  perform pg_temp.check('member creates live',
    (select routing_state = 'released' and priority = 'high' and sent_at is null and created_by = u[3]
            and title = 'Zz open task' and team_id = team
       from public.general_tasks where id = t_open)
    and (select array_agg(user_id) = array[u[4]] and bool_and(assigned_by = u[3])
           from public.general_task_assignees where task_id = t_open)
    and exists(select 1 from public.general_task_events where task_id = t_open and kind = 'created' and actor_id = u[3])
    and exists(select 1 from public.general_task_events where task_id = t_open and kind = 'assigned' and actor_id = u[3])
    and not exists(select 1 from public.general_task_events where task_id = t_open and actor_id is null));
  perform pg_temp.check('holder is notified',
    exists(select 1 from public.notifications where user_id = u[4] and general_task_id = t_open
             and type = 'general_task_assigned'));
  perform pg_temp.check('holder lands at default stage',
    (select public.general_task_stage_at(status, stage, 5) = 1 from public.general_tasks where id = t_open));

  perform pg_temp.act_as(u[3]);
  t_bare := public.create_general_open_task(p, 'Zz bare', '', null, null, null, null, 'task', '{}'::uuid[]);
  perform pg_temp.service();
  perform pg_temp.check('no holder stays first stage',
    (select public.general_task_stage_at(status, stage, 5) = 0 and priority = 'normal'
       from public.general_tasks where id = t_bare));

  perform pg_temp.act_as(u[3]);
  update public.general_tasks set title = 'Zz bare renamed' where id = t_bare;
  perform pg_temp.check('creator keeps rights while unheld',
    (select title = 'Zz bare renamed' from public.general_tasks where id = t_bare));
  perform pg_temp.refuse('member can''t edit held task',
    format('update public.general_tasks set title = %L where id = %L', 'Zz nope', t_open), 'Only whoever holds this task');

  perform public.set_general_task_holders(t_open, array[u[3]]);
  perform pg_temp.check('member reassigns',
    (select array_agg(user_id) = array[u[3]] from public.general_task_assignees where task_id = t_open));
  perform pg_temp.service();
  perform pg_temp.check('reassign history names the member',
    exists(select 1 from public.general_task_events where task_id = t_open and kind = 'unassigned' and actor_id = u[3])
    and not exists(select 1 from public.general_task_events where task_id = t_open and actor_id is null));

  perform pg_temp.act_as(u[4]);
  perform public.set_general_task_holders(t_bare, array[u[4]]);
  perform public.set_general_task_holders(t_bare, '{}'::uuid[]);
  perform pg_temp.check('member clears holders',
    not exists(select 1 from public.general_task_assignees where task_id = t_bare));

  -- A rule's earlier assign row (no actor) keeps its null actor through a later change.
  perform pg_temp.service();
  insert into public.general_task_events(task_id, project_id, actor_id, kind, detail)
    values(t_bare, p, null, 'assigned', jsonb_build_object('user_id', u[3])) returning id into e_rule;
  perform pg_temp.act_as(u[4]);
  perform public.set_general_task_holders(t_bare, array[u[4]]);
  perform public.set_general_task_holders(t_bare, '{}'::uuid[]);
  perform pg_temp.service();
  perform pg_temp.check('older rule rows keep their null actor',
    (select actor_id is null from public.general_task_events where id = e_rule));
  perform pg_temp.act_as(u[4]);

  perform pg_temp.refuse('start after due refused',
    format('select public.create_general_open_task(%L, %L, %L, %L, %L, null, null, %L, %L::uuid[])',
      p, 'Zz dates', '', now() + interval '2 days', now() + interval '1 day', 'task', '{}'), 'cannot start after it is due');
  perform pg_temp.refuse('qa/stakeholder holder refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_bare, array[u[5]]), 'can hold tasks');
  perform pg_temp.refuse('stakeholder as holder refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_bare, array[u[6]]), 'can hold tasks');

  perform pg_temp.service();
  update public.general_projects set allow_multiple_assignees = false where id = p;
  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('single holder refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_bare, array[u[3], u[4]]), 'one holder per task');
  perform pg_temp.service();
  update public.general_projects set allow_multiple_assignees = true where id = p;

  -- QA reports bugs only, and assigns nobody.
  perform pg_temp.act_as(u[5]);
  t_bug := public.create_general_open_task(p, 'Zz bug', '', null, null, null, null, 'bug', '{}'::uuid[]);
  perform pg_temp.check('qa creates bug',
    (select routing_state = 'released' and kind = 'bug' from public.general_tasks where id = t_bug));
  perform pg_temp.refuse('qa task refused',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      p, 'Zz qa task', '', 'task', '{}'), 'QA creates bug tasks only');
  perform pg_temp.refuse('qa holders refused',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      p, 'Zz qa bug', '', 'bug', array[u[3]]), 'QA can''t assign');
  perform pg_temp.refuse('qa set holders refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_bare, array[u[3]]), 'QA can''t assign');

  perform pg_temp.act_as(u[6]);
  perform pg_temp.refuse('stakeholder refused',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      p, 'Zz stake', '', 'task', '{}'), 'Stakeholders can view this project');
  perform pg_temp.refuse('stakeholder set holders refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_bare, array[u[3]]), 'Stakeholders can view this project');

  -- Work in QA or done must reopen before its holders change.
  perform pg_temp.act_as(u[1]);
  t_qa := public.create_general_open_task(p, 'Zz in qa', '', null, null, null, null, 'task', array[u[4]]);
  t_done := public.create_general_open_task(p, 'Zz done', '', null, null, null, null, 'task', array[u[4]]);
  t_after := public.create_general_open_task(p, 'Zz after qa', '', null, null, null, null, 'task', array[u[4]]);
  update public.general_tasks set stage = 2, status = 'in_progress' where id = t_qa;
  update public.general_tasks set stage = 4, status = 'done' where id = t_done;
  update public.general_tasks set stage = 3, status = 'in_progress' where id = t_after;
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('holders refused in QA',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_qa, array[u[3]]), 'Reopen it before changing who holds it');
  perform pg_temp.refuse('holders refused when done',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_done, array[u[3]]), 'Reopen it before changing who holds it');
  perform pg_temp.refuse('holders refused after the QA stage',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_after, array[u[3]]), 'Reopen it before changing who holds it');

  -- The QA gate still holds for a Member holding the task.
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('QA gate holds',
    format('update public.general_tasks set stage = 4, status = %L where id = %L', 'done', t_open), 'Only QA or the project manager');

  -- The planned project refuses the open calls.
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('planned project refuses open create',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      q, 'Zz planned', '', 'task', '{}'), 'This project uses planned handoff');

  -- Placing a held task at the default stage fires no stage rule, as a release wouldn't.
  perform pg_temp.service();
  insert into public.general_workflow_rules(project_id, position, trigger_kind, trigger_stage, action_kind, action_priority, created_by)
    values(p, 1, 'stage_entered', 'Doing', 'set_priority', 'low', u[1]);
  perform pg_temp.act_as(u[3]);
  t_stage := public.create_general_open_task(p, 'Zz stage rule', '', null, null, null, 'high', 'task', array[u[4]]);
  perform pg_temp.service();
  perform pg_temp.check('default stage fires no stage rule',
    (select priority = 'high' and public.general_task_stage_at(status, stage, 5) = 1 from public.general_tasks where id = t_stage)
    and not exists(select 1 from public.general_task_events where task_id = t_stage and kind = 'rule_applied'));
  delete from public.general_workflow_rules where project_id = p;

  -- A "when a task is sent" rule covers open-created tasks.
  perform pg_temp.service();
  insert into public.general_workflow_rules(project_id, position, trigger_kind, action_kind, action_priority, created_by)
    values(p, 1, 'task_released', 'set_priority', 'urgent', u[1]);
  perform pg_temp.act_as(u[3]);
  t_rule := public.create_general_open_task(p, 'Zz rule', '', null, null, null, 'low', 'task', '{}'::uuid[]);
  perform pg_temp.service();
  perform pg_temp.check('release rule fires',
    (select priority = 'urgent' from public.general_tasks where id = t_rule));
  delete from public.general_workflow_rules where project_id = p;

  -- Switching back keeps holders; new work plans again.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('switch back returns 0', public.set_general_task_flow(p, 'planned') = 0);
  insert into public.general_tasks(project_id, title) values(p, 'Zz after') returning id into t_direct;
  perform pg_temp.service();
  perform pg_temp.check('switch back keeps holders and plans new work',
    exists(select 1 from public.general_task_assignees where task_id = t_open and user_id = u[3])
    and (select routing_state = 'planning' from public.general_tasks where id = t_direct));
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('set holders refused once planned',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t_open, array[u[4]]), 'This project uses planned handoff');
end $$;

rollback;
