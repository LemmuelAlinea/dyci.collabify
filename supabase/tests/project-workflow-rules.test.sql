-- supabase/tests/project-workflow-rules.test.sql
-- A work project's workflow rules: who reads and writes them, the 20-rule
-- limit, the field checks, the write-time checks, the skip fields, archived
-- projects, class boards, the notification type and the history event kind.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-workflow-rules.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/** Runs a statement and returns how many rows it touched. */
create or replace function pg_temp.rows_of(p_sql text) returns int
language plpgsql as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

/** Runs a statement and says whether it went through. */
create or replace function pg_temp.goes(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '        (refused: %)', left(sqlerrm, 90);
  return false;
end;
$$;

/** A notify rule: when a task moves to p_stage, tell the team lead. */
create or replace function pg_temp.lead_rule(p_project uuid, p_stage text) returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  insert into public.general_workflow_rules (project_id, trigger_kind, trigger_stage, action_kind, notify_to)
  values (p_project, 'stage_entered', p_stage, 'notify', 'team_lead')
  returning id into v;
  return v;
end;
$$;

/** How many rules of a project the current caller reads. */
create or replace function pg_temp.seen(p_project uuid) returns int
language sql as $$
  select count(*)::int from public.general_workflow_rules where project_id = p_project;
$$;

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager
  v_coord uuid := gen_random_uuid();  -- coordinator
  v_dev   uuid := gen_random_uuid();  -- member
  v_qa    uuid := gen_random_uuid();  -- QA
  v_stake uuid := gen_random_uuid();  -- stakeholder
  v_out   uuid := gen_random_uuid();  -- in the space, not on the project
  v_gone  uuid := gen_random_uuid();  -- on the project, account not active
  v_tmp   uuid := gen_random_uuid();  -- a coordinator whose profile gets deleted
  v_teach uuid := gen_random_uuid();  -- teaches the class
  v_stu1  uuid := gen_random_uuid();  -- student, class board
  v_stu2  uuid := gen_random_uuid();  -- student, class board
  v_space uuid;
  p       uuid;  -- the project under test (Backlog, Build, Review, Done)
  pd      uuid;  -- default stages (To do, In progress, Done)
  pa      uuid;  -- gets archived
  r1      uuid;
  r2      uuid;
  r3      uuid;
  ra      uuid;
  rt      uuid;
  rt2     uuid;
  t1      uuid;
  v_who   uuid;
  v_res   uuid;
  v_class uuid;
  v_set   uuid;
  v_group uuid;
  v_cproj uuid;
  v_board uuid;
  cb      uuid;  -- a class board's Files project
  b1      boolean;
  b2      boolean;
  b3      boolean;
  n       int;
  i       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,    'zz-pwr-pm@example.test'),
      (v_coord, 'zz-pwr-coord@example.test'),
      (v_dev,   'zz-pwr-dev@example.test'),
      (v_qa,    'zz-pwr-qa@example.test'),
      (v_stake, 'zz-pwr-stake@example.test'),
      (v_out,   'zz-pwr-out@example.test'),
      (v_gone,  'zz-pwr-gone@example.test'),
      (v_teach, 'zz-pwr-teach@example.test'),
      (v_stu1,  'zz-pwr-stu1@example.test'),
      (v_stu2,  'zz-pwr-stu2@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,    'zz-pwr-pm@example.test',    'Zz', 'Pwrpm',    'member',  'active', false, true),
    (v_coord, 'zz-pwr-coord@example.test', 'Zz', 'Pwrcoord', 'member',  'active', false, false),
    (v_dev,   'zz-pwr-dev@example.test',   'Zz', 'Pwrdev',   'member',  'active', false, false),
    (v_qa,    'zz-pwr-qa@example.test',    'Zz', 'Pwrqa',    'member',  'active', false, false),
    (v_stake, 'zz-pwr-stake@example.test', 'Zz', 'Pwrstake', 'member',  'active', false, false),
    (v_out,   'zz-pwr-out@example.test',   'Zz', 'Pwrout',   'member',  'active', false, false),
    (v_gone,  'zz-pwr-gone@example.test',  'Zz', 'Pwrgone',  'member',  'active', false, false),
    (v_teach, 'zz-pwr-teach@example.test', 'Zz', 'Pwrteach', 'member',  'active', true,  false),
    (v_stu1,  'zz-pwr-stu1@example.test',  'Zz', 'Pwrstu1',  'student', 'active', false, false),
    (v_stu2,  'zz-pwr-stu2@example.test',  'Zz', 'Pwrstu2',  'student', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PWR space', '')).id;
  p  := (public.create_general_project('Zz PWR project', '', null, null, null, null, v_space)).id;
  pd := (public.create_general_project('Zz PWR default', '', null, null, null, null, v_space)).id;
  pa := (public.create_general_project('Zz PWR archived', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_coord, 'member'), (v_space, v_dev, 'member'), (v_space, v_qa, 'member'),
    (v_space, v_stake, 'member'), (v_space, v_out, 'member'), (v_space, v_gone, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_coord, 'coordinator'), (p, v_dev, 'member'), (p, v_qa, 'qa'),
    (p, v_stake, 'stakeholder'), (p, v_gone, 'member'),
    (pd, v_coord, 'coordinator'), (pd, v_dev, 'member'),
    (pa, v_coord, 'coordinator'), (pa, v_dev, 'member');
  update public.profiles set status = 'pending' where id = v_gone;
  update public.general_projects set stages = array['Backlog', 'Build', 'Review', 'Done'] where id = p;

  ------------------------------------------------------------ the type and the event kind
  t1 := null;
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (p, 'Zz PWR task', v_pm, 'released') returning id into t1;
  perform pg_temp.must_be('the notification type and the history event kind exist',
    'workflow_rule' = any (enum_range(null::public.notification_type)::text[])
    and pg_temp.goes(format($q$insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
                              values (%L, %L, null, 'rule_applied', '{"rule": "Zz"}')$q$, t1, p))
    and pg_temp.goes(format($q$insert into public.general_task_events (task_id, project_id, actor_id, kind)
                              values (%L, %L, %L, 'sent_to_team')$q$, t1, p, v_pm)));
  perform pg_temp.must_refuse_with('...and the kind check still holds',
    format($q$insert into public.general_task_events (task_id, project_id, kind) values (%L, %L, 'nonsense')$q$, t1, p),
    'check constraint');

  ------------------------------------------------------------ who writes
  perform pg_temp.act_as(v_pm);
  r1 := pg_temp.lead_rule(p, 'Review');
  perform pg_temp.act_as(v_coord);
  insert into public.general_workflow_rules (project_id, name, trigger_kind, action_kind, action_priority)
  values (p, 'Late work goes urgent', 'task_overdue', 'set_priority', 'urgent') returning id into r2;
  insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
  values (p, 'task_released', 'assign', v_dev) returning id into r3;
  b1 := (select position = 1 and created_by = v_pm and enabled and name = ''
           from public.general_workflow_rules where id = r1)
    and (select position = 2 and created_by = v_coord from public.general_workflow_rules where id = r2)
    and (select position = 3 from public.general_workflow_rules where id = r3);
  n := pg_temp.rows_of(format($q$update public.general_workflow_rules set enabled = false where id = %L$q$, r1));
  perform pg_temp.act_as(v_pm);
  n := n * 10 + pg_temp.rows_of(format($q$update public.general_workflow_rules set name = 'Overdue goes urgent' where id = %L$q$, r2));
  n := n * 10 + pg_temp.rows_of(format($q$delete from public.general_workflow_rules where id = %L$q$, r3));
  perform pg_temp.act_as(v_coord);
  n := n * 10 + pg_temp.rows_of(format($q$delete from public.general_workflow_rules where id = %L$q$, r2));
  perform pg_temp.act_as(v_pm);
  r2 := null;
  insert into public.general_workflow_rules (project_id, trigger_kind, trigger_priority, action_kind, notify_to)
  values (p, 'priority_raised', 'high', 'notify', 'planners') returning id into r2;
  perform pg_temp.must_be('the project manager and coordinators can add, change and delete rules',
    b1 and n = 1111
    and (select not enabled from public.general_workflow_rules where id = r1)
    and (select position = 2 from public.general_workflow_rules where id = r2)
    and pg_temp.seen(p) = 2);
  perform pg_temp.act_as_service();
  perform pg_temp.act_as(v_pm);
  b1 := public.general_can_manage_workflow(p);
  perform pg_temp.act_as(v_coord);
  b2 := public.general_can_manage_workflow(p);
  perform pg_temp.act_as(v_dev);
  b3 := public.general_can_manage_workflow(p);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...general_can_manage_workflow says so, and the rules reach realtime',
    b1 and b2 and not b3
    and not public.general_can_manage_workflow(p)
    and not has_function_privilege('anon', 'public.general_can_manage_workflow(uuid)', 'execute')
    and not has_table_privilege('anon', 'public.general_workflow_rules', 'select')
    and exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'general_workflow_rules'));

  ------------------------------------------------------------ who reads
  n := 0;
  foreach v_who in array array[v_dev, v_qa, v_stake] loop
    perform pg_temp.act_as(v_who);
    if pg_temp.seen(p) <> 2 then
      raise notice '        % reads % rules', v_who, pg_temp.seen(p);
      n := n + 100;
    end if;
    perform pg_temp.must_refuse_with('...refused an insert',
      format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
                values (%L, 'task_released', 'notify', 'holders')$q$, p),
      'row-level security');
    n := n + pg_temp.rows_of(format($q$update public.general_workflow_rules set enabled = true where id = %L$q$, r1))
           + pg_temp.rows_of(format($q$delete from public.general_workflow_rules where id = %L$q$, r2));
  end loop;
  perform pg_temp.act_as(v_out);
  n := n + pg_temp.seen(p) * 1000;
  perform pg_temp.must_refuse_with('...somebody off the project cannot add one',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'task_released', 'notify', 'holders')$q$, p),
    'row-level security');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('members, qa and stakeholders read rules but cannot write them',
    n = 0
    and (select not enabled from public.general_workflow_rules where id = r1)
    and exists (select 1 from public.general_workflow_rules where id = r2));

  ------------------------------------------------------------ the limit
  perform pg_temp.act_as(v_pm);
  for i in 1 .. 18 loop
    perform pg_temp.lead_rule(p, 'Build');
  end loop;
  perform pg_temp.must_refuse_with('a 21st rule is refused',
    format($q$select pg_temp.lead_rule(%L, 'Build')$q$, p),
    'A project can have up to 20 rules.');
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...while somebody who may not write rules is refused by RLS alone',
    format($q$select pg_temp.lead_rule(%L, 'Build')$q$, p),
    'row-level security');
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('...after twenty went in',
    pg_temp.seen(p) = 20
    and (select max(position) = 20 and count(distinct position) = 20
           from public.general_workflow_rules where project_id = p));
  delete from public.general_workflow_rules where project_id = p and id not in (r1, r2);
  perform pg_temp.must_be('...and a deleted rule makes room again',
    pg_temp.goes(format($q$select pg_temp.lead_rule(%L, 'Build')$q$, p)));
  delete from public.general_workflow_rules where project_id = p and id not in (r1, r2);

  ------------------------------------------------------------ fields
  perform pg_temp.must_refuse_with('fields must match the trigger and action',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'stage_entered', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a stage only for "moves to a stage"',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, trigger_stage, action_kind, notify_to)
              values (%L, 'task_released', 'Review', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a level for "priority raised"',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'priority_raised', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...High or Urgent only',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, trigger_priority, action_kind, notify_to)
              values (%L, 'priority_raised', 'normal', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...no level for another trigger',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, trigger_priority, action_kind, notify_to)
              values (%L, 'task_overdue', 'high', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a known trigger',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'comment_added', 'notify', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...who to notify',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind)
              values (%L, 'task_released', 'notify')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a known group to notify',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'task_released', 'notify', 'everyone')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a priority to set',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind)
              values (%L, 'task_released', 'set_priority')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a known priority',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_priority)
              values (%L, 'task_released', 'set_priority', 'critical')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...a stage to move to',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind)
              values (%L, 'task_released', 'move_stage')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...nothing the action does not use',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_priority, notify_to)
              values (%L, 'task_released', 'set_priority', 'high', 'holders')$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...no person for a group notice',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to, person_id)
              values (%L, 'task_released', 'notify', 'holders', %L)$q$, p, v_dev),
    'check constraint');
  perform pg_temp.must_refuse_with('...a person to assign',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind)
              values (%L, 'task_released', 'assign')$q$, p),
    'Choose someone in this project.');
  perform pg_temp.must_refuse_with('...a person to notify',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'task_released', 'notify', 'person')$q$, p),
    'Choose someone in this project.');
  perform pg_temp.must_refuse_with('...a name of 80 characters at most',
    format($q$insert into public.general_workflow_rules (project_id, name, trigger_kind, action_kind, notify_to)
              values (%L, %L, 'task_released', 'notify', 'holders')$q$, p, repeat('n', 81)),
    'check constraint');
  perform pg_temp.must_refuse_with('...a stage the project has',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, trigger_stage, action_kind, notify_to)
              values (%L, 'stage_entered', 'In review', 'notify', 'holders')$q$, p),
    'Choose a stage in this project.');
  perform pg_temp.must_refuse_with('...the same for a stage to move to',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_stage)
              values (%L, 'task_released', 'move_stage', 'Testing')$q$, p),
    'Choose a stage in this project.');
  r3 := null;
  insert into public.general_workflow_rules (project_id, name, trigger_kind, trigger_stage, action_kind, notify_to, person_id)
  values (p, '  Tell QA  ', 'stage_entered', '  review ', 'notify', 'person', v_qa) returning id into r3;
  perform pg_temp.must_be('...and a matching rule saves, its stage as the project names it',
    (select trigger_stage = 'Review' and name = 'Tell QA' and person_id = v_qa
       from public.general_workflow_rules where id = r3)
    and pg_temp.goes(format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
                              values (%L, 'task_overdue', 'notify', 'qa')$q$, p))
    and pg_temp.goes(format($q$insert into public.general_workflow_rules (project_id, trigger_kind, trigger_priority, action_kind, action_priority)
                              values (%L, 'priority_raised', 'urgent', 'set_priority', 'high')$q$, p)));

  ------------------------------------------------------------ the last stage
  perform pg_temp.must_refuse_with('a move to the last stage is refused',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_stage)
              values (%L, 'task_released', 'move_stage', 'Done')$q$, p),
    'Choose a stage that isn''t the last one.');
  perform pg_temp.must_refuse_with('...whatever its case',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_stage)
              values (%L, 'task_released', 'move_stage', 'done')$q$, p),
    'Choose a stage that isn''t the last one.');
  perform pg_temp.must_refuse_with('...on the default stages too',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_stage)
              values (%L, 'task_released', 'move_stage', 'Done')$q$, pd),
    'Choose a stage that isn''t the last one.');
  r3 := null;
  insert into public.general_workflow_rules (project_id, trigger_kind, trigger_stage, action_kind, action_stage)
  values (p, 'stage_entered', 'Build', 'move_stage', 'review') returning id into r3;
  perform pg_temp.must_refuse_with('...and a rule cannot be changed to it',
    format($q$update public.general_workflow_rules set action_stage = 'Done' where id = %L$q$, r3),
    'Choose a stage that isn''t the last one.');
  perform pg_temp.must_be('...while a middle stage, or the first, saves',
    (select action_stage = 'Review' from public.general_workflow_rules where id = r3)
    and pg_temp.goes(format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, action_stage)
                              values (%L, 'task_released', 'move_stage', 'In progress')$q$, pd))
    and pg_temp.goes(format($q$update public.general_workflow_rules set action_stage = 'Backlog' where id = %L$q$, r3)));

  ------------------------------------------------------------ who can be named
  perform pg_temp.must_refuse_with('assigning qa, a stakeholder or a non-member is refused',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
              values (%L, 'task_released', 'assign', %L)$q$, p, v_qa),
    'That person can''t be given tasks.');
  perform pg_temp.must_refuse_with('...a stakeholder',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
              values (%L, 'task_released', 'assign', %L)$q$, p, v_stake),
    'That person can''t be given tasks.');
  perform pg_temp.must_refuse_with('...somebody off the project',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
              values (%L, 'task_released', 'assign', %L)$q$, p, v_out),
    'That person can''t be given tasks.');
  perform pg_temp.must_refuse_with('...an account that is not active',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
              values (%L, 'task_released', 'assign', %L)$q$, p, v_gone),
    'That person can''t be given tasks.');
  perform pg_temp.must_refuse_with('...a stakeholder is not someone to notify',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to, person_id)
              values (%L, 'task_released', 'notify', 'person', %L)$q$, p, v_stake),
    'Choose someone in this project.');
  perform pg_temp.must_refuse_with('...nor somebody off the project',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to, person_id)
              values (%L, 'task_released', 'notify', 'person', %L)$q$, p, v_out),
    'Choose someone in this project.');
  r3 := null;
  insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
  values (p, 'task_released', 'assign', v_dev) returning id into r3;
  perform pg_temp.must_refuse_with('...nor changed to one',
    format($q$update public.general_workflow_rules set person_id = %L where id = %L$q$, v_qa, r3),
    'That person can''t be given tasks.');
  perform pg_temp.must_be('...while a member, the project manager or a coordinator saves',
    (select person_id = v_dev from public.general_workflow_rules where id = r3)
    and pg_temp.goes(format($q$update public.general_workflow_rules set person_id = %L where id = %L$q$, v_coord, r3))
    and pg_temp.goes(format($q$update public.general_workflow_rules set person_id = %L where id = %L$q$, v_pm, r3)));
  perform pg_temp.must_refuse_with('...and a signed-in person cannot clear the person',
    format($q$update public.general_workflow_rules set person_id = null where id = %L$q$, r3),
    'Choose someone in this project.');
  perform pg_temp.must_refuse_with('...nor the person to notify',
    format($q$update public.general_workflow_rules set person_id = null
               where project_id = %L and notify_to = 'person'$q$, p),
    'Choose someone in this project.');

  -- A rule whose person left keeps working as a row: it can still be turned off.
  perform pg_temp.act_as_service();
  update public.general_workflow_rules set person_id = v_dev where id = r3;
  delete from public.general_members where project_id = p and user_id = v_dev;
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('...and a rule whose person left can still be turned off',
    pg_temp.rows_of(format($q$update public.general_workflow_rules set enabled = false where id = %L$q$, r3)) = 1);
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values (p, v_dev, 'member');

  -- A creator's or named person's account deleted: the rule stays, cleared.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_tmp, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-pwr-tmp@example.test', '', now(), now());
  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_tmp, 'zz-pwr-tmp@example.test', 'Zz', 'Pwrtmp', 'member', 'active', false, false)
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  insert into public.general_space_members (space_id, user_id, level) values (v_space, v_tmp, 'member');
  insert into public.general_members (project_id, user_id, role) values (p, v_tmp, 'coordinator');
  perform pg_temp.act_as(v_tmp);
  rt := pg_temp.lead_rule(p, 'Review');
  insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, person_id)
  values (p, 'task_overdue', 'assign', v_tmp) returning id into rt2;
  b1 := (select created_by = v_tmp from public.general_workflow_rules where id = rt)
    and (select person_id = v_tmp and created_by = v_tmp from public.general_workflow_rules where id = rt2);
  perform pg_temp.act_as_service();
  -- Off the project first: the member-removal history needs the profile.
  delete from public.general_members where project_id = p and user_id = v_tmp;
  delete from public.profiles where id = v_tmp;
  perform pg_temp.must_be('deleting a creator''s or named person''s profile keeps the rule, cleared',
    b1
    and not exists (select 1 from public.profiles where id = v_tmp)
    and (select created_by is null and trigger_stage = 'Review' and enabled
           from public.general_workflow_rules where id = rt)
    and (select created_by is null and person_id is null and action_kind = 'assign'
           from public.general_workflow_rules where id = rt2));
  delete from public.general_workflow_rules where id in (rt, rt2);

  ------------------------------------------------------------ skip fields
  perform pg_temp.act_as_service();
  update public.general_workflow_rules
     set last_skipped_at = timestamptz '2030-01-02 03:04:05+00', last_skip_reason = 'Zz reason'
   where id = r1;
  b1 := (select last_skipped_at = timestamptz '2030-01-02 03:04:05+00' and last_skip_reason = 'Zz reason'
           from public.general_workflow_rules where id = r1);
  perform pg_temp.act_as(v_pm);
  update public.general_workflow_rules
     set last_skipped_at = now(), last_skip_reason = 'Zz mine', position = 99, created_by = v_dev,
         enabled = true
   where id = r1;
  b2 := (select last_skipped_at = timestamptz '2030-01-02 03:04:05+00'
                and last_skip_reason = 'Zz reason' and position = 1 and created_by = v_pm and enabled
           from public.general_workflow_rules where id = r1);
  r3 := null;
  insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to,
                                             last_skipped_at, last_skip_reason, position)
  values (p, 'task_released', 'notify', 'holders', now(), 'Zz mine', 1) returning id into r3;
  b3 := (select last_skipped_at is null and last_skip_reason is null and position > 1
           from public.general_workflow_rules where id = r3);
  perform pg_temp.must_be('a signed-in person cannot write the skip fields',
    b1 and b2 and b3);
  update public.general_workflow_rules set trigger_stage = 'Build' where id = r1;
  perform pg_temp.must_be('...and editing what a rule does clears its last skip',
    (select last_skipped_at is null and last_skip_reason is null and trigger_stage = 'Build'
       from public.general_workflow_rules where id = r1));
  perform set_config('collabify.workflow_rule_run', 'on', true);
  update public.general_workflow_rules
     set last_skipped_at = timestamptz '2030-02-03 00:00:00+00', last_skip_reason = 'Zz run'
   where id = r1;
  perform set_config('collabify.workflow_rule_run', 'off', true);
  perform pg_temp.must_be('...while the rule runner writes them',
    (select last_skipped_at = timestamptz '2030-02-03 00:00:00+00' and last_skip_reason = 'Zz run'
       from public.general_workflow_rules where id = r1));
  perform pg_temp.must_refuse_with('...and a rule stays in its project',
    format($q$update public.general_workflow_rules set project_id = %L where id = %L$q$, pd, r1),
    'A rule stays in its project.');

  ------------------------------------------------------------ archived projects
  perform pg_temp.act_as(v_pm);
  ra := pg_temp.lead_rule(pa, 'In progress');
  perform public.archive_general_project(pa, true);
  perform pg_temp.must_refuse_with('archived projects refuse rule writes',
    format($q$select pg_temp.lead_rule(%L, 'In progress')$q$, pa),
    'archived');
  n := pg_temp.rows_of(format($q$update public.general_workflow_rules set enabled = false where id = %L$q$, ra))
     + pg_temp.rows_of(format($q$delete from public.general_workflow_rules where id = %L$q$, ra));
  b1 := not public.general_can_manage_workflow(pa) and pg_temp.seen(pa) = 1;
  perform pg_temp.act_as(v_coord);
  n := n + pg_temp.rows_of(format($q$update public.general_workflow_rules set enabled = false where id = %L$q$, ra))
         + pg_temp.rows_of(format($q$delete from public.general_workflow_rules where id = %L$q$, ra));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...no change or delete either, and the project manager still reads them',
    n = 0 and b1
    and (select enabled from public.general_workflow_rules where id = ra));

  ------------------------------------------------------------ class boards
  perform pg_temp.act_as_service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_teach, 'syllabus', 'Zz PWR syllabus', 'x/pwr.pdf', 'pwr.pdf') returning id into v_res;
  insert into public.syllabus_weeks (resource_id, week_no, title) values (v_res, 1, 'Week 1');
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_teach, 'Zz PWR class', 'ZZW', 'ZZPWR-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_res)
  returning id into v_class;
  insert into public.class_members (class_id, student_id, status) values
    (v_class, v_stu1, 'active'), (v_class, v_stu2, 'active');
  insert into public.group_sets (class_id, name, mode) values (v_class, 'Zz PWR set', 'manual')
  returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz PWR group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values
    (v_group, v_set, v_stu1), (v_group, v_set, v_stu2);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience,
                               group_set_id, due_at)
  values (v_class, v_teach, 'Zz PWR class project', 'activity', 1, 1, 'group', v_set,
          now() + interval '7 days')
  returning id into v_cproj;
  perform public.ensure_project_boards(v_cproj);
  select id into v_board from public.project_boards
   where project_id = v_cproj and group_id = v_group;
  perform pg_temp.act_as(v_stu1);
  cb := public.ensure_class_board_repo(v_board);
  perform pg_temp.must_refuse_with('class boards refuse rules',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'task_released', 'notify', 'holders')$q$, cb),
    'Workflow rules are for work projects.');
  b1 := public.general_can_manage_workflow(cb);
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse_with('...even for the service role',
    format($q$insert into public.general_workflow_rules (project_id, trigger_kind, action_kind, notify_to)
              values (%L, 'task_released', 'notify', 'holders')$q$, cb),
    'Workflow rules are for work projects.');
  perform pg_temp.must_be('...and nobody manages them there',
    not b1 and not exists (select 1 from public.general_workflow_rules where project_id = cb));
end;
$$;

rollback;
