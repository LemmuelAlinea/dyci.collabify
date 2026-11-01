-- supabase/tests/project-member-rules.test.sql
-- A work project's member options: members managing milestones and creating
-- tasks. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-member-rules.test.sql
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

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager on P and PA
  v_dev   uuid := gen_random_uuid();  -- member on P (the team's lead) and PA
  v_dev2  uuid := gen_random_uuid();  -- another member on P
  v_grant uuid := gen_random_uuid();  -- member on P with a manage_tasks grant
  v_coord uuid := gen_random_uuid();  -- coordinator on P
  v_qa    uuid := gen_random_uuid();  -- QA on P
  v_stake uuid := gen_random_uuid();  -- stakeholder on P
  v_view  uuid := gen_random_uuid();  -- in the space, not on P
  v_space uuid;
  p       uuid;  -- the project under test
  p2      uuid;  -- another project in the same space
  pa      uuid;  -- a project that gets archived
  team    uuid;
  team2   uuid;  -- P2's team
  m       uuid;
  m2      uuid;
  ma      uuid;
  s       uuid;
  t       uuid;
  t2      uuid;
  mine    uuid;
  sent    uuid;  -- v_dev2's task, sent to the team
  led     uuid;  -- v_dev's task, sent to the team v_dev leads
  mine2   uuid;  -- v_dev2's task, released without a send
  v_claims text;
  n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,    'zz-pmr-pm@example.test'),
      (v_dev,   'zz-pmr-dev@example.test'),
      (v_dev2,  'zz-pmr-dev2@example.test'),
      (v_grant, 'zz-pmr-grant@example.test'),
      (v_coord, 'zz-pmr-coord@example.test'),
      (v_qa,    'zz-pmr-qa@example.test'),
      (v_stake, 'zz-pmr-stake@example.test'),
      (v_view,  'zz-pmr-view@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,    'zz-pmr-pm@example.test',    'Zz', 'Pmrpm',    'member', 'active', false, true),
    (v_dev,   'zz-pmr-dev@example.test',   'Zz', 'Pmrdev',   'member', 'active', false, false),
    (v_dev2,  'zz-pmr-dev2@example.test',  'Zz', 'Pmrdev2',  'member', 'active', false, false),
    (v_grant, 'zz-pmr-grant@example.test', 'Zz', 'Pmrgrant', 'member', 'active', false, false),
    (v_coord, 'zz-pmr-coord@example.test', 'Zz', 'Pmrcoord', 'member', 'active', false, false),
    (v_qa,    'zz-pmr-qa@example.test',    'Zz', 'Pmrqa',    'member', 'active', false, false),
    (v_stake, 'zz-pmr-stake@example.test', 'Zz', 'Pmrstake', 'member', 'active', false, false),
    (v_view,  'zz-pmr-view@example.test',  'Zz', 'Pmrview',  'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PMR space', '')).id;
  p  := (public.create_general_project('Zz PMR project', '', null, null, null, null, v_space)).id;
  p2 := (public.create_general_project('Zz PMR other', '', null, null, null, null, v_space)).id;
  pa := (public.create_general_project('Zz PMR archived', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_dev, 'member'), (v_space, v_dev2, 'member'), (v_space, v_grant, 'member'),
    (v_space, v_coord, 'member'), (v_space, v_qa, 'member'), (v_space, v_stake, 'member'),
    (v_space, v_view, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_dev, 'member'), (p, v_dev2, 'member'), (p, v_grant, 'member'),
    (p, v_coord, 'coordinator'), (p, v_qa, 'qa'), (p, v_stake, 'stakeholder'),
    (pa, v_dev, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (p, v_grant, 'manage_tasks', v_pm);
  insert into public.general_teams (project_id, name) values (p, 'Zz PMR team') returning id into team;
  insert into public.general_team_members (project_id, team_id, user_id) values
    (p, team, v_dev), (p, team, v_dev2);
  update public.general_teams set leader_id = v_dev where id = team;
  insert into public.general_teams (project_id, name) values (p2, 'Zz PMR other team') returning id into team2;

  ------------------------------------------------------------ defaults
  perform pg_temp.must_be('both switches are off by default',
    (select not members_manage_milestones and not members_create_tasks
       from public.general_projects where id = p));

  ------------------------------------------------------------ milestones, switch off
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMR planners''', current_date + 10) returning id into m;
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('a member cannot create a milestone while the switch is off',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR nope', current_date)$q$, p),
    'row-level security');
  -- A write and a read in one expression share a snapshot, so they are apart.
  n := pg_temp.rows_of(format($q$update public.general_milestones set name = 'Zz PMR renamed' where id = %L$q$, m))
     + pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now() where id = %L$q$, m))
     + pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, m));
  perform pg_temp.must_be('...nor edit, mark reached or delete one',
    n = 0
    and exists (select 1 from public.general_milestones
                 where id = m and name = 'Zz PMR planners''' and reached_at is null));

  ------------------------------------------------------------ milestones, switch on
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_manage_milestones = true where id = p;
  perform pg_temp.act_as(v_dev);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMR member''s', current_date + 5) returning id into m2;
  n := pg_temp.rows_of(format($q$update public.general_milestones
                                   set name = 'Zz PMR member''s, renamed', due_on = current_date + 6
                                 where id = %L$q$, m2));
  n := n + pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now() where id = %L$q$, m2));
  perform pg_temp.must_be('a member can create, edit, mark reached and delete a milestone when the switch is on',
    n = 2
    and (select created_by = v_dev and name = 'Zz PMR member''s, renamed'
                and due_on = current_date + 6 and reached_at is not null
           from public.general_milestones where id = m2));
  n := pg_temp.rows_of(format($q$update public.general_milestones set reached_at = null where id = %L$q$, m2));
  perform pg_temp.must_be('...un-mark it',
    n = 1 and (select reached_at is null from public.general_milestones where id = m2));
  n := pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, m2));
  perform pg_temp.must_be('...and delete it',
    n = 1 and not exists (select 1 from public.general_milestones where id = m2));
  n := pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now() where id = %L$q$, m));
  perform pg_temp.must_be('...including one a planner made',
    n = 1 and (select reached_at is not null from public.general_milestones where id = m));

  -- A milestone tagged on tasks and linked to a sprint.
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMR tagged', current_date + 20) returning id into m2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on, milestone_id)
  values (p, 'Zz PMR sprint', current_date, current_date + 13, m2) returning id into s;
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Zz PMR planned in sprint', s)
  returning id into t;
  perform pg_temp.act_as_service();
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id)
  values (p, 'Zz PMR released in sprint', v_pm, 'released', s) returning id into t2;
  perform pg_temp.must_be('fixture: the sprint''s tasks carry its milestone',
    (select count(*) = 2 from public.general_tasks where id in (t, t2) and milestone_id = m2));
  perform pg_temp.act_as(v_dev);
  v_claims := current_setting('request.jwt.claims', true);
  perform pg_temp.must_be('...and deleting one that tags tasks and a sprint untags them',
    pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, m2)) = 1);
  -- Checked before anything sets the session again.
  perform pg_temp.must_be('...and the member''s session is as it was',
    auth.uid() = v_dev
    and current_setting('request.jwt.claims', true) = v_claims
    and coalesce(nullif(current_setting('collabify.general_archive_op', true), ''), 'off') = 'off');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the tasks and the sprint are untagged, nothing else moves',
    (select count(*) = 2 from public.general_tasks
      where id in (t, t2) and milestone_id is null and sprint_id = s)
    and (select milestone_id is null from public.general_sprints where id = s)
    and (select routing_state = 'planning' from public.general_tasks where id = t)
    and (select routing_state = 'released' from public.general_tasks where id = t2));

  ------------------------------------------------------------ tagging stays manage_tasks
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMR not for tagging', current_date + 30) returning id into m2;
  perform pg_temp.act_as_service();
  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, t2, v_dev2);
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_be('fixture: the holder can otherwise edit the task',
    pg_temp.rows_of(format($q$update public.general_tasks set title = 'Zz PMR held' where id = %L$q$, t2)) = 1);
  perform pg_temp.must_refuse_with('the milestone switch does not let a member tag tasks or link sprints',
    format($q$update public.general_tasks set milestone_id = %L where id = %L$q$, m2, t2),
    'tag a task with a milestone');
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...nor tag a task the lead''s team holds',
    format($q$update public.general_tasks set milestone_id = %L where id = %L$q$, m2, t2),
    'tag a task with a milestone');
  n := pg_temp.rows_of(format($q$update public.general_sprints set milestone_id = %L where id = %L$q$, m2, s));
  perform pg_temp.must_be('...nor link a sprint to a milestone',
    n = 0 and (select milestone_id is null from public.general_sprints where id = s));
  perform pg_temp.must_refuse_with('...nor add a sprint',
    format($q$insert into public.general_sprints (project_id, name, starts_on, ends_on, milestone_id)
              values (%L, 'Zz PMR member sprint', current_date, current_date + 6, %L)$q$, p, m2),
    'row-level security');

  ------------------------------------------------------------ grants
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_manage_milestones = false where id = p;
  perform pg_temp.act_as(v_grant);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMR granted', current_date + 3) returning id into ma;
  n := pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now(), name = 'Zz PMR granted, reached' where id = %L$q$, ma));
  perform pg_temp.must_be('a manage_tasks grant still manages milestones with the switch off',
    n = 1
    and (select reached_at is not null and created_by = v_grant and name = 'Zz PMR granted, reached'
           from public.general_milestones where id = ma));
  n := pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, ma));
  perform pg_temp.must_be('...and deletes them',
    n = 1 and not exists (select 1 from public.general_milestones where id = ma));
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...while a plain member is refused again',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR nope again', current_date)$q$, p),
    'row-level security');

  ------------------------------------------------------------ member tasks, switch off
  perform pg_temp.must_refuse_with('a member cannot create a task while the switch is off',
    format($q$select public.create_general_member_task(%L, 'Zz PMR nope')$q$, p),
    'This project doesn''t let members create tasks.');

  ------------------------------------------------------------ qa and stakeholders
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_manage_milestones = true, members_create_tasks = true
   where id = p;
  perform pg_temp.act_as(v_qa);
  perform pg_temp.must_refuse_with('qa and stakeholders are not members for these switches',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR qa', current_date)$q$, p),
    'row-level security');
  perform pg_temp.must_be('...qa edits no milestone',
    pg_temp.rows_of(format($q$update public.general_milestones set reached_at = null where id = %L$q$, m)) = 0);
  perform pg_temp.must_refuse_with('...qa creates no member task',
    format($q$select public.create_general_member_task(%L, 'Zz PMR qa task')$q$, p),
    'Only members use this. Planners create tasks from Plan.');
  perform pg_temp.act_as(v_stake);
  perform pg_temp.must_refuse_with('...a stakeholder creates no milestone',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR stake', current_date)$q$, p),
    'row-level security');
  perform pg_temp.must_be('...and deletes none',
    pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, m)) = 0);
  perform pg_temp.must_refuse_with('...and creates no member task',
    format($q$select public.create_general_member_task(%L, 'Zz PMR stake task')$q$, p),
    'Only members use this. Planners create tasks from Plan.');
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('planners keep creating tasks from Plan',
    format($q$select public.create_general_member_task(%L, 'Zz PMR pm task')$q$, p),
    'Only members use this. Planners create tasks from Plan.');
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('...coordinators too',
    format($q$select public.create_general_member_task(%L, 'Zz PMR coord task')$q$, p),
    'Only members use this. Planners create tasks from Plan.');
  perform pg_temp.act_as(v_view);
  perform pg_temp.must_refuse_with('someone off the project creates no member task',
    format($q$select public.create_general_member_task(%L, 'Zz PMR viewer task')$q$, p),
    'You are not on this project.');
  perform pg_temp.must_refuse_with('...nor a milestone',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR viewer', current_date)$q$, p),
    'row-level security');

  ------------------------------------------------------------ member tasks, switch on
  perform pg_temp.act_as(v_pm);
  update public.general_projects set default_priority = 'high' where id = p;
  perform pg_temp.act_as(v_dev);
  v_claims := current_setting('request.jwt.claims', true);
  mine := public.create_general_member_task(p, '  Zz PMR member task  ', 'Steps',
                                            now() + interval '4 days', team);
  -- Checked before anything sets the session again.
  perform pg_temp.must_be('...and the member''s session is as it was',
    auth.uid() = v_dev
    and current_setting('request.jwt.claims', true) = v_claims
    and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
    and coalesce(nullif(current_setting('collabify.subtask_op', true), ''), 'off') = 'off');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a member''s task starts in private planning with no holder',
    (select routing_state = 'planning' and created_by = v_dev and title = 'Zz PMR member task'
            and description = 'Steps' and due_at is not null and team_id = team
            and status = 'todo' and coalesce(stage, 0) = 0 and kind = 'task'
            and priority = 'high' and parent_id is null and sprint_id is null
            and milestone_id is null and reviewer_id is null and sent_at is null
            and weight = 1 and completed_at is null
       from public.general_tasks where id = mine)
    and not exists (select 1 from public.general_task_assignees where task_id = mine));
  perform pg_temp.must_be('...its history names who created it',
    exists (select 1 from public.general_task_events
             where task_id = mine and kind = 'created' and actor_id = v_dev));
  perform pg_temp.must_be('...it joins the end of the backlog',
    (select rank >= all (select x.rank from public.general_tasks x
                          where x.project_id = p and x.id <> mine)
       from public.general_tasks where id = mine));
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...an insert that fails',
    format($q$select public.create_general_member_task(%L, 'Zz PMR too long', repeat('x', 20001))$q$, p),
    'general_tasks_description_len');
  perform pg_temp.must_be('...leaves the member''s session as it was too',
    auth.uid() = v_dev
    and current_setting('request.jwt.claims', true) = v_claims
    and coalesce(nullif(current_setting('collabify.subtask_op', true), ''), 'off') = 'off');
  t := public.create_general_member_task(p, 'Zz PMR no team');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...a team is optional',
    (select routing_state = 'planning' and team_id is null and created_by = v_dev
       from public.general_tasks where id = t));
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...the title is required',
    format($q$select public.create_general_member_task(%L, '   ')$q$, p),
    'Give the task a title.');
  perform pg_temp.must_refuse_with('...the team must be the project''s',
    format($q$select public.create_general_member_task(%L, 'Zz PMR elsewhere', '', null, %L)$q$, p, team2),
    'Choose a team in this project.');
  perform pg_temp.act_as(v_dev2);
  t2 := public.create_general_member_task(p, 'Zz PMR another member''s task');

  ------------------------------------------------------------ who reads it
  -- The release boundary (general_task_readable) gives creators their unsent
  -- work only for QA bugs, so a member's planning task is the planners' until
  -- it is sent. The app tells the member "Sent to planners for review".
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_be('a member''s planning task stays with the planners: its creator does not read it, another member does not',
    not exists (select 1 from public.general_tasks where id in (mine, t, t2)));
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_be('...the other member does not read it either',
    not exists (select 1 from public.general_tasks where id = mine));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('...while the project manager reads it',
    exists (select 1 from public.general_tasks where id = mine and created_by = v_dev));
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_be('...and so does a coordinator',
    exists (select 1 from public.general_tasks where id = mine));

  ------------------------------------------------------------ sent tasks
  -- Once a planner sends a member's task, it is the team's: its creator keeps
  -- holder and lead rights only.
  perform pg_temp.act_as(v_dev2);
  sent := public.create_general_member_task(p, 'Zz PMR sent task');
  perform pg_temp.act_as(v_dev);
  led := public.create_general_member_task(p, 'Zz PMR lead''s sent task', 'Before', null, team);
  perform pg_temp.act_as(v_pm);
  perform public.send_work_tasks_to_teams(p, (
    select jsonb_agg(jsonb_build_object('id', x.id, 'team_id', team, 'updated_at', x.updated_at))
      from public.general_tasks x where x.id in (sent, led)));
  perform pg_temp.must_be('fixture: both are sent to the team, held by nobody',
    (select count(*) = 2 from public.general_tasks
      where id in (sent, led) and routing_state = 'released' and team_id = team
        and sent_at is not null)
    and not exists (select 1 from public.general_task_assignees where task_id in (sent, led)));
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_be('fixture: the creator reads their task once it is sent',
    exists (select 1 from public.general_tasks where id = sent and created_by = v_dev2));
  perform pg_temp.must_refuse_with('a member can''t edit, finish or delete their task once it is sent',
    format($q$update public.general_tasks set title = 'Zz PMR mine still' where id = %L$q$, sent),
    'This task belongs to its team now. Ask a planner or its holder to change it.');
  perform pg_temp.must_refuse_with('...nor finish it',
    format($q$update public.general_tasks set status = 'done' where id = %L$q$, sent),
    'This task belongs to its team now.');
  perform pg_temp.must_refuse_with('...nor delete it',
    format($q$delete from public.general_tasks where id = %L$q$, sent),
    'This task belongs to its team now.');
  perform pg_temp.must_refuse_with('a member can''t archive their task once it is sent',
    format($q$select public.archive_general_task(%L, true)$q$, sent),
    'This task belongs to its team now.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the task is as it was',
    (select title = 'Zz PMR sent task' and status <> 'done' and archived_at is null
            and routing_state = 'released'
       from public.general_tasks where id = sent));

  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_be('...the lead of its team still changes its description and dates',
    pg_temp.rows_of(format($q$update public.general_tasks
                                set description = 'After', due_at = now() + interval '9 days'
                              where id = %L$q$, led)) = 1);
  perform pg_temp.must_refuse_with('...but not its title as the creator',
    format($q$update public.general_tasks set title = 'Zz PMR lead renamed' where id = %L$q$, led),
    'This task belongs to its team now.');

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_be('a coordinator still edits a member''s task',
    pg_temp.rows_of(format($q$update public.general_tasks set title = 'Zz PMR sent, renamed' where id = %L$q$, sent)) = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the system still writes it',
    pg_temp.rows_of(format($q$update public.general_tasks set title = 'Zz PMR sent, by the system' where id = %L$q$, sent)) = 1);
  -- Work released without a send (from before the handoff) keeps its rules.
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (p, 'Zz PMR released before the handoff', v_dev2, 'released') returning id into mine2;
  perform pg_temp.act_as(v_dev2);
  perform pg_temp.must_be('...work released without a send keeps its creator rules',
    pg_temp.rows_of(format($q$update public.general_tasks set title = 'Zz PMR older, renamed' where id = %L$q$, mine2)) = 1);
  perform pg_temp.act_as_service();

  insert into public.general_task_assignees (project_id, task_id, user_id) values (p, sent, v_dev2);
  perform pg_temp.act_as(v_dev2);
  n := pg_temp.rows_of(format($q$update public.general_tasks set title = 'Zz PMR held by its creator' where id = %L$q$, sent));
  n := n + pg_temp.rows_of(format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, sent));
  perform public.archive_general_task(sent, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a member who holds their sent task works on it as a holder',
    n = 2
    and (select title = 'Zz PMR held by its creator' and status = 'in_progress'
                and archived_at is not null and archived_by = v_dev2
           from public.general_tasks where id = sent));

  ------------------------------------------------------------ archived
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_manage_milestones = true, members_create_tasks = true
   where id = pa;
  insert into public.general_milestones (project_id, name, due_on)
  values (pa, 'Zz PMR before archive', current_date + 7) returning id into ma;
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_be('fixture: before archiving, the member manages milestones on it',
    public.general_can_manage_milestones(pa));
  perform pg_temp.act_as_service();
  update public.general_projects set archived_at = now() where id = pa;
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('archived projects refuse member milestone and task writes',
    format($q$insert into public.general_milestones (project_id, name, due_on)
              values (%L, 'Zz PMR archived', current_date)$q$, pa),
    'row-level security');
  n := pg_temp.rows_of(format($q$update public.general_milestones set name = 'Zz PMR x' where id = %L$q$, ma))
     + pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now() where id = %L$q$, ma))
     + pg_temp.rows_of(format($q$delete from public.general_milestones where id = %L$q$, ma));
  perform pg_temp.must_be('...no milestone edit, reach or delete',
    n = 0 and not public.general_can_manage_milestones(pa));
  -- Members don't read an archived project, so the row is checked as the service role.
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the milestone is as it was',
    exists (select 1 from public.general_milestones
             where id = ma and name = 'Zz PMR before archive' and reached_at is null));
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('...and no member task',
    format($q$select public.create_general_member_task(%L, 'Zz PMR archived task')$q$, pa),
    'archived');

  ------------------------------------------------------------ switch off keeps existing
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_create_tasks = false where id = p;
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('turning the switch off stops new member tasks but keeps existing ones',
    format($q$select public.create_general_member_task(%L, 'Zz PMR after off')$q$, p),
    'This project doesn''t let members create tasks.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the member''s tasks stay in planning',
    (select count(*) = 3 from public.general_tasks
      where id in (mine, t, t2) and routing_state = 'planning'
        and archived_at is null and trashed_at is null));

  ------------------------------------------------------------ who flips the switches
  perform pg_temp.act_as(v_coord);
  n := pg_temp.rows_of(format($q$update public.general_projects
                                   set members_create_tasks = true, members_manage_milestones = false
                                 where id = %L$q$, p));
  perform pg_temp.act_as(v_dev);
  n := n + pg_temp.rows_of(format($q$update public.general_projects set members_create_tasks = true where id = %L$q$, p));
  perform pg_temp.act_as(v_grant);
  n := n + pg_temp.rows_of(format($q$update public.general_projects set members_create_tasks = true where id = %L$q$, p));
  perform pg_temp.act_as(v_stake);
  n := n + pg_temp.rows_of(format($q$update public.general_projects set members_create_tasks = true where id = %L$q$, p));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('only the project manager can change the switches',
    n = 0
    and (select not members_create_tasks and members_manage_milestones
           from public.general_projects where id = p));
  perform pg_temp.act_as(v_pm);
  n := pg_temp.rows_of(format($q$update public.general_projects
                                   set members_create_tasks = true, members_manage_milestones = false
                                 where id = %L$q$, p));
  perform pg_temp.must_be('...and the project manager can',
    n = 1
    and (select members_create_tasks and not members_manage_milestones
           from public.general_projects where id = p));
end;
$$;

rollback;
