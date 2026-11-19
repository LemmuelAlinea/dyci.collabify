-- supabase/tests/send-to-planner.test.sql
-- The project manager sends planning tasks straight to themselves or an active
-- coordinator: one step releases and assigns, the team is optional and needs
-- no lead, and everyone else and every other row is refused. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/send-to-planner.test.sql
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
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 active coordinator, 3 pending coordinator, 4 member (lead), 5 qa
  p uuid; led uuid; leadless uuid; old_team uuid;
  t_self uuid; t_coord uuid; t_held uuid; t_released uuid; t_parent uuid; t_sub uuid;
  t_one uuid; t_stale uuid; t_keep uuid; t_arch uuid; t_dup uuid; t_rule uuid; t_rule2 uuid; r_one uuid;
  stamp timestamptz; k int; n int;
begin
  for k in 1..5 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-direct-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_manage_projects)
      values(u[k], 'zz-direct-'||k||'@example.test', 'Direct', k::text, 'member', 'active', k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz direct send', '')).id;

  perform pg_temp.service();
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'coordinator'), (p, u[4], 'member'), (p, u[5], 'qa');
  update public.profiles set status = 'pending' where id = u[3];
  insert into public.general_teams(project_id, name) values(p, 'Zz led team') returning id into led;
  insert into public.general_team_members(project_id, team_id, user_id) values(p, led, u[4]);
  update public.general_teams set leader_id = u[4] where id = led;
  insert into public.general_teams(project_id, name) values(p, 'Zz leadless team') returning id into leadless;
  insert into public.general_teams(project_id, name) values(p, 'Zz old team') returning id into old_team;
  perform pg_temp.act_as(u[1]);
  update public.general_teams set archived_at = now() where id = old_team;
  perform pg_temp.service();
  update public.notification_prefs set task_assignments = true where user_id in (u[1], u[2]);
  update public.general_projects set task_assignment_notices = true where id = p;

  perform pg_temp.act_as(u[1]);
  insert into public.general_tasks(project_id, title) values(p, 'Zz self') returning id into t_self;
  insert into public.general_tasks(project_id, title) values(p, 'Zz coord') returning id into t_coord;
  insert into public.general_tasks(project_id, title) values(p, 'Zz held') returning id into t_held;
  insert into public.general_tasks(project_id, title) values(p, 'Zz parent') returning id into t_parent;
  t_sub := public.create_general_subtask(t_parent, 'Zz sub');
  insert into public.general_tasks(project_id, title) values(p, 'Zz one holder') returning id into t_one;
  insert into public.general_tasks(project_id, title) values(p, 'Zz stale') returning id into t_stale;
  insert into public.general_tasks(project_id, title) values(p, 'Zz keep') returning id into t_keep;
  insert into public.general_tasks(project_id, title) values(p, 'Zz archived team') returning id into t_arch;
  insert into public.general_tasks(project_id, title) values(p, 'Zz dup') returning id into t_dup;

  perform pg_temp.service();
  insert into public.general_tasks(project_id, title, routing_state, created_by)
    values(p, 'Zz released', 'released', u[1]) returning id into t_released;
  insert into public.general_task_assignees(project_id, task_id, user_id) values(p, t_held, u[4]);

  -- The PM sends to themselves with no team.
  perform pg_temp.act_as(u[1]);
  n := public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_self, 'team_id', null,
      'updated_at', (select updated_at from public.general_tasks where id = t_self))), u[1]);
  perform pg_temp.check('pm sends to self: returns one', n = 1);
  perform pg_temp.check('pm sends to self: released with no team and a send time',
    (select routing_state = 'released' and team_id is null and sent_at is not null and reviewer_id is null
       from public.general_tasks where id = t_self));
  perform pg_temp.check('pm sends to self: pm holds it',
    (select array_agg(user_id) = array[u[1]] from public.general_task_assignees where task_id = t_self));
  perform pg_temp.check('pm sends to self: one sent_to_team event naming the holder',
    (select count(*) = 1 and bool_and(detail->>'holder_id' = u[1]::text and detail->'new_team_id' = 'null'::jsonb)
       from public.general_task_events where task_id = t_self and kind = 'sent_to_team'));
  perform pg_temp.service();
  perform pg_temp.check('no notice to self',
    not exists(select 1 from public.notifications where user_id = u[1] and general_task_id = t_self));

  -- The PM sends to an active coordinator with a team that has no lead.
  perform pg_temp.act_as(u[1]);
  perform public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_coord, 'team_id', leadless,
      'updated_at', (select updated_at from public.general_tasks where id = t_coord))), u[2]);
  perform pg_temp.check('pm sends to coordinator with leadless team',
    (select routing_state = 'released' and team_id = leadless from public.general_tasks where id = t_coord)
    and exists(select 1 from public.general_task_assignees where task_id = t_coord and user_id = u[2]));
  perform pg_temp.service();
  perform pg_temp.check('coordinator gets assigned notice',
    (select count(*) = 1 from public.notifications
      where user_id = u[2] and general_task_id = t_coord and type = 'general_task_assigned'));

  -- A subtask follows its parent.
  perform pg_temp.act_as(u[1]);
  perform public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_parent, 'team_id', led,
      'updated_at', (select updated_at from public.general_tasks where id = t_parent))), u[1]);
  perform pg_temp.service();
  perform pg_temp.check('subtask follows parent',
    (select routing_state = 'released' and team_id = led from public.general_tasks where id = t_sub));

  -- One holder per task still lets the single insert through.
  update public.general_projects set allow_multiple_assignees = false where id = p;
  perform pg_temp.act_as(u[1]);
  perform public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_one, 'team_id', null,
      'updated_at', (select updated_at from public.general_tasks where id = t_one))), u[2]);
  perform pg_temp.check('one-holder project',
    exists(select 1 from public.general_task_assignees where task_id = t_one and user_id = u[2]));
  perform pg_temp.service();
  update public.general_projects set allow_multiple_assignees = true where id = p;

  -- A "when sent" assign rule runs after the holder is in place, so it never
  -- blocks the send: one holder per task skips the rule, and a rule naming the
  -- same person does nothing.
  perform pg_temp.act_as(u[1]);
  insert into public.general_tasks(project_id, title) values(p, 'Zz rule one holder') returning id into t_rule;
  insert into public.general_tasks(project_id, title) values(p, 'Zz rule same person') returning id into t_rule2;
  insert into public.general_workflow_rules(project_id, trigger_kind, action_kind, person_id)
    values(p, 'task_released', 'assign', u[4]) returning id into r_one;
  perform pg_temp.service();
  update public.general_projects set allow_multiple_assignees = false where id = p;
  perform pg_temp.act_as(u[1]);
  perform public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_rule, 'team_id', led,
      'updated_at', (select updated_at from public.general_tasks where id = t_rule))), u[1]);
  perform pg_temp.service();
  perform pg_temp.check('sent rule in a one-holder project: the pm holds it alone',
    (select array_agg(user_id) = array[u[1]] from public.general_task_assignees where task_id = t_rule));
  perform pg_temp.check('sent rule in a one-holder project: the rule records its skip',
    (select last_skip_reason is not null from public.general_workflow_rules where id = r_one));
  update public.general_projects set allow_multiple_assignees = true where id = p;
  update public.general_workflow_rules set enabled = false where id = r_one;
  insert into public.general_team_members(project_id, team_id, user_id) values(p, led, u[2]);
  perform pg_temp.act_as(u[1]);
  insert into public.general_workflow_rules(project_id, trigger_kind, action_kind, person_id)
    values(p, 'task_released', 'assign', u[2]);
  perform public.send_work_tasks_to_planner(p,
    jsonb_build_array(jsonb_build_object('id', t_rule2, 'team_id', led,
      'updated_at', (select updated_at from public.general_tasks where id = t_rule2))), u[2]);
  perform pg_temp.service();
  perform pg_temp.check('sent rule naming the same person: one holder row',
    (select array_agg(user_id) = array[u[2]] from public.general_task_assignees where task_id = t_rule2));
  delete from public.general_workflow_rules where project_id = p;

  -- Refusals.
  select updated_at into stamp from public.general_tasks where id = t_keep;
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('coordinator caller refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_keep, 'team_id', null, 'updated_at', stamp)), u[2]),
    'Only the project manager sends work straight to a person.');
  perform pg_temp.act_as(u[1]);
  foreach k in array array[4, 5, 3] loop
    perform pg_temp.refuse('holder '||k||' refused', format(
      'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
      jsonb_build_array(jsonb_build_object('id', t_keep, 'team_id', null, 'updated_at', stamp)), u[k]),
      'Choose yourself or an active coordinator on this project.');
  end loop;
  perform pg_temp.refuse('subtask row refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_sub, 'team_id', null,
      'updated_at', (select updated_at from public.general_tasks where id = t_sub))), u[1]),
    'Send planning tasks only.');
  perform pg_temp.refuse('held row refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_held, 'team_id', null,
      'updated_at', (select updated_at from public.general_tasks where id = t_held))), u[1]),
    'Send planning tasks only.');
  perform pg_temp.refuse('released row refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_released, 'team_id', null,
      'updated_at', (select updated_at from public.general_tasks where id = t_released))), u[1]),
    'Send planning tasks only.');
  perform pg_temp.refuse('stale row refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_stale, 'team_id', null, 'updated_at', now() - interval '1 day')), u[1]),
    'A task changed. Reload the tasks and try again.');
  perform pg_temp.refuse('duplicate id refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(
      jsonb_build_object('id', t_dup, 'team_id', null, 'updated_at', (select updated_at from public.general_tasks where id = t_dup)),
      jsonb_build_object('id', t_dup, 'team_id', null, 'updated_at', (select updated_at from public.general_tasks where id = t_dup))), u[1]),
    'Select each task once.');
  perform pg_temp.refuse('archived team refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(
      jsonb_build_object('id', t_keep, 'team_id', null, 'updated_at', stamp),
      jsonb_build_object('id', t_arch, 'team_id', old_team,
        'updated_at', (select updated_at from public.general_tasks where id = t_arch))), u[1]),
    'Choose a live team in this project.');
  perform pg_temp.check('archived team refused, nothing released',
    (select routing_state = 'planning' from public.general_tasks where id = t_keep)
    and not exists(select 1 from public.general_task_assignees where task_id = t_keep));

  -- A project that cannot receive handoffs.
  perform pg_temp.service();
  update public.general_projects set archived_at = now() where id = p;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('archived project refused', format(
    'select public.send_work_tasks_to_planner(%L, %L::jsonb, %L)', p,
    jsonb_build_array(jsonb_build_object('id', t_keep, 'team_id', null, 'updated_at', stamp)), u[1]),
    'This project cannot receive handoffs. Restore it first.');

  perform pg_temp.service();
end $$;

-- Anonymous callers cannot run it.
select pg_temp.check('anon cannot execute',
  not has_function_privilege('anon', 'public.send_work_tasks_to_planner(uuid, jsonb, uuid)', 'execute'));

rollback;
