-- supabase/tests/project-notification-rules.test.sql
-- A work project's notification settings, reminder stamps, the assignment
-- switch and the personal check on the milestone overdue alert.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-notification-rules.test.sql
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

/** A released task, written by the service role as the handoff would leave it. */
create or replace function pg_temp.released_task(p_project uuid, p_title text, p_by uuid)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (p_project, p_title, p_by, 'released')
  returning id into v;
  return v;
end;
$$;

/**
 * A work project in the space for the reminders job: the project manager,
 * a coordinator, two members, a stakeholder and QA (so QA is active).
 */
create or replace function pg_temp.rem_project(p_space uuid, p_name text, p_pm uuid, p_coord uuid,
  p_dev uuid, p_dev2 uuid, p_stake uuid, p_qa uuid)
returns uuid language plpgsql as $$
declare
  p uuid;
begin
  perform pg_temp.act_as(p_pm);
  p := (public.create_general_project(p_name, '', null, null, null, null, p_space)).id;
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values
    (p, p_coord, 'coordinator'), (p, p_dev, 'member'), (p, p_dev2, 'member'),
    (p, p_stake, 'stakeholder'), (p, p_qa, 'qa');
  return p;
end;
$$;

/** A running sprint, made the way the app makes one. */
create or replace function pg_temp.running_sprint(p uuid, p_name text, p_starts date, p_ends date)
returns uuid language plpgsql as $$
declare
  s uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, p_name, p_starts, p_ends) returning id into s;
  update public.general_sprints set state = 'active' where id = s;
  return s;
end;
$$;

/** A released task due at p_due, held by p_holder (when given). */
create or replace function pg_temp.due_task(p uuid, p_title text, p_due timestamptz,
  p_holder uuid, p_by uuid)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_tasks (project_id, title, created_by, routing_state, due_at)
  values (p, p_title, p_by, 'released', p_due)
  returning id into v;
  if p_holder is not null then
    insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
    values (p, v, p_holder, p_by);
  end if;
  return v;
end;
$$;

/** A released task in a sprint, with a status, held by p_holder (when given). */
create or replace function pg_temp.sprint_task(p uuid, p_sprint uuid, p_title text, p_status text,
  p_holder uuid, p_by uuid)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id, status)
  values (p, p_title, p_by, 'released', p_sprint, p_status::public.general_task_status)
  returning id into v;
  if p_holder is not null then
    insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
    values (p, v, p_holder, p_by);
  end if;
  return v;
end;
$$;

/** How many notices of one type a person has from one project. */
create or replace function pg_temp.got(p_user uuid, p_project uuid, p_type text) returns int
language sql as $$
  select count(*)::int from public.notifications
   where user_id = p_user and general_project_id = p_project and type::text = p_type;
