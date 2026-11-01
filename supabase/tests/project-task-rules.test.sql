-- supabase/tests/project-task-rules.test.sql
-- A work project's task rules, task priority, subtasks and dependencies.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-task-rules.test.sql
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

/**
 * Runs a statement, then checks the deferred subtask-state constraint at once
 * (it otherwise waits for a commit this suite never makes).
 */
create or replace function pg_temp.checked(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  set constraints public.general_tasks_subtask_state immediate;
  set constraints public.general_tasks_subtask_state deferred;
end;
$$;

/** A released task, written by the service role as the handoff would leave it. */
create or replace function pg_temp.released_task(p_project uuid, p_title text, p_by uuid,
                                                 p_parent uuid default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.general_tasks (project_id, title, created_by, routing_state, parent_id)
  values (p_project, p_title, p_by, 'released', p_parent)
  returning id into v;
  return v;
end;
$$;

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager on P, P2 and Q
  v_dev   uuid := gen_random_uuid();  -- member on P and Q
  v_dev2  uuid := gen_random_uuid();  -- another member on P
  v_qa    uuid := gen_random_uuid();  -- QA on Q
  v_coord uuid := gen_random_uuid();  -- coordinator on P and Q
  v_teach uuid := gen_random_uuid();  -- teaches the class whose board has Files
  v_stu   uuid := gen_random_uuid();  -- the student whose board it is
  v_stake uuid := gen_random_uuid();  -- stakeholder on P
  v_view  uuid := gen_random_uuid();  -- in the space, not on P (a workspace viewer)
  v_space uuid;
  p       uuid;  -- the project under test
  p2      uuid;  -- another project in the same space
  q       uuid;  -- a project with active QA
  cb      uuid;  -- a class board's Files project
  team    uuid;
  qteam   uuid;
  v_class uuid;
  v_cproj uuid;
  v_board uuid;
  v_syl   uuid;
  t       uuid;
  t2      uuid;
  par     uuid;
  sub     uuid;
  other   uuid;
  v_upd   timestamptz;
  n       int;
  w1      uuid;
  w2      uuid;
  w3      uuid;
  w4      uuid;
  pp      uuid;
  sub2    uuid;
  v_sprint uuid;
  v_mile  uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,   'zz-ptr-pm@example.test'),
      (v_dev,  'zz-ptr-dev@example.test'),
      (v_dev2, 'zz-ptr-dev2@example.test'),
      (v_qa,   'zz-ptr-qa@example.test'),
      (v_coord, 'zz-ptr-coord@example.test'),
      (v_teach, 'zz-ptr-teach@example.test'),
      (v_stu,   'zz-ptr-stu@example.test'),
      (v_stake, 'zz-ptr-stake@example.test'),
      (v_view,  'zz-ptr-view@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,   'zz-ptr-pm@example.test',   'Zz', 'Ptrpm',   'member', 'active', false, true),
    (v_dev,  'zz-ptr-dev@example.test',  'Zz', 'Ptrdev',  'member', 'active', false, false),
    (v_dev2, 'zz-ptr-dev2@example.test', 'Zz', 'Ptrdev2', 'member', 'active', false, false),
    (v_qa,   'zz-ptr-qa@example.test',   'Zz', 'Ptrqa',   'member', 'active', false, false),
    (v_coord, 'zz-ptr-coord@example.test', 'Zz', 'Ptrcoord', 'member', 'active', false, false),
    (v_teach, 'zz-ptr-teach@example.test', 'Zz', 'Ptrteach', 'member', 'active', true, false),
    (v_stu,   'zz-ptr-stu@example.test',   'Zz', 'Ptrstu',   'student', 'active', false, false),
    (v_stake, 'zz-ptr-stake@example.test', 'Zz', 'Ptrstake', 'member', 'active', false, false),
    (v_view,  'zz-ptr-view@example.test',  'Zz', 'Ptrview',  'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PTR space', '')).id;
  p  := (public.create_general_project('Zz PTR project', '', null, null, null, null, v_space)).id;
  p2 := (public.create_general_project('Zz PTR other', '', null, null, null, null, v_space)).id;
  q  := (public.create_general_project('Zz PTR QA project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_dev, 'member'), (v_space, v_dev2, 'member'), (v_space, v_qa, 'member'),
    (v_space, v_coord, 'member'), (v_space, v_stake, 'member'), (v_space, v_view, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_dev, 'member'), (p, v_dev2, 'member'), (p, v_coord, 'coordinator'),
    (p, v_stake, 'stakeholder'),
    (q, v_dev, 'member'), (q, v_qa, 'qa'), (q, v_coord, 'coordinator');
  insert into public.general_teams (project_id, name) values (p, 'Zz PTR team') returning id into team;
  insert into public.general_team_members (project_id, team_id, user_id) values
    (p, team, v_dev), (p, team, v_dev2);
  update public.general_teams set leader_id = v_dev where id = team;
  insert into public.general_teams (project_id, name) values (q, 'Zz PTR QA team') returning id into qteam;
  insert into public.general_team_members (project_id, team_id, user_id) values (q, qteam, v_dev);
  update public.general_teams set leader_id = v_dev where id = qteam;

  ------------------------------------------------------------ defaults
  perform pg_temp.must_be('new projects keep today''s task rules',
    (select default_priority = 'normal' and default_stage = 0 and allow_subtasks
        and allow_dependencies and allow_multiple_assignees and not require_assignee
        and require_subtasks_done
       from public.general_projects where id = p));

  ------------------------------------------------------------ priority
  t := pg_temp.released_task(p, 'Zz PTR first', v_pm);
  perform pg_temp.act_as(v_pm);
  update public.general_projects set default_priority = 'high' where id = p;
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planned high')
  returning id into t2;
  insert into public.general_tasks (project_id, title, priority) values (p, 'Zz PTR planned low', 'low')
  returning id into other;
  perform pg_temp.must_be('a new task takes the project''s default priority',
    (select priority = 'normal' from public.general_tasks where id = t)
    and (select priority = 'high' from public.general_tasks where id = t2)
    and (select priority = 'low' from public.general_tasks where id = other));
  perform pg_temp.must_refuse_with('...an unknown priority is refused',
    format($q$update public.general_tasks set priority = 'extreme' where id = %L$q$, t),
    'check constraint');
  perform pg_temp.must_refuse_with('...and an unknown default priority',
    format($q$update public.general_projects set default_priority = 'extreme' where id = %L$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...and a negative default stage',
    format($q$update public.general_projects set default_stage = -1 where id = %L$q$, p),
    'check constraint');
  update public.general_projects set default_priority = 'normal' where id = p;

  ------------------------------------------------------------ default stage
  perform pg_temp.act_as(v_pm);
  update public.general_projects set default_stage = 1 where id = p;
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR starts in progress', v_pm);
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planned stays put')
  returning id into t2;
  perform pg_temp.must_be('a released task starts in the default stage',
    (select stage = 1 and status = 'in_progress' from public.general_tasks where id = t)
    and (select stage = 0 and status = 'todo' and routing_state = 'planning'
           from public.general_tasks where id = t2));
  select updated_at into v_upd from public.general_tasks where id = t2;
  perform public.send_work_tasks_to_teams(p,
    jsonb_build_array(jsonb_build_object('id', t2, 'team_id', team, 'updated_at', v_upd)));
  perform pg_temp.must_be('...and so does a planned task once it is sent to a team',
    (select stage = 1 and status = 'in_progress' and routing_state = 'released'
            and qa_entered_at is not null
       from public.general_tasks where id = t2));
  update public.general_projects set default_stage = 7 where id = p;
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR past the last stage', v_pm);
  perform pg_temp.must_be('...and a default past the last stage falls back to the first',
    (select stage = 0 and status = 'todo' from public.general_tasks where id = t));
  update public.general_projects set default_stage = 2 where id = p;
  t := pg_temp.released_task(p, 'Zz PTR default on Done', v_pm);
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR sent onto Done')
  returning id into t2;
  select updated_at into v_upd from public.general_tasks where id = t2;
  perform public.send_work_tasks_to_teams(p,
    jsonb_build_array(jsonb_build_object('id', t2, 'team_id', team, 'updated_at', v_upd)));
  perform pg_temp.must_be('a default on the last stage lands on the stage before it, not Done',
    (select count(*) = 2 and bool_and(stage = 1 and status = 'in_progress' and completed_at is null)
       from public.general_tasks where id in (t, t2)));
  perform pg_temp.act_as_service();
  update public.general_projects set default_stage = 0 where id = p;

  ------------------------------------------------------------ parents
  par := pg_temp.released_task(p, 'Zz PTR parent', v_pm);
  sub := pg_temp.released_task(p, 'Zz PTR subtask', v_pm, par);
  other := pg_temp.released_task(p2, 'Zz PTR elsewhere', v_pm);
  perform pg_temp.must_refuse_with('a subtask must be in the same project',
    format($q$insert into public.general_tasks (project_id, title, created_by, routing_state, parent_id)
              values (%L, 'Zz PTR stray', %L, 'released', %L)$q$, p, v_pm, other),
    'same project');
  perform pg_temp.must_refuse_with('...when moved under another project''s task too',
    format($q$update public.general_tasks set parent_id = %L where id = %L$q$, other, sub),
    'same project');
  perform pg_temp.must_refuse_with('...and a task cannot be its own subtask',
    format($q$update public.general_tasks set parent_id = id where id = %L$q$, par),
    'its own subtask');
  perform pg_temp.must_refuse_with('a subtask cannot have subtasks',
    format($q$insert into public.general_tasks (project_id, title, created_by, routing_state, parent_id)
              values (%L, 'Zz PTR grandchild', %L, 'released', %L)$q$, p, v_pm, sub),
    'A subtask can''t have its own subtasks.');
  t := pg_temp.released_task(p, 'Zz PTR would-be parent', v_pm);
  perform pg_temp.must_refuse_with('a task with subtasks cannot become a subtask',
    format($q$update public.general_tasks set parent_id = %L where id = %L$q$, t, par),
    'This task has subtasks, so it can''t become one.');
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set parent_id = par where id = t;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...while a plain task can join a parent',
    n = 1 and (select parent_id = par from public.general_tasks where id = t));
  update public.general_tasks set parent_id = null where id = t;

  perform pg_temp.act_as_service();
  t2 := pg_temp.released_task(p, 'Zz PTR held, loose', v_pm);
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t2, v_dev);
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('a holder cannot link their task under a parent directly',
    format($q$update public.general_tasks set parent_id = %L where id = %L$q$, par, t2),
    'Add subtasks from the parent task.');
  perform pg_temp.must_refuse_with('...or unlink a subtask',
    format($q$update public.general_tasks set parent_id = null where id = %L$q$, sub),
    'Add subtasks from the parent task.');
  perform set_config('collabify.subtask_op', 'on', true);
  update public.general_tasks set parent_id = par where id = t2;
  perform set_config('collabify.subtask_op', 'off', true);
  perform pg_temp.must_be('...while the subtask function''s flag lets a holder link one',
    (select parent_id = par from public.general_tasks where id = t2));
  perform pg_temp.act_as(v_coord);
  update public.general_tasks set parent_id = t where id = t2;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a coordinator can move a subtask to another parent',
    n = 1 and (select parent_id = t from public.general_tasks where id = t2));
  update public.general_tasks set parent_id = null where id = t2;
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planning parent')
  returning id into other;
  perform pg_temp.must_refuse_with('...but not a released task under a planning one',
    format($q$update public.general_tasks set parent_id = %L where id = %L$q$, other, t2),
    'share its parent''s release state');
  perform pg_temp.must_refuse_with('...nor a new planning task under a released one',
    format($q$insert into public.general_tasks (project_id, title, parent_id)
              values (%L, 'Zz PTR planning child', %L)$q$, p, par),
    'share its parent''s release state');
  insert into public.general_tasks (project_id, title, parent_id)
  values (p, 'Zz PTR planning child', other) returning id into t2;
  perform pg_temp.must_be('...while a planning task joins a planning parent',
    (select parent_id = other and routing_state = 'planning' from public.general_tasks where id = t2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse_with('...and the service role keeps to the release state too',
    format($q$insert into public.general_tasks (project_id, title, created_by, routing_state, parent_id)
              values (%L, 'Zz PTR stray released', %L, 'released', %L)$q$, p, v_pm, other),
    'share its parent''s release state');
  perform pg_temp.act_as(v_pm);

  update public.general_projects set allow_subtasks = false where id = p;
  perform pg_temp.must_refuse_with('switching subtasks off refuses new ones but keeps existing ones',
    format($q$update public.general_tasks set parent_id = %L where id = %L$q$, par, t),
    'Subtasks are turned off for this project.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse_with('...a new subtask is refused for the service role too',
    format($q$insert into public.general_tasks (project_id, title, created_by, routing_state, parent_id)
              values (%L, 'Zz PTR off', %L, 'released', %L)$q$, p, v_pm, par),
    'Subtasks are turned off for this project.');
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set title = 'Zz PTR subtask renamed' where id = sub;
  perform pg_temp.must_be('...the existing subtask keeps its parent and stays editable',
    (select parent_id = par and title = 'Zz PTR subtask renamed'
       from public.general_tasks where id = sub));
  update public.general_projects set allow_subtasks = true where id = p;

  ------------------------------------------------------------ require an assignee
  update public.general_projects set require_assignee = true where id = p;
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR needs a holder', v_pm);
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('require assignee blocks leaving the first stage without a holder',
    format($q$update public.general_tasks set stage = 1 where id = %L$q$, t),
    'Give this task a holder before moving it on.');
  perform pg_temp.must_refuse_with('...by status as well',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, t),
    'Give this task a holder before moving it on.');
  perform pg_temp.must_refuse_with('...and straight to done',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, t),
    'Give this task a holder before moving it on.');
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planning, unheld')
  returning id into t2;
  update public.general_tasks set status = 'in_progress' where id = t2;
  perform pg_temp.must_be('...a private planning task is not held to it',
    (select status = 'in_progress' from public.general_tasks where id = t2));
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t, v_dev);
  update public.general_tasks set stage = 1 where id = t;
  perform pg_temp.must_be('...and a held task moves on',
    (select stage = 1 and status = 'in_progress' from public.general_tasks where id = t));
  update public.general_projects set default_stage = 1 where id = p;
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR sent, unheld')
  returning id into t2;
  select updated_at into v_upd from public.general_tasks where id = t2;
  perform public.send_work_tasks_to_teams(p,
    jsonb_build_array(jsonb_build_object('id', t2, 'team_id', team, 'updated_at', v_upd)));
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR inserted, unheld', v_pm);
  perform pg_temp.must_be('...unheld work enters the first stage, not the default',
    (select stage = 0 and status = 'todo' and routing_state = 'released'
       from public.general_tasks where id = t2)
    and (select stage = 0 and status = 'todo' from public.general_tasks where id = t));
  insert into public.general_tasks (project_id, title, created_by) values (p, 'Zz PTR held in planning', v_pm)
  returning id into t2;
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t2, v_dev);
  update public.general_tasks set routing_state = 'released' where id = t2;
  perform pg_temp.must_be('...and held work enters the default stage',
    (select stage = 1 and status = 'in_progress' and routing_state = 'released'
       from public.general_tasks where id = t2));
  perform pg_temp.must_refuse_with('...and the service role cannot insert unheld work past the first stage',
    format($q$insert into public.general_tasks (project_id, title, created_by, routing_state, stage)
              values (%L, 'Zz PTR unheld at stage one', %L, 'released', 1)$q$, p, v_pm),
    'Give this task a holder before moving it on.');
  perform pg_temp.act_as(v_pm);
  update public.general_projects set require_assignee = false, default_stage = 0 where id = p;

  ------------------------------------------------------------ subtasks before done
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('a parent cannot be done while a subtask is open',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, par),
    'Finish its subtasks first.');
  perform pg_temp.must_refuse_with('moving to the last stage counts as done',
    format($q$update public.general_tasks set stage = 2 where id = %L$q$, par),
    'Finish its subtasks first.');
  update public.general_tasks set stage = 1 where id = par;
  perform pg_temp.must_be('...a parent can still start',
    (select status = 'in_progress' from public.general_tasks where id = par));
  update public.general_tasks set status = 'done' where id = sub;
  update public.general_tasks set status = 'done' where id = par;
  perform pg_temp.must_be('...and is done once its subtasks are',
    (select status = 'done' and stage = 2 from public.general_tasks where id = par));

  -- QA passing a parent is the same move to done.
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(q, 'Zz PTR QA parent', v_pm);
  t2 := pg_temp.released_task(q, 'Zz PTR QA subtask', v_pm, t);
  update public.general_tasks set stage = 1 where id = t;
  perform pg_temp.act_as(v_qa);
  perform pg_temp.must_refuse_with('...and QA cannot pass a parent with an open subtask',
    format('select public.qa_pass_general_task(%L)', t),
    'Finish its subtasks first.');

  -- A default past the QA stage enters at the QA stage while QA is active.
  perform pg_temp.act_as(v_pm);
  update public.general_projects
     set stages = array['To do', 'Build', 'Testing', 'Review', 'Done'], default_stage = 3
   where id = q;
  perform pg_temp.act_as(v_coord);
  insert into public.general_tasks (project_id, title) values (q, 'Zz PTR sent past QA')
  returning id into t2;
  select updated_at into v_upd from public.general_tasks where id = t2;
  perform public.send_work_tasks_to_teams(q,
    jsonb_build_array(jsonb_build_object('id', t2, 'team_id', qteam, 'updated_at', v_upd)));
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(q, 'Zz PTR inserted past QA', v_pm);
  perform pg_temp.must_be('a default past the QA stage lands at the QA stage while QA is active',
    (select count(*) = 2 and bool_and(stage = 2 and status = 'in_progress' and qa_entered_at is not null)
       from public.general_tasks where id in (t, t2)));
  delete from public.general_members where project_id = q and user_id = v_qa;
  t := pg_temp.released_task(q, 'Zz PTR past QA, no QA', v_pm);
  perform pg_temp.must_be('...and the default stage itself without active QA',
    (select stage = 3 and status = 'in_progress' from public.general_tasks where id = t));

  perform pg_temp.act_as_service();
  par := pg_temp.released_task(p, 'Zz PTR loose parent', v_pm);
  sub := pg_temp.released_task(p, 'Zz PTR loose subtask', v_pm, par);
  perform pg_temp.act_as(v_pm);
  update public.general_projects set require_subtasks_done = false where id = p;
  update public.general_tasks set stage = 2 where id = par;
  perform pg_temp.must_be('the subtask rule can be turned off',
    (select status = 'done' from public.general_tasks where id = par)
    and (select status = 'todo' from public.general_tasks where id = sub));
  update public.general_projects set require_subtasks_done = true where id = p;

  ------------------------------------------------------------ one holder
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR two holders', v_pm);
  t2 := pg_temp.released_task(p, 'Zz PTR one holder', v_pm);
  insert into public.general_task_assignees (project_id, task_id, user_id) values
    (p, t, v_dev), (p, t, v_dev2), (p, t2, v_dev);
  perform pg_temp.act_as(v_pm);
  update public.general_projects set allow_multiple_assignees = false where id = p;
  perform pg_temp.must_refuse_with('one-holder mode refuses a second holder and keeps existing pairs',
    format($q$insert into public.general_task_assignees (project_id, task_id, user_id)
              values (%L, %L, %L)$q$, p, t2, v_dev2),
    'This project allows one holder per task.');
  insert into public.general_task_assignees (project_id, task_id, user_id)
  values (p, t2, v_dev) on conflict do nothing;
  perform pg_temp.must_be('...the two holders stay, and re-adding the one holder is harmless',
    (select count(*) from public.general_task_assignees where task_id = t) = 2
    and (select count(*) from public.general_task_assignees where task_id = t2) = 1);
  delete from public.general_task_assignees where task_id = t2;
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t2, v_dev2);
  perform pg_temp.must_be('...and a task with no holder takes one',
    (select count(*) from public.general_task_assignees where task_id = t2 and user_id = v_dev2) = 1);

  ------------------------------------------------------------ dependencies
  perform pg_temp.act_as(v_pm);
  update public.general_projects set allow_multiple_assignees = true where id = p;
  perform pg_temp.act_as_service();
  w1 := pg_temp.released_task(p, 'Zz PTR waits', v_pm);
  w2 := pg_temp.released_task(p, 'Zz PTR blocker', v_pm);
  w3 := pg_temp.released_task(p, 'Zz PTR third', v_pm);
  w4 := pg_temp.released_task(p, 'Zz PTR spare', v_pm);
  other := pg_temp.released_task(p2, 'Zz PTR other project task', v_pm);
  update public.general_tasks set team_id = team where id in (w1, w2, w3, w4);
  perform pg_temp.act_as(v_pm);
  perform public.add_general_task_dependency(w1, w2);
  perform public.add_general_task_dependency(w1, w2);  -- a second add is harmless
  perform pg_temp.must_be('a dependency links two tasks in one project',
    (select count(*) = 1 and bool_and(created_by = v_pm and project_id = p)
       from public.general_task_dependencies where task_id = w1 and depends_on_id = w2));
  perform pg_temp.must_refuse_with('a dependency across projects is refused',
    format('select public.add_general_task_dependency(%L, %L)', w1, other), 'same project');
  perform pg_temp.must_refuse_with('...and a task cannot wait for itself',
    format('select public.add_general_task_dependency(%L, %L)', w1, w1), 'wait for itself');
  perform pg_temp.must_refuse_with('a dependency loop is refused',
    format('select public.add_general_task_dependency(%L, %L)', w2, w1), 'wait on each other');
  perform public.add_general_task_dependency(w2, w3);
  perform pg_temp.must_refuse_with('...through three tasks too',
    format('select public.add_general_task_dependency(%L, %L)', w3, w1), 'wait on each other');

  update public.general_tasks set stage = 1 where id = w1;
  perform pg_temp.must_be('a waiting task can start',
    (select status = 'in_progress' from public.general_tasks where id = w1));
  perform pg_temp.must_refuse_with('a waiting task can start but cannot be done',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, w1),
    'Waiting for Zz PTR blocker. Finish it first.');
  perform pg_temp.must_refuse_with('...by the last stage either',
    format($q$update public.general_tasks set stage = 2 where id = %L$q$, w1),
    'Waiting for Zz PTR blocker. Finish it first.');
  perform public.remove_general_task_dependency(w1, w2);
  update public.general_tasks set status = 'done' where id = w1;
  perform pg_temp.must_be('removing the dependency lets it finish',
    (select status = 'done' from public.general_tasks where id = w1)
    and not exists (select 1 from public.general_task_dependencies where task_id = w1));

  update public.general_projects set allow_dependencies = false where id = p;
  perform pg_temp.must_refuse_with('dependencies off refuses new links but keeps existing ones',
    format('select public.add_general_task_dependency(%L, %L)', w4, w3), 'Dependencies are turned off');
  perform pg_temp.must_refuse_with('...and the existing link still holds its task back',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, w2),
    'Waiting for Zz PTR third. Finish it first.');
  update public.general_tasks set status = 'done' where id = w3;
  update public.general_tasks set status = 'done' where id = w2;
  perform pg_temp.must_be('...until its blocker is done',
    (select status = 'done' from public.general_tasks where id = w2)
    and exists (select 1 from public.general_task_dependencies where task_id = w2 and depends_on_id = w3));
  update public.general_projects set allow_dependencies = true where id = p;

  -- Who may link: planners, the lead of the task's team, the task's holders.
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_refuse_with('a member who cannot edit the task cannot link it',
    format('select public.add_general_task_dependency(%L, %L)', w4, w3), 'can link it');
  perform pg_temp.must_refuse_with('...or unlink one',
    format('select public.remove_general_task_dependency(%L, %L)', w2, w3), 'can link it');
  perform pg_temp.act_as(v_stake);
  perform pg_temp.must_refuse_with('...and neither can a stakeholder',
    format('select public.add_general_task_dependency(%L, %L)', w4, w3), 'Stakeholders can view');
  perform pg_temp.act_as(v_dev);
  perform public.add_general_task_dependency(w4, w3);
  perform pg_temp.must_be('...while the lead of the task''s team can',
    exists (select 1 from public.general_task_dependencies where task_id = w4 and depends_on_id = w3));
  perform pg_temp.act_as_service();
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, w4, v_dev2);
  perform pg_temp.act_as(v_dev2);
  perform public.remove_general_task_dependency(w4, w3);
  perform public.add_general_task_dependency(w4, w2);
  perform pg_temp.must_be('...and so can whoever holds it',
    (select array_agg(depends_on_id) = array[w2] from public.general_task_dependencies where task_id = w4));

  -- Private planning tasks keep their links private.
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR private one')
  returning id into w1;
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR private two')
  returning id into w3;
  perform public.add_general_task_dependency(w1, w3);
  perform public.add_general_task_dependency(w4, w3);
  update public.general_projects set visibility = 'workspace' where id = p;
  perform pg_temp.act_as(v_view);
  perform pg_temp.must_be('fixture: a workspace viewer reads the released link',
    exists (select 1 from public.general_task_dependencies where task_id = w4 and depends_on_id = w2));
  perform pg_temp.must_be('a viewer cannot see dependencies of private planning tasks',
    not exists (select 1 from public.general_task_dependencies where depends_on_id = w3));
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_be('...nor can a member',
    not exists (select 1 from public.general_task_dependencies where depends_on_id = w3));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('...while the project manager can',
    (select count(*) = 2 from public.general_task_dependencies where depends_on_id = w3));
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_refuse_with('...and a blocker the member cannot see is not named',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, w4),
    'Waiting for a task you can''t see yet.');
  perform pg_temp.act_as(v_pm);
  update public.general_projects set visibility = 'private' where id = p;

  -- QA passing a waiting task is the same move to done.
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values (q, v_qa, 'qa');
  t := pg_temp.released_task(q, 'Zz PTR QA waits', v_pm);
  t2 := pg_temp.released_task(q, 'Zz PTR QA blocker', v_pm);
  perform pg_temp.act_as(v_pm);
  perform public.add_general_task_dependency(t, t2);
  perform pg_temp.act_as(v_qa);
  perform pg_temp.must_refuse_with('qa pass of a waiting task is refused',
    format('select public.qa_pass_general_task(%L)', t), 'Waiting for Zz PTR QA blocker.');
  perform pg_temp.act_as(v_pm);
  perform public.remove_general_task_dependency(t, t2);
  perform pg_temp.act_as(v_qa);
  perform public.qa_pass_general_task(t);
  perform pg_temp.must_be('...and passes once the link is gone',
    (select status = 'done' from public.general_tasks where id = t));

  ------------------------------------------------------------ adding subtasks
  perform pg_temp.act_as_service();
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Zz PTR sprint', current_date, current_date + 14) returning id into v_sprint;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PTR milestone', current_date + 30) returning id into v_mile;
  par := pg_temp.released_task(p, 'Zz PTR held parent', v_pm);
  update public.general_tasks set team_id = team, sprint_id = v_sprint, milestone_id = v_mile
   where id = par;
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, par, v_dev2);
  perform pg_temp.act_as(v_pm);
  update public.general_projects set default_priority = 'high' where id = p;
  perform pg_temp.act_as(v_dev2);
  sub := public.create_general_subtask(par, '  Zz PTR holder''s subtask  ', 'Steps');
  perform pg_temp.must_be('a holder can add a subtask to a released task and it is released',
    (select parent_id = par and routing_state = 'released' and created_by = v_dev2
            and title = 'Zz PTR holder''s subtask' and description = 'Steps' and priority = 'high'
       from public.general_tasks where id = sub));
  perform pg_temp.must_be('...its history names who added it',
    exists (select 1 from public.general_task_events
             where task_id = sub and kind = 'created' and actor_id = v_dev2));
  perform pg_temp.must_be('...and the caller''s session is as it was',
    auth.uid() = v_dev2
    and coalesce(nullif(current_setting('collabify.subtask_op', true), ''), 'off') = 'off');
  perform pg_temp.must_refuse_with('...an insert that fails',
    format($q$select public.create_general_subtask(%L, 'Zz PTR too long', repeat('x', 20001))$q$, par),
    'general_tasks_description_len');
  perform pg_temp.must_be('...leaves the caller''s session as it was too',
    auth.uid() = v_dev2
    and coalesce(nullif(current_setting('collabify.subtask_op', true), ''), 'off') = 'off');
  perform pg_temp.must_be('a subtask takes the parent''s team, sprint and milestone',
    (select team_id = team and sprint_id = v_sprint and milestone_id = v_mile
       from public.general_tasks where id = sub));
  perform pg_temp.act_as(v_dev);
  t := public.create_general_subtask(par, 'Zz PTR lead''s subtask', '', now() + interval '3 days');
  perform pg_temp.must_be('...and so can the lead of the parent''s team',
    (select parent_id = par and due_at is not null from public.general_tasks where id = t));

  perform pg_temp.act_as_service();
  t2 := pg_temp.released_task(p, 'Zz PTR unheld parent', v_pm);
  update public.general_tasks set team_id = team where id = t2;
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_refuse_with('a member who neither holds nor leads cannot add a subtask',
    format($q$select public.create_general_subtask(%L, 'Zz PTR nope')$q$, t2), 'can add a subtask');
  perform pg_temp.act_as(v_stake);
  perform pg_temp.must_refuse_with('a stakeholder or workspace viewer cannot add a subtask',
    format($q$select public.create_general_subtask(%L, 'Zz PTR nope')$q$, par), 'Stakeholders can view');
  perform pg_temp.act_as_service();
  update public.general_projects set visibility = 'workspace' where id = p;
  perform pg_temp.act_as(v_view);
  perform pg_temp.must_refuse_with('...the workspace viewer',
    format($q$select public.create_general_subtask(%L, 'Zz PTR nope')$q$, par), 'not on this project');
  perform pg_temp.act_as_service();
  update public.general_projects set visibility = 'private' where id = p;

  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planning parent two')
  returning id into pp;
  sub2 := public.create_general_subtask(pp, 'Zz PTR planned subtask');
  perform pg_temp.must_be('a subtask follows its parent''s release state',
    (select parent_id = pp and routing_state = 'planning' and created_by = v_pm
       from public.general_tasks where id = sub2));
  perform pg_temp.must_refuse_with('a subtask cannot get subtasks of its own',
    format($q$select public.create_general_subtask(%L, 'Zz PTR grandchild')$q$, sub2),
    'can''t have its own subtasks');
  perform pg_temp.must_refuse_with('...a subtask needs a title',
    format($q$select public.create_general_subtask(%L, '   ')$q$, pp), 'Give the subtask a title.');
  update public.general_tasks set status = 'done' where id = t2;
  perform pg_temp.must_refuse_with('a done parent takes no new subtasks',
    format($q$select public.create_general_subtask(%L, 'Zz PTR late')$q$, t2),
    'Reopen the task before adding a subtask.');
  update public.general_projects set allow_subtasks = false where id = p;
  perform pg_temp.must_refuse_with('...and subtasks off refuses new ones',
    format($q$select public.create_general_subtask(%L, 'Zz PTR off')$q$, pp),
    'Subtasks are turned off for this project.');
  update public.general_projects set allow_subtasks = true, default_priority = 'normal' where id = p;

  ------------------------------------------------------------ subtasks move with their parent
  perform pg_temp.act_as(v_pm);
  select updated_at into v_upd from public.general_tasks where id = pp;
  perform pg_temp.checked(format('select public.send_work_tasks_to_teams(%L, %L::jsonb)', p,
    jsonb_build_array(jsonb_build_object('id', pp, 'team_id', team, 'updated_at', v_upd))));
  perform pg_temp.must_be('sending a parent releases its subtasks',
    (select routing_state = 'released' from public.general_tasks where id = pp)
    and (select routing_state = 'released' and team_id = team from public.general_tasks where id = sub2));
  perform pg_temp.must_be('...and the subtask''s history says so',
    exists (select 1 from public.general_task_events where task_id = sub2 and kind = 'sent_to_team'));
  perform pg_temp.act_as(v_dev);
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, sub2, v_dev2);
  perform pg_temp.checked(format($q$select public.return_work_task(%L, 'Zz PTR not ready')$q$, pp));
  perform pg_temp.must_be('...the lead no longer sees the subtask',
    not exists (select 1 from public.general_tasks where id = sub2));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('returning a parent takes its subtasks back to planning',
    (select routing_state = 'planning' from public.general_tasks where id = pp)
    and (select routing_state = 'planning' from public.general_tasks where id = sub2)
    and not exists (select 1 from public.general_task_assignees where task_id = sub2));
  perform pg_temp.act_as(v_pm);
  select updated_at into v_upd from public.general_tasks where id = sub2;
  perform pg_temp.must_refuse_with('a subtask is not sent without its parent',
    format('select pg_temp.checked(%L)',
      format('select public.send_work_tasks_to_teams(%L, %L::jsonb)', p,
        jsonb_build_array(jsonb_build_object('id', sub2, 'team_id', team, 'updated_at', v_upd)))),
    'subtasks move with it');
  perform pg_temp.checked(format('select public.send_work_tasks_to_teams(%L, %L::jsonb)', p,
    (select jsonb_agg(jsonb_build_object('id', x.id, 'team_id', team, 'updated_at', x.updated_at))
       from public.general_tasks x where x.id in (pp, sub2))));
  perform pg_temp.must_be('...while a parent and its subtask go out together',
    (select count(*) = 2 and bool_and(routing_state = 'released')
       from public.general_tasks where id in (pp, sub2)));

  ------------------------------------------------------------ require an assignee, both ways
  perform pg_temp.act_as(v_pm);
  update public.general_projects set require_assignee = true where id = p;
  perform pg_temp.act_as_service();
  t := pg_temp.released_task(p, 'Zz PTR held, then let go', v_pm);
  update public.general_tasks set team_id = team where id = t;
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t, v_dev2);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set stage = 2 where id = t;
  delete from public.general_task_assignees where task_id = t;
  update public.general_tasks set stage = 1 where id = t;
  perform pg_temp.must_be('an unheld task can move back a stage',
    (select stage = 1 and status = 'in_progress' from public.general_tasks where id = t));
  update public.general_tasks set stage = 0 where id = t;
  perform pg_temp.must_be('an unheld task can move back to the first stage',
    (select stage = 0 and status = 'todo' from public.general_tasks where id = t));
  perform pg_temp.must_refuse_with('...and still cannot move forward again',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, t),
    'Give this task a holder before moving it on.');
  insert into public.general_tasks (project_id, title) values (p, 'Zz PTR planned past the start')
  returning id into t2;
  update public.general_tasks set stage = 1 where id = t2;
  select updated_at into v_upd from public.general_tasks where id = t2;
  perform public.send_work_tasks_to_teams(p,
    jsonb_build_array(jsonb_build_object('id', t2, 'team_id', team, 'updated_at', v_upd)));
  perform pg_temp.must_be('releasing an unheld task past the first stage puts it in the first stage',
    (select stage = 0 and status = 'todo' and routing_state = 'released' and qa_entered_at is null
       from public.general_tasks where id = t2));
  update public.general_projects set require_assignee = false where id = p;

  ------------------------------------------------------------ class boards
  perform pg_temp.act_as_service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_teach, 'syllabus', 'Zz PTR syllabus', 'x/ptr.pdf', 'ptr.pdf') returning id into v_syl;
  insert into public.syllabus_weeks (resource_id, week_no, title) values (v_syl, 1, 'Week 1');
  perform pg_temp.act_as(v_teach);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_teach, 'Zz PTR class', 'ZZP', 'ZZPTR-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_syl)
  returning id into v_class;
  perform pg_temp.act_as_service();
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience)
  values (v_class, v_teach, 'Zz PTR class project', 'activity', 1, 1, 'individual')
  returning id into v_cproj;
  insert into public.project_boards (project_id, student_id) values (v_cproj, v_stu)
  returning id into v_board;
  insert into public.general_projects (name, space_id, class_board_id, created_by, preset)
  select 'Zz PTR class Files', c.space_id, v_board, v_teach, 'class-board'
    from public.classes c where c.id = v_class
  returning id into cb;
  perform pg_temp.must_be('fixture: a class board''s Files project', cb is not null);
  update public.general_projects
     set default_priority = 'urgent', default_stage = 1, require_assignee = true,
         allow_subtasks = false, allow_multiple_assignees = false
   where id = cb;
  insert into public.general_tasks (project_id, title) values (cb, 'Zz PTR class task')
  returning id into t;
  perform pg_temp.must_be('...a class-board task ignores the project''s default stage',
    (select status = 'todo' and coalesce(stage, 0) = 0 from public.general_tasks where id = t));
  update public.general_tasks set status = 'done' where id = t;
  perform pg_temp.must_be('class boards are unaffected',
    (select priority = 'normal' and status = 'done' from public.general_tasks where id = t)
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'project_tasks'
                       and column_name in ('priority', 'parent_id')));
end;
$$;

rollback;