$$;

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager on P
  v_coord uuid := gen_random_uuid();  -- coordinator on P
  v_dev   uuid := gen_random_uuid();  -- member on P, leads the team
  v_dev2  uuid := gen_random_uuid();  -- member on P, on the team
  v_teach uuid := gen_random_uuid();  -- teaches the class
  v_stu1  uuid := gen_random_uuid();  -- student, class board
  v_stu2  uuid := gen_random_uuid();  -- student, class board
  v_stake uuid := gen_random_uuid();  -- stakeholder on the reminder projects
  v_qa    uuid := gen_random_uuid();  -- QA on the reminder projects
  v_pmb   uuid := gen_random_uuid();  -- project manager on the sprint completion projects
  v_space2 uuid;
  v_space uuid;
  pa      uuid;  -- reminder projects, one per check
  pb      uuid;
  pb2     uuid;
  pc      uuid;
  pd      uuid;
  pe      uuid;
  pf      uuid;
  pg      uuid;
  ph      uuid;
  pi      uuid;
  pj      uuid;
  pk      uuid;
  pl      uuid;
  pm2     uuid;
  x1      uuid;
  x2      uuid;
  x3      uuid;
  x4      uuid;
  v_ids   uuid[];
  qa1     uuid;  -- sprint completion projects, one per check
  qa2     uuid;
  qa3     uuid;
  qa4     uuid;
  qa5     uuid;
  qa6     uuid;
  qa7     uuid;
  qa8     uuid;
  y1      uuid;
  y2      uuid;
  y3      uuid;
  y4      uuid;
  -- The job's mornings: 08:00 Manila on Mar 9, 10, 11 and 12, 2030.
  d0      timestamptz := timestamptz '2030-03-09 00:00:00+00';
  d1      timestamptz := timestamptz '2030-03-10 00:00:00+00';
  d2      timestamptz := timestamptz '2030-03-11 00:00:00+00';
  d3      timestamptz := timestamptz '2030-03-12 00:00:00+00';
  n2      int;
  n3      int;
  p       uuid;  -- the project under test
  po      uuid;  -- milestone overdue alerts
  team    uuid;
  s1      uuid;
  t1      uuid;
  t2      uuid;
  t3      uuid;
  t4      uuid;
  tp      uuid;  -- private planning work, sent to the team
  m1      uuid;
  m2      uuid;
  v_who   uuid;
  v_res   uuid;
  v_class uuid;
  v_set   uuid;
  v_group uuid;
  v_cproj uuid;
  v_board uuid;
  cb      uuid;  -- a class board's Files project
  ct      uuid;
  b1      boolean;
  b2      boolean;
  n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,    'zz-pnr-pm@example.test'),
      (v_coord, 'zz-pnr-coord@example.test'),
      (v_dev,   'zz-pnr-dev@example.test'),
      (v_dev2,  'zz-pnr-dev2@example.test'),
      (v_teach, 'zz-pnr-teach@example.test'),
      (v_stu1,  'zz-pnr-stu1@example.test'),
      (v_stu2,  'zz-pnr-stu2@example.test'),
      (v_stake, 'zz-pnr-stake@example.test'),
      (v_qa,    'zz-pnr-qa@example.test'),
      (v_pmb,   'zz-pnr-pmb@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,    'zz-pnr-pm@example.test',    'Zz', 'Pnrpm',    'member',  'active', false, true),
    (v_coord, 'zz-pnr-coord@example.test', 'Zz', 'Pnrcoord', 'member',  'active', false, false),
    (v_dev,   'zz-pnr-dev@example.test',   'Zz', 'Pnrdev',   'member',  'active', false, false),
    (v_dev2,  'zz-pnr-dev2@example.test',  'Zz', 'Pnrdev2',  'member',  'active', false, false),
    (v_teach, 'zz-pnr-teach@example.test', 'Zz', 'Pnrteach', 'member',  'active', true,  false),
    (v_stu1,  'zz-pnr-stu1@example.test',  'Zz', 'Pnrstu1',  'student', 'active', false, false),
    (v_stu2,  'zz-pnr-stu2@example.test',  'Zz', 'Pnrstu2',  'student', 'active', false, false),
    (v_stake, 'zz-pnr-stake@example.test', 'Zz', 'Pnrstake', 'member',  'active', false, false),
    (v_qa,    'zz-pnr-qa@example.test',    'Zz', 'Pnrqa',    'member',  'active', false, false),
    (v_pmb,   'zz-pnr-pmb@example.test',   'Zz', 'Pnrpmb',   'member',  'active', false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PNR space', '')).id;
  p := (public.create_general_project('Zz PNR project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_coord, 'member'), (v_space, v_dev, 'member'), (v_space, v_dev2, 'member'),
    (v_space, v_stake, 'member'), (v_space, v_qa, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_coord, 'coordinator'), (p, v_dev, 'member'), (p, v_dev2, 'member');
  insert into public.general_teams (project_id, name) values (p, 'Zz PNR team') returning id into team;
  insert into public.general_team_members (project_id, team_id, user_id) values
    (p, team, v_dev), (p, team, v_dev2);
  update public.general_teams set leader_id = v_dev where id = team;

  ------------------------------------------------------------ defaults
  perform pg_temp.act_as(v_pm);
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Zz PNR sprint', current_date, current_date + 13) returning id into s1;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PNR goal', current_date + 10) returning id into m1;
  perform pg_temp.act_as_service();
  t1 := pg_temp.released_task(p, 'Zz PNR one', v_pm);
  perform pg_temp.must_be('new projects get the PDF defaults',
    (select sprint_end_reminder_days = 1 and task_overdue_alerts
            and milestone_due_reminder_days = 2 and task_assignment_notices
            and sprint_completion_notices
       from public.general_projects where id = p)
    and (select end_reminded_at is null from public.general_sprints where id = s1)
    and not exists (select 1 from public.general_task_reminders where task_id = t1)
    and (select due_reminded_at is null from public.general_milestones where id = m1));

  ------------------------------------------------------------ who changes the settings
  n := 0;
  foreach v_who in array array[v_coord, v_dev] loop
    perform pg_temp.act_as(v_who);
    n := n + pg_temp.rows_of(format($q$update public.general_projects set sprint_end_reminder_days = 3 where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set task_overdue_alerts = false where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set milestone_due_reminder_days = 7 where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set task_assignment_notices = false where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set sprint_completion_notices = false where id = %L$q$, p));
  end loop;
  perform pg_temp.act_as(v_pm);
  n := n * 100 + pg_temp.rows_of(format($q$update public.general_projects
                                            set sprint_end_reminder_days = null, task_overdue_alerts = false,
                                                milestone_due_reminder_days = null, task_assignment_notices = false,
                                                sprint_completion_notices = false
                                          where id = %L$q$, p));
  b1 := (select sprint_end_reminder_days is null and not task_overdue_alerts
                and milestone_due_reminder_days is null and not task_assignment_notices
                and not sprint_completion_notices
           from public.general_projects where id = p);
  update public.general_projects
     set sprint_end_reminder_days = 1, task_overdue_alerts = true, milestone_due_reminder_days = 2,
         task_assignment_notices = true, sprint_completion_notices = true
   where id = p;
  perform pg_temp.must_be('only the project manager can change the notification settings',
    n = 1 and b1
    and (select sprint_end_reminder_days = 1 and task_overdue_alerts
                and milestone_due_reminder_days = 2 and task_assignment_notices
                and sprint_completion_notices
           from public.general_projects where id = p));

  ------------------------------------------------------------ offered choices
  perform pg_temp.must_refuse_with('reminder days accept only the offered choices',
    format($q$update public.general_projects set sprint_end_reminder_days = 4 where id = %L$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...no zero days for the sprint reminder',
    format($q$update public.general_projects set sprint_end_reminder_days = 0 where id = %L$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...nor five days for the milestone reminder',
    format($q$update public.general_projects set milestone_due_reminder_days = 5 where id = %L$q$, p),
    'check constraint');
  update public.general_projects set sprint_end_reminder_days = 3, milestone_due_reminder_days = 7 where id = p;
  b1 := (select sprint_end_reminder_days = 3 and milestone_due_reminder_days = 7
           from public.general_projects where id = p);
  update public.general_projects set sprint_end_reminder_days = 2, milestone_due_reminder_days = 3 where id = p;
  b2 := (select sprint_end_reminder_days = 2 and milestone_due_reminder_days = 3
           from public.general_projects where id = p);
  update public.general_projects set sprint_end_reminder_days = 1, milestone_due_reminder_days = 1 where id = p;
  perform pg_temp.must_be('...and every offered choice saves',
    b1 and b2
    and (select sprint_end_reminder_days = 1 and milestone_due_reminder_days = 1
           from public.general_projects where id = p));
  update public.general_projects set sprint_end_reminder_days = 1, milestone_due_reminder_days = 2 where id = p;

  ------------------------------------------------------------ assignment notices
  perform pg_temp.act_as_service();
  t2 := pg_temp.released_task(p, 'Zz PNR two', v_pm);
  t3 := pg_temp.released_task(p, 'Zz PNR three', v_pm);
  t4 := pg_temp.released_task(p, 'Zz PNR four', v_pm);
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (p, t1, v_dev2, v_pm);
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (p, t2, v_dev, v_dev);
  b1 := (select count(*) = 1 and bool_and(title = 'Zz PNR one' and preview = 'Zz PNR project'
                                          and general_task_id = t1 and general_project_id = p)
           from public.notifications where user_id = v_dev2 and type = 'general_task_assigned')
    and not exists (select 1 from public.notifications
                     where user_id = v_dev and type = 'general_task_assigned');
  update public.notification_prefs set task_assignments = false where user_id = v_dev;
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (p, t3, v_dev, v_pm);
  perform pg_temp.must_be('assignment notices on keep today''s behaviour',
    b1 and not exists (select 1 from public.notifications
                        where user_id = v_dev and type = 'general_task_assigned'));
  update public.notification_prefs set task_assignments = true where user_id = v_dev;

  perform pg_temp.act_as(v_pm);
  update public.general_projects set task_assignment_notices = false where id = p;
  insert into public.general_tasks (project_id, title, team_id)
  values (p, 'Zz PNR planning', team) returning id into tp;
  perform public.send_work_tasks_to_teams(p, (
    select jsonb_agg(jsonb_build_object('id', x.id, 'team_id', team, 'updated_at', x.updated_at))
      from public.general_tasks x where x.id = tp));
  perform pg_temp.act_as_service();
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (p, t4, v_dev2, v_pm);
  perform pg_temp.must_be('assignment notices off stops general_task_assigned only',
    (select count(*) = 1 from public.notifications
      where user_id = v_dev2 and type = 'general_task_assigned')
    and exists (select 1 from public.general_task_assignees where task_id = t4 and user_id = v_dev2)
    and exists (select 1 from public.notifications
                 where user_id = v_dev and type = 'work_task_handoff' and general_task_id = tp));
  perform pg_temp.act_as(v_pm);
  update public.general_projects set task_assignment_notices = true where id = p;
  perform pg_temp.act_as_service();
  delete from public.general_task_assignees where task_id = t4;
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (p, t4, v_dev2, v_pm);
  perform pg_temp.must_be('...and turning them back on sends again',
    (select count(*) = 2 from public.notifications
      where user_id = v_dev2 and type = 'general_task_assigned'));

  ------------------------------------------------------------ milestone overdue, personal switch
  -- Dates far ahead, so "today" comes only from p_now; its own project, so
  -- no other milestone is overdue then.
  perform pg_temp.act_as(v_pm);
  po := (public.create_general_project('Zz PNR alerts', '', null, null, null, null, v_space)).id;
  insert into public.general_milestones (project_id, name, due_on)
  values (po, 'Zz PNR beta', date '2030-12-09') returning id into m2;
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values (po, v_coord, 'coordinator');
  update public.notification_prefs set deadline_reminders = false where user_id = v_coord;
  n := public.send_milestone_overdue_alerts(timestamptz '2030-12-10 00:00:00+00', po);
  b1 := n = 1
    and (select count(*) = 1 and bool_and(user_id = v_pm and title = 'Zz PNR beta is overdue in Zz PNR alerts')
           from public.notifications where general_project_id = po and type = 'milestone_overdue');
  update public.notification_prefs set deadline_reminders = false where user_id = v_pm;
  perform pg_temp.act_as(v_pm);
  update public.general_milestones set due_on = date '2030-12-11' where id = m2;
  perform pg_temp.act_as_service();
  n := public.send_milestone_overdue_alerts(timestamptz '2030-12-12 00:00:00+00', po);
  perform pg_temp.must_be('a person''s deadline switch silences the milestone overdue alert',
    b1 and n = 1
    and (select count(*) = 1 from public.notifications where general_project_id = po and type = 'milestone_overdue')
    and (select overdue_notified_at = timestamptz '2030-12-12 00:00:00+00'
           from public.general_milestones where id = m2));
  update public.notification_prefs set deadline_reminders = true where user_id in (v_pm, v_coord);

  ------------------------------------------------------------ stamps: people can't write them
  perform pg_temp.act_as(v_pm);
  update public.general_sprints set end_reminded_at = now() where id = s1;
  update public.general_milestones set due_reminded_at = now() where id = m1;
  b1 := (select end_reminded_at is null from public.general_sprints where id = s1)
    and (select due_reminded_at is null from public.general_milestones where id = m1);
  insert into public.general_sprints (project_id, name, starts_on, ends_on, end_reminded_at)
  values (p, 'Zz PNR stamped sprint', current_date + 14, current_date + 27, now()) returning id into v_who;
  b2 := (select end_reminded_at is null from public.general_sprints where id = v_who);
  delete from public.general_sprints where id = v_who;
  insert into public.general_milestones (project_id, name, due_on, due_reminded_at)
  values (p, 'Zz PNR stamped goal', current_date + 20, now()) returning id into v_who;
  b2 := b2 and (select due_reminded_at is null from public.general_milestones where id = v_who);
  delete from public.general_milestones where id = v_who;
  perform pg_temp.act_as_service();
  -- The job, or a restore, writes them.
  update public.general_sprints set end_reminded_at = timestamptz '2030-01-01 00:00:00+00' where id = s1;
  update public.general_milestones set due_reminded_at = timestamptz '2030-01-01 00:00:00+00' where id = m1;
  perform pg_temp.act_as(v_pm);
  update public.general_sprints set end_reminded_at = null, goal = 'Zz PNR goal' where id = s1;
  update public.general_milestones set due_reminded_at = null, name = 'Zz PNR goal renamed' where id = m1;
  perform pg_temp.must_be('a signed-in person cannot write a reminder stamp',
    b1 and b2
    and (select end_reminded_at = timestamptz '2030-01-01 00:00:00+00' and goal = 'Zz PNR goal'
           from public.general_sprints where id = s1)
    and (select due_reminded_at = timestamptz '2030-01-01 00:00:00+00' and name = 'Zz PNR goal renamed'
           from public.general_milestones where id = m1));

  -- A task's overdue stamp lives off the task row, where no client reaches it.
  perform pg_temp.act_as_service();
  insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
  values (t1, p, timestamptz '2030-01-01 00:00:00+00');
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('...nor read the task reminder stamps',
    'select count(*) from public.general_task_reminders', 'permission denied');
  perform pg_temp.must_refuse_with('...nor add one',
    format($q$insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
              values (%L, %L, now())$q$, t2, p),
    'permission denied');
  perform pg_temp.must_refuse_with('...nor remove one',
    format($q$delete from public.general_task_reminders where task_id = %L$q$, t1),
    'permission denied');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the task stamp is not a task column, not in realtime, behind RLS',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'general_tasks'
                   and column_name = 'overdue_notified_at')
    and not exists (select 1 from pg_publication_tables
                     where schemaname = 'public' and tablename = 'general_task_reminders')
    and (select relrowsecurity from pg_class where oid = 'public.general_task_reminders'::regclass)
    and not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'general_task_reminders')
    and exists (select 1 from public.general_task_reminders where task_id = t1));
  perform pg_temp.act_as(v_pm);

  ------------------------------------------------------------ stamps: a later date clears them
  update public.general_sprints set ends_on = ends_on - 1 where id = s1;
  b1 := (select end_reminded_at is not null from public.general_sprints where id = s1);
  update public.general_sprints set ends_on = ends_on + 3 where id = s1;
  perform pg_temp.must_be('moving a date later clears its stamp, moving it earlier keeps it (sprint end)',
    b1 and (select end_reminded_at is null from public.general_sprints where id = s1));

  -- t1 had no due date and carries the stamp row added above; setting one keeps it.
  update public.general_tasks set due_at = timestamptz '2030-06-10 09:00:00+00' where id = t1;
  update public.general_tasks set title = 'Zz PNR one renamed' where id = t1;
  update public.general_tasks set due_at = timestamptz '2030-06-09 09:00:00+00' where id = t1;
  perform pg_temp.act_as_service();
  b1 := exists (select 1 from public.general_task_reminders where task_id = t1);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set due_at = timestamptz '2030-06-12 09:00:00+00' where id = t1;
  perform pg_temp.act_as_service();
  b2 := not exists (select 1 from public.general_task_reminders where task_id = t1);
  insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
  values (t1, p, timestamptz '2030-06-13 00:00:00+00');
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set due_at = null where id = t1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('moving a date later clears its stamp, moving it earlier keeps it (task due)',
    b1 and b2 and not exists (select 1 from public.general_task_reminders where task_id = t1));

  insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
  values (t2, p, timestamptz '2030-06-13 00:00:00+00');
  b1 := exists (select 1 from public.general_task_reminders where task_id = t2);
  delete from public.general_tasks where id = t2;
  perform pg_temp.must_be('deleting a task deletes its reminder stamp',
    b1 and not exists (select 1 from public.general_task_reminders where task_id = t2));
  perform pg_temp.act_as(v_pm);

  update public.general_milestones set due_on = due_on - 1 where id = m1;
  b1 := (select due_reminded_at is not null from public.general_milestones where id = m1);
  update public.general_milestones set due_on = due_on + 5 where id = m1;
  b2 := (select due_reminded_at is null from public.general_milestones where id = m1);
  perform pg_temp.act_as_service();
  update public.general_milestones set due_reminded_at = timestamptz '2030-01-02 00:00:00+00' where id = m1;
  perform pg_temp.act_as(v_pm);
  update public.general_projects set require_milestone_due = false where id = p;
  update public.general_milestones set due_on = null where id = m1;
  perform pg_temp.must_be('moving a date later clears its stamp, moving it earlier keeps it (milestone due)',
    b1 and b2 and (select due_reminded_at is null from public.general_milestones where id = m1));
  update public.general_projects set require_milestone_due = true where id = p;

  ------------------------------------------------------------ class boards
  perform pg_temp.act_as_service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_teach, 'syllabus', 'Zz PNR syllabus', 'x/pnr.pdf', 'pnr.pdf') returning id into v_res;
  insert into public.syllabus_weeks (resource_id, week_no, title) values (v_res, 1, 'Week 1');
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_teach, 'Zz PNR class', 'ZZN', 'ZZPNR-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_res)
  returning id into v_class;
  insert into public.class_members (class_id, student_id, status) values
    (v_class, v_stu1, 'active'), (v_class, v_stu2, 'active');
  insert into public.group_sets (class_id, name, mode) values (v_class, 'Zz PNR set', 'manual')
  returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz PNR group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values
    (v_group, v_set, v_stu1), (v_group, v_set, v_stu2);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience,
                               group_set_id, due_at)
  values (v_class, v_teach, 'Zz PNR class project', 'activity', 1, 1, 'group', v_set,
          now() + interval '7 days')
  returning id into v_cproj;
  perform public.ensure_project_boards(v_cproj);
  select id into v_board from public.project_boards
   where project_id = v_cproj and group_id = v_group;
  perform pg_temp.act_as(v_stu1);
  cb := public.ensure_class_board_repo(v_board);
  insert into public.general_tasks (project_id, title) values (cb, 'Zz PNR class task')
  returning id into ct;
  perform pg_temp.act_as_service();
  update public.general_projects set task_assignment_notices = false where id = cb;
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (cb, ct, v_stu2, v_stu1);
  perform pg_temp.must_be('class boards are untouched',
    exists (select 1 from public.notifications
             where user_id = v_stu2 and type = 'general_task_assigned' and general_task_id = ct)
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public'
                       and table_name in ('projects', 'project_tasks', 'project_milestones')
                       and column_name in ('sprint_end_reminder_days', 'task_overdue_alerts',
                                           'milestone_due_reminder_days', 'task_assignment_notices',
                                           'sprint_completion_notices', 'end_reminded_at',
                                           'overdue_notified_at', 'due_reminded_at')));

  ------------------------------------------------------------ the daily reminders job
  -- Every run passes a fixed morning and its own project, so it never touches
  -- any other project. Each check has its own project.

  -- Sprint ending: 1 day before by default.
  pa := pg_temp.rem_project(v_space, 'Zz PNR sprint A', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(pa, 'Zz Sprint A', date '2030-03-01', date '2030-03-11');
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id, status) values
    (pa, 'Zz A open one', v_pm, 'released', x1, 'todo'),
    (pa, 'Zz A open two', v_pm, 'released', x1, 'in_progress'),
    (pa, 'Zz A done',     v_pm, 'released', x1, 'done'),
    (pa, 'Zz A planning', v_pm, 'planning', x1, 'todo'),
    (pa, 'Zz A archived', v_pm, 'released', x1, 'todo'),
    (pa, 'Zz A trashed',  v_pm, 'released', x1, 'todo');
  update public.general_tasks set archived_at = now(), archived_by = v_pm
   where project_id = pa and title = 'Zz A archived';
  update public.general_tasks set archived_at = now(), archived_by = v_pm, trashed_at = now(), trashed_by = v_pm
   where project_id = pa and title = 'Zz A trashed';
  n := public.send_project_reminders(d0, pa);
  b1 := n = 0 and pg_temp.got(v_pm, pa, 'sprint_ending_soon') = 0;
  n := public.send_project_reminders(d1, pa);
  n2 := public.send_project_reminders(d1, pa);
  perform pg_temp.must_be('a sprint ending tomorrow tells the planners once with the unfinished count',
    b1 and n = 1 and n2 = 0
    and (select count(*) = 2 and count(distinct user_id) = 2
                and bool_and(title = 'Zz Sprint A ends tomorrow'
                             and preview = '2 tasks remain unfinished.'
                             and general_task_id is null)
           from public.notifications where general_project_id = pa and type = 'sprint_ending_soon')
    and pg_temp.got(v_pm, pa, 'sprint_ending_soon') = 1
    and pg_temp.got(v_coord, pa, 'sprint_ending_soon') = 1
    and (select end_reminded_at = d1 from public.general_sprints where id = x1));

  -- A missed morning: the next run still reminds, until the sprint has ended.
  pb := pg_temp.rem_project(v_space, 'Zz PNR sprint B', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(pb, 'Zz Sprint B', date '2030-03-01', date '2030-03-10');
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id, status)
  values (pb, 'Zz B open', v_pm, 'released', x1, 'todo');
  n := public.send_project_reminders(d2, pb);
  n2 := public.send_project_reminders(d1, pb);
  pb2 := pg_temp.rem_project(v_space, 'Zz PNR sprint B2', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  update public.general_projects set sprint_end_reminder_days = 3 where id = pb2;
  x2 := pg_temp.running_sprint(pb2, 'Zz Sprint B2', date '2030-03-01', date '2030-03-12');
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id, status)
  values (pb2, 'Zz B2 done', v_pm, 'released', x2, 'done');
  n3 := public.send_project_reminders(d0, pb2);
  perform pg_temp.must_be('a sprint ending reminder catches up after a missed morning',
    n = 0 and n2 = 1 and n3 = 1
    and (select count(*) = 2 and bool_and(title = 'Zz Sprint B ends today'
                                          and preview = '1 task remains unfinished.')
           from public.notifications where general_project_id = pb and type = 'sprint_ending_soon')
    and (select count(*) = 2 and bool_and(title = 'Zz Sprint B2 ends in 3 days'
                                          and preview = 'Every task is done.')
           from public.notifications where general_project_id = pb2 and type = 'sprint_ending_soon'));

  -- Overdue tasks: the morning after the due day, in Manila time.
  pc := pg_temp.rem_project(v_space, 'Zz PNR overdue C', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.due_task(pc, 'Zz C one', timestamptz '2030-03-09 07:00:00+08', v_dev, v_pm);
  x2 := pg_temp.due_task(pc, 'Zz C two', timestamptz '2030-03-08 23:30:00+08', v_pm, v_pm);
  x3 := pg_temp.due_task(pc, 'Zz C three', timestamptz '2030-03-10 00:30:00+08', v_dev2, v_pm);
  n := public.send_project_reminders(d1, pc);
  b1 := n = 2
    and (select count(*) = 1 and bool_and(general_task_id = x1 and title = 'Zz C one is overdue'
                                          and preview = 'It was due Mar 9.')
           from public.notifications where user_id = v_dev and general_project_id = pc
            and type = 'general_task_overdue')
    and (select count(*) = 1 and bool_and(title = 'Zz C two is overdue' and preview = 'It was due Mar 8.')
           from public.notifications where user_id = v_pm and type = 'general_task_overdue'
            and general_task_id = x2)
    and (select count(*) = 2 and count(distinct user_id) = 2
                and bool_and(user_id in (v_pm, v_coord)
                             and title = '2 tasks became overdue in Zz PNR overdue C'
                             and preview = 'Open Tasks to see them.')
           from public.notifications where general_project_id = pc and type = 'general_task_overdue'
            and general_task_id is null)
    and pg_temp.got(v_dev2, pc, 'general_task_overdue') = 0
    and (select count(*) = 2 and bool_and(project_id = pc and overdue_notified_at = d1)
           from public.general_task_reminders where task_id in (x1, x2))
    and not exists (select 1 from public.general_task_reminders where task_id = x3);
  n := public.send_project_reminders(d2, pc);
  perform pg_temp.must_be('an overdue task tells its holders and sends the planners one summary',
    b1 and n = 1
    and pg_temp.got(v_dev2, pc, 'general_task_overdue') = 1
    and (select count(*) = 2 and bool_and(user_id in (v_pm, v_coord)
                                          and title = '1 task became overdue in Zz PNR overdue C')
           from public.notifications where general_project_id = pc and type = 'general_task_overdue'
            and general_task_id is null and title like '1 %')
    and pg_temp.got(v_dev, pc, 'general_task_overdue') = 1);

  -- What never alerts.
  pd := pg_temp.rem_project(v_space, 'Zz PNR never D', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  insert into public.general_tasks (project_id, title, created_by, routing_state, due_at, status) values
    (pd, 'Zz D planning', v_pm, 'planning', timestamptz '2030-03-01 09:00:00+08', 'todo'),
    (pd, 'Zz D done',     v_pm, 'released', timestamptz '2030-03-01 09:00:00+08', 'done'),
    (pd, 'Zz D archived', v_pm, 'released', timestamptz '2030-03-01 09:00:00+08', 'todo'),
    (pd, 'Zz D trashed',  v_pm, 'released', timestamptz '2030-03-01 09:00:00+08', 'todo');
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  select pd, id, v_dev, v_pm from public.general_tasks where project_id = pd;
  update public.general_tasks set archived_at = now(), archived_by = v_pm
   where project_id = pd and title = 'Zz D archived';
  update public.general_tasks set archived_at = now(), archived_by = v_pm, trashed_at = now(), trashed_by = v_pm
   where project_id = pd and title = 'Zz D trashed';
  n := public.send_project_reminders(d1, pd);
  perform pg_temp.must_be('private planning, done, archived and trashed tasks never alert',
    n = 0
    and (select count(*) = 4 from public.general_task_assignees where project_id = pd)
    and (select trashed_at is not null from public.general_tasks
          where project_id = pd and title = 'Zz D trashed')
    and not exists (select 1 from public.notifications
                     where general_project_id = pd and type = 'general_task_overdue')
    and not exists (select 1 from public.general_task_reminders where project_id = pd));

  -- A task waiting in QA is still open.
  pe := pg_temp.rem_project(v_space, 'Zz PNR qa E', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  insert into public.general_tasks (project_id, title, created_by, routing_state, due_at, status, stage)
  values (pe, 'Zz E in QA', v_pm, 'released', timestamptz '2030-03-05 09:00:00+08', 'in_progress',
          public.general_qa_stage_index(pe))
  returning id into x1;
  insert into public.general_task_assignees (project_id, task_id, user_id, assigned_by)
  values (pe, x1, v_dev, v_pm);
  n := public.send_project_reminders(d1, pe);
  perform pg_temp.must_be('a task in QA can be overdue',
    (select qa_entered_at is not null and status <> 'done' from public.general_tasks where id = x1)
    and public.general_project_has_qa(pe)
    and n = 1
    and (select count(*) = 1 from public.notifications
          where user_id = v_dev and general_task_id = x1 and type = 'general_task_overdue'));

  -- A later due time can alert again.
  pf := pg_temp.rem_project(v_space, 'Zz PNR later F', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.due_task(pf, 'Zz F moved', timestamptz '2030-03-05 09:00:00+08', v_dev, v_pm);
  n := public.send_project_reminders(d1, pf);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set due_at = timestamptz '2030-03-11 09:00:00+08' where id = x1;
  perform pg_temp.act_as_service();
  b1 := not exists (select 1 from public.general_task_reminders where task_id = x1);
  n2 := public.send_project_reminders(d2, pf);
  n3 := public.send_project_reminders(d3, pf);
  perform pg_temp.must_be('moving the due time later allows a new overdue alert',
    n = 1 and b1 and n2 = 0 and n3 = 1
    and (select count(*) = 2 and bool_and(preview in ('It was due Mar 5.', 'It was due Mar 11.'))
                and count(distinct preview) = 2
           from public.notifications where user_id = v_dev and general_task_id = x1
            and type = 'general_task_overdue')
    and (select overdue_notified_at = d3 from public.general_task_reminders where task_id = x1));

  -- Milestone due: 2 days before by default.
  pg := pg_temp.rem_project(v_space, 'Zz PNR goal G', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  insert into public.general_milestones (project_id, name, due_on)
  values (pg, 'Zz Goal G', date '2030-03-12') returning id into x1;
  n := public.send_project_reminders(d0, pg);
  n2 := public.send_project_reminders(d1, pg);
  b1 := n = 0 and n2 = 1
    and (select count(*) = 2 and count(distinct user_id) = 2
                and bool_and(user_id in (v_pm, v_coord) and title = 'Zz Goal G is due in 2 days'
                             and preview = 'Zz PNR goal G')
           from public.notifications where general_project_id = pg and type = 'milestone_due_soon')
    and (select due_reminded_at = d1 from public.general_milestones where id = x1);
  insert into public.general_milestones (project_id, name, due_on) values
    (pg, 'Zz Goal G tomorrow', date '2030-03-11'), (pg, 'Zz Goal G today', date '2030-03-10');
  n := public.send_project_reminders(d1, pg);
  n2 := public.send_project_reminders(d1, pg);
  perform pg_temp.must_be('a milestone due in two days tells the planners once',
    b1 and n = 2 and n2 = 0
    and pg_temp.got(v_pm, pg, 'milestone_due_soon') = 3
    and pg_temp.got(v_coord, pg, 'milestone_due_soon') = 3
    and pg_temp.got(v_dev, pg, 'milestone_due_soon') = 0
    and exists (select 1 from public.notifications where user_id = v_pm and general_project_id = pg
                   and title = 'Zz Goal G tomorrow is due tomorrow')
    and exists (select 1 from public.notifications where user_id = v_pm and general_project_id = pg
                   and title = 'Zz Goal G today is due today'));

  -- Reached, undated and past-due milestones.
  ph := pg_temp.rem_project(v_space, 'Zz PNR goal H', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  update public.general_projects
     set milestone_due_reminder_days = 7, milestone_completion = 'manual', require_milestone_due = false
   where id = ph;
  insert into public.general_milestones (project_id, name, due_on) values
    (ph, 'Zz Goal H reached', date '2030-03-12'),
    (ph, 'Zz Goal H undated', null),
    (ph, 'Zz Goal H late', date '2030-03-08');
  update public.general_milestones set reached_at = now()
   where project_id = ph and name = 'Zz Goal H reached';
  n := public.send_project_reminders(d1, ph);
  perform pg_temp.must_be('reached and undated milestones never get a due reminder',
    n = 0
    and (select reached_at is not null from public.general_milestones
          where project_id = ph and name = 'Zz Goal H reached')
    and not exists (select 1 from public.notifications
                     where general_project_id = ph and type = 'milestone_due_soon')
    and not exists (select 1 from public.general_milestones
                     where project_id = ph and due_reminded_at is not null));

  -- Each project switch.
  pi := pg_temp.rem_project(v_space, 'Zz PNR off I', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  update public.general_projects
     set sprint_end_reminder_days = null, task_overdue_alerts = false, milestone_due_reminder_days = null
   where id = pi;
  x1 := pg_temp.running_sprint(pi, 'Zz Sprint I', date '2030-03-01', date '2030-03-11');
  x2 := pg_temp.due_task(pi, 'Zz I late', timestamptz '2030-03-05 09:00:00+08', v_dev, v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (pi, 'Zz Goal I', date '2030-03-11') returning id into x3;
  -- Overdue alerts off still stamp the task, silently, so turning them on
  -- later sends no backlog. Sprints and milestones wait unstamped.
  n := public.send_project_reminders(d1, pi);
  b1 := n = 1
    and not exists (select 1 from public.notifications where general_project_id = pi
                     and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon'))
    and (select end_reminded_at is null from public.general_sprints where id = x1)
    and (select overdue_notified_at = d1 from public.general_task_reminders where task_id = x2)
    and (select due_reminded_at is null from public.general_milestones where id = x3);
  update public.general_projects set sprint_end_reminder_days = 1 where id = pi;
  n := public.send_project_reminders(d1, pi);
  b2 := n = 1 and pg_temp.got(v_pm, pi, 'sprint_ending_soon') = 1
    and pg_temp.got(v_pm, pi, 'general_task_overdue') = 0 and pg_temp.got(v_pm, pi, 'milestone_due_soon') = 0;
  update public.general_projects set task_overdue_alerts = true where id = pi;
  n := public.send_project_reminders(d1, pi);
  b2 := b2 and n = 0 and pg_temp.got(v_pm, pi, 'general_task_overdue') = 0
    and pg_temp.got(v_dev, pi, 'general_task_overdue') = 0 and pg_temp.got(v_pm, pi, 'milestone_due_soon') = 0;
  update public.general_projects set milestone_due_reminder_days = 1 where id = pi;
  n := public.send_project_reminders(d1, pi);
  perform pg_temp.must_be('each project switch off sends nothing for its notice',
    b1 and b2 and n = 1 and pg_temp.got(v_pm, pi, 'milestone_due_soon') = 1);

  -- A person's own switch.
  pj := pg_temp.rem_project(v_space, 'Zz PNR mine J', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(pj, 'Zz Sprint J', date '2030-03-01', date '2030-03-11');
  x2 := pg_temp.due_task(pj, 'Zz J late', timestamptz '2030-03-05 09:00:00+08', v_dev, v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (pj, 'Zz Goal J', date '2030-03-11') returning id into x3;
  update public.notification_prefs set deadline_reminders = false where user_id in (v_coord, v_dev);
  n := public.send_project_reminders(d1, pj);
  update public.notification_prefs set deadline_reminders = true where user_id in (v_coord, v_dev);
  perform pg_temp.must_be('a person''s deadline switch silences their reminders',
    n = 3
    and pg_temp.got(v_pm, pj, 'sprint_ending_soon') = 1
    and pg_temp.got(v_pm, pj, 'general_task_overdue') = 1
    and pg_temp.got(v_pm, pj, 'milestone_due_soon') = 1
    and not exists (select 1 from public.notifications
                     where general_project_id = pj and user_id in (v_coord, v_dev)
                       and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon'))
    and (select end_reminded_at = d1 from public.general_sprints where id = x1)
    and exists (select 1 from public.general_task_reminders where task_id = x2)
    and (select due_reminded_at = d1 from public.general_milestones where id = x3));

  -- Archived and trashed projects.
  pk := pg_temp.rem_project(v_space, 'Zz PNR archived K', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  pl := pg_temp.rem_project(v_space, 'Zz PNR trashed L', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  foreach v_who in array array[pk, pl] loop
    perform pg_temp.running_sprint(v_who, 'Zz Sprint gone', date '2030-03-01', date '2030-03-11');
    perform pg_temp.due_task(v_who, 'Zz gone late', timestamptz '2030-03-05 09:00:00+08', v_dev, v_pm);
    insert into public.general_milestones (project_id, name, due_on)
    values (v_who, 'Zz Goal gone', date '2030-03-11');
  end loop;
  update public.general_projects set archived_at = now() where id = pk;
  update public.general_projects set archived_at = now(), trashed_at = now(), trashed_by = v_pm where id = pl;
  n := public.send_project_reminders(d1, pk) + public.send_project_reminders(d1, pl);
  perform pg_temp.must_be('archived and trashed projects are skipped',
    n = 0
    and (select trashed_at is not null from public.general_projects where id = pl)
    and not exists (select 1 from public.notifications where general_project_id in (pk, pl)
                     and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon'))
    and not exists (select 1 from public.general_task_reminders where project_id in (pk, pl))
    and not exists (select 1 from public.general_sprints
                     where project_id in (pk, pl) and end_reminded_at is not null)
    and not exists (select 1 from public.general_milestones
                     where project_id in (pk, pl) and due_reminded_at is not null));

  -- Nobody but the planners and the holders.
  v_ids := array[pa, pb, pb2, pc, pd, pe, pf, pg, ph, pi, pj];
  perform pg_temp.must_be('stakeholders and qa get none of these',
    not exists (select 1 from public.notifications
                 where user_id in (v_stake, v_qa)
                   and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon'))
    and not exists (select 1 from public.notifications
                     where user_id in (v_dev, v_dev2) and general_project_id = any (v_ids)
                       and type in ('sprint_ending_soon', 'milestone_due_soon')));

  -- Every project once more, a day after its last run.
  select count(*) into n2 from public.notifications
   where general_project_id = any (v_ids)
     and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon');
  n := 0;
  foreach v_who in array v_ids loop
    n := n + public.send_project_reminders(d3, v_who);
  end loop;
  perform pg_temp.must_be('a second run sends nothing new',
    n = 0
    and (select count(*) = n2 from public.notifications
          where general_project_id = any (v_ids)
            and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon')));

  -- Applying the file marks what already qualifies, switches or not.
  pm2 := pg_temp.rem_project(v_space, 'Zz PNR applied M', v_pm, v_coord, v_dev, v_dev2, v_stake, v_qa);
  update public.general_projects
     set sprint_end_reminder_days = null, task_overdue_alerts = false, milestone_due_reminder_days = null
   where id = pm2;
  x1 := pg_temp.running_sprint(pm2, 'Zz Sprint M', date '2030-03-01', date '2030-03-12');
  x2 := pg_temp.due_task(pm2, 'Zz M late', timestamptz '2030-03-05 09:00:00+08', v_dev, v_pm);
  insert into public.general_tasks (project_id, title, created_by, routing_state, due_at)
  values (pm2, 'Zz M planning', v_pm, 'planning', timestamptz '2030-03-05 09:00:00+08')
  returning id into x4;
  insert into public.general_milestones (project_id, name, due_on)
  values (pm2, 'Zz Goal M', date '2030-03-16') returning id into x3;
  insert into public.general_milestones (project_id, name, due_on)
  values (pm2, 'Zz Goal M later', date '2030-03-20');
  n := public.mark_project_reminders_sent(d1, pm2);
  b1 := n = 3
    and (select end_reminded_at = d1 from public.general_sprints where id = x1)
    and (select overdue_notified_at = d1 from public.general_task_reminders where task_id = x2)
    and not exists (select 1 from public.general_task_reminders where task_id = x4)
    and (select due_reminded_at = d1 from public.general_milestones where id = x3)
    and (select due_reminded_at is null from public.general_milestones
          where project_id = pm2 and name = 'Zz Goal M later');
  update public.general_projects
     set sprint_end_reminder_days = 3, task_overdue_alerts = true, milestone_due_reminder_days = 7
   where id = pm2;
  n := public.send_project_reminders(d1, pm2);
  perform pg_temp.must_be('applying the file marks what already qualifies without notices',
    b1 and n = 0
    and not exists (select 1 from public.notifications where general_project_id = pm2
                     and type in ('sprint_ending_soon', 'general_task_overdue', 'milestone_due_soon')));

  perform pg_temp.must_be('only the database runs the reminders job',
    not has_function_privilege('authenticated', 'public.send_project_reminders(timestamptz, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.send_project_reminders(timestamptz, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mark_project_reminders_sent(timestamptz, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.mark_project_reminders_sent(timestamptz, uuid)', 'execute'));

  ------------------------------------------------------------ sprint completion
  -- Their own project manager and space: one person may create only 20
  -- projects an hour.
  perform pg_temp.act_as(v_pmb);
  v_space2 := (public.create_general_space('Zz PNR space 2', '')).id;
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space2, v_coord, 'member'), (v_space2, v_dev, 'member'), (v_space2, v_dev2, 'member'),
    (v_space2, v_stake, 'member'), (v_space2, v_qa, 'member');

  -- A person finishes: planners and holders of released, live tasks, not the
  -- finisher. A planner who holds a task gets one notice.
  qa1 := pg_temp.rem_project(v_space2, 'Zz PNR finish 1', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa1, 'Zz Sprint F1', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa1, x1, 'Zz F1 dev', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa1, x1, 'Zz F1 pm', 'done', v_pmb, v_pmb);
  y3 := pg_temp.sprint_task(qa1, x1, 'Zz F1 archived', 'done', v_dev2, v_pmb);
  update public.general_tasks set archived_at = now(), archived_by = v_pmb where id = y3;
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id)
  values (qa1, 'Zz F1 planning', v_pmb, 'planning', x1);
  perform pg_temp.act_as(v_coord);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('finishing a sprint tells the planners and the sprint team, not the finisher',
    (select state = 'completed' from public.general_sprints where id = x1)
    and (select count(*) = 2 and count(distinct user_id) = 2
                and bool_and(user_id in (v_pmb, v_dev)
                             and title = 'Zz Sprint F1 is finished'
                             and preview = '2 of 2 tasks done.'
                             and general_task_id is null)
           from public.notifications where general_project_id = qa1 and type = 'sprint_completed')
    and pg_temp.got(v_coord, qa1, 'sprint_completed') = 0
    and pg_temp.got(v_dev2, qa1, 'sprint_completed') = 0
    and pg_temp.got(v_stake, qa1, 'sprint_completed') = 0
    and pg_temp.got(v_qa, qa1, 'sprint_completed') = 0);

  -- Carried into the next sprint: the counts are from before the move.
  qa2 := pg_temp.rem_project(v_space2, 'Zz PNR finish 2', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa2, 'Zz Sprint F2', date '2030-03-01', date '2030-03-14');
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (qa2, 'Zz Sprint F2 next', date '2030-03-15', date '2030-03-28') returning id into x2;
  y1 := pg_temp.sprint_task(qa2, x1, 'Zz F2 done', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa2, x1, 'Zz F2 open', 'todo', v_dev2, v_pmb);
  y3 := pg_temp.sprint_task(qa2, x1, 'Zz F2 unheld', 'in_progress', null, v_pmb);
  insert into public.general_tasks (project_id, title, created_by, routing_state, sprint_id)
  values (qa2, 'Zz F2 planning', v_pmb, 'planning', x1) returning id into y4;
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, x2);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('carried-over holders are told and counts are from before the move',
    (select sprint_id = x2 from public.general_tasks where id = y2)
    and (select sprint_id = x2 from public.general_tasks where id = y3)
    and (select sprint_id = x1 from public.general_tasks where id = y1)
    and (select count(*) = 3 and count(distinct user_id) = 3
                and bool_and(user_id in (v_coord, v_dev, v_dev2)
                             and title = 'Zz Sprint F2 is finished'
                             and preview = '1 of 3 tasks done. 2 moved to Zz Sprint F2 next.')
           from public.notifications where general_project_id = qa2 and type = 'sprint_completed')
    and pg_temp.got(v_pmb, qa2, 'sprint_completed') = 0);

  -- Back to the backlog.
  qa3 := pg_temp.rem_project(v_space2, 'Zz PNR finish 3', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa3, 'Zz Sprint F3', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa3, x1, 'Zz F3 done', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa3, x1, 'Zz F3 open', 'todo', v_dev2, v_pmb);
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('work sent back to the backlog is counted in the preview',
    (select sprint_id is null from public.general_tasks where id = y2)
    and (select count(*) = 3 and bool_and(preview = '1 of 2 tasks done. 1 went back to the backlog.')
           from public.notifications where general_project_id = qa3 and type = 'sprint_completed')
    and pg_temp.got(v_dev2, qa3, 'sprint_completed') = 1);

  -- The automation: the planners already get sprint_automation.
  qa4 := pg_temp.rem_project(v_space2, 'Zz PNR finish 4', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa4, 'Zz Sprint F4', date '2030-02-22', date '2030-03-07');
  y1 := pg_temp.sprint_task(qa4, x1, 'Zz F4 done', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa4, x1, 'Zz F4 open', 'todo', v_dev2, v_pmb);
  y3 := pg_temp.sprint_task(qa4, x1, 'Zz F4 coord', 'done', v_coord, v_pmb);
  insert into public.general_sprint_settings (project_id, auto_finish, carry)
  values (qa4, true, 'backlog');
  n := public.run_sprint_automation(d1, qa4);
  perform pg_temp.must_be('the automation tells the sprint team but not the planners again',
    n = 1
    and (select state = 'completed' from public.general_sprints where id = x1)
    and (select sprint_id is null from public.general_tasks where id = y2)
    and (select count(*) = 2 and count(distinct user_id) = 2
                and bool_and(user_id in (v_dev, v_dev2)
                             and title = 'Zz Sprint F4 is finished'
                             and preview = '2 of 3 tasks done. 1 went back to the backlog.')
           from public.notifications where general_project_id = qa4 and type = 'sprint_completed')
    and pg_temp.got(v_pmb, qa4, 'sprint_completed') = 0
    and pg_temp.got(v_coord, qa4, 'sprint_completed') = 0
    and pg_temp.got(v_pmb, qa4, 'sprint_automation') = 1
    and pg_temp.got(v_coord, qa4, 'sprint_automation') = 1
    and coalesce(current_setting('collabify.sprint_automation', true), 'off') <> 'on');

  -- The project switch.
  qa5 := pg_temp.rem_project(v_space2, 'Zz PNR finish 5', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  update public.general_projects set sprint_completion_notices = false where id = qa5;
  x1 := pg_temp.running_sprint(qa5, 'Zz Sprint F5', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa5, x1, 'Zz F5 done', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa5, x1, 'Zz F5 open', 'todo', v_dev2, v_pmb);
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('sprint completion notices off sends nothing',
    (select state = 'completed' from public.general_sprints where id = x1)
    and (select sprint_id is null from public.general_tasks where id = y2)
    and not exists (select 1 from public.notifications
                     where general_project_id = qa5 and type = 'sprint_completed'));

  -- A person's own switch.
  qa6 := pg_temp.rem_project(v_space2, 'Zz PNR finish 6', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa6, 'Zz Sprint F6', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa6, x1, 'Zz F6 done', 'done', v_dev, v_pmb);
  y2 := pg_temp.sprint_task(qa6, x1, 'Zz F6 open', 'todo', v_dev2, v_pmb);
  update public.notification_prefs set project_updates = false where user_id in (v_coord, v_dev);
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  update public.notification_prefs set project_updates = true where user_id in (v_coord, v_dev);
  perform pg_temp.must_be('a person''s project updates switch silences it',
    (select count(*) = 1 and bool_and(user_id = v_dev2)
           from public.notifications where general_project_id = qa6 and type = 'sprint_completed'));

  -- Reopened and finished again.
  qa7 := pg_temp.rem_project(v_space2, 'Zz PNR finish 7', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa7, 'Zz Sprint F7', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa7, x1, 'Zz F7 done', 'done', v_dev, v_pmb);
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, null);
  perform public.reopen_general_sprint(x1);
  perform pg_temp.act_as(v_coord);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('reopening and finishing again announces again',
    (select state = 'completed' from public.general_sprints where id = x1)
    and pg_temp.got(v_dev, qa7, 'sprint_completed') = 2
    and pg_temp.got(v_pmb, qa7, 'sprint_completed') = 1
    and pg_temp.got(v_coord, qa7, 'sprint_completed') = 1);

  -- One task says "task", and an empty sprint says so.
  qa8 := pg_temp.rem_project(v_space2, 'Zz PNR finish 9', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa8, 'Zz Sprint F9', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa8, x1, 'Zz F9 done', 'done', v_dev, v_pmb);
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a sprint with one task says task, not tasks',
    (select count(*) = 2 and bool_and(user_id in (v_coord, v_dev)
                                      and preview = '1 of 1 task done.')
           from public.notifications where general_project_id = qa8 and type = 'sprint_completed'));
  delete from public.notifications where general_project_id = qa8 and type = 'sprint_completed';
  x2 := pg_temp.running_sprint(qa8, 'Zz Sprint F9 empty', date '2030-03-15', date '2030-03-28');
  perform pg_temp.act_as(v_pmb);
  perform public.complete_general_sprint(x2, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an empty sprint says no tasks were in it',
    (select count(*) = 1 and bool_and(user_id = v_coord
                                      and title = 'Zz Sprint F9 empty is finished'
                                      and preview = 'No tasks were in it.')
           from public.notifications where general_project_id = qa8 and type = 'sprint_completed'));

  -- Only a finish sends it.
  qa1 := pg_temp.rem_project(v_space2, 'Zz PNR finish 8', v_pmb, v_coord, v_dev, v_dev2, v_stake, v_qa);
  x1 := pg_temp.running_sprint(qa1, 'Zz Sprint F8', date '2030-03-01', date '2030-03-14');
  y1 := pg_temp.sprint_task(qa1, x1, 'Zz F8 done', 'done', v_dev, v_pmb);
  perform pg_temp.act_as(v_pmb);
  perform pg_temp.must_refuse_with('nobody can announce a sprint without finishing it',
    format('select public.notify_general_sprint_completed(%L, null)', x1),
    'finish');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...so the sprint team hears nothing',
    (select state = 'active' from public.general_sprints where id = x1)
    and not exists (select 1 from public.notifications
                     where general_project_id = qa1 and type = 'sprint_completed')
    and not has_function_privilege('anon', 'public.notify_general_sprint_completed(uuid, uuid)', 'execute'));
end;
$$;

rollback;
