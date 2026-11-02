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

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager on P
  v_coord uuid := gen_random_uuid();  -- coordinator on P
  v_dev   uuid := gen_random_uuid();  -- member on P, leads the team
  v_dev2  uuid := gen_random_uuid();  -- member on P, on the team
  v_teach uuid := gen_random_uuid();  -- teaches the class
  v_stu1  uuid := gen_random_uuid();  -- student, class board
  v_stu2  uuid := gen_random_uuid();  -- student, class board
  v_space uuid;
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
      (v_stu2,  'zz-pnr-stu2@example.test')
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
    (v_stu2,  'zz-pnr-stu2@example.test',  'Zz', 'Pnrstu2',  'student', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PNR space', '')).id;
  p := (public.create_general_project('Zz PNR project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_coord, 'member'), (v_space, v_dev, 'member'), (v_space, v_dev2, 'member');
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
    and (select overdue_notified_at is null from public.general_tasks where id = t1)
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
  update public.general_tasks set overdue_notified_at = now() where id = t1;
  update public.general_milestones set due_reminded_at = now() where id = m1;
  b1 := (select end_reminded_at is null from public.general_sprints where id = s1)
    and (select overdue_notified_at is null from public.general_tasks where id = t1)
    and (select due_reminded_at is null from public.general_milestones where id = m1);
  insert into public.general_sprints (project_id, name, starts_on, ends_on, end_reminded_at)
  values (p, 'Zz PNR stamped sprint', current_date + 14, current_date + 27, now()) returning id into v_who;
  b2 := (select end_reminded_at is null from public.general_sprints where id = v_who);
  delete from public.general_sprints where id = v_who;
  insert into public.general_milestones (project_id, name, due_on, due_reminded_at)
  values (p, 'Zz PNR stamped goal', current_date + 20, now()) returning id into v_who;
  b2 := b2 and (select due_reminded_at is null from public.general_milestones where id = v_who);
  delete from public.general_milestones where id = v_who;
  insert into public.general_tasks (project_id, title, overdue_notified_at)
  values (p, 'Zz PNR stamped task', now()) returning id into v_who;
  b2 := b2 and (select overdue_notified_at is null from public.general_tasks where id = v_who);
  perform pg_temp.act_as_service();
  delete from public.general_tasks where id = v_who;
  -- The job, or a restore, writes them.
  update public.general_sprints set end_reminded_at = timestamptz '2030-01-01 00:00:00+00' where id = s1;
  -- An undated task is never overdue, so it keeps no stamp.
  update public.general_tasks set overdue_notified_at = timestamptz '2030-01-01 00:00:00+00' where id = t1;
  b2 := b2 and (select overdue_notified_at is null from public.general_tasks where id = t1);
  update public.general_tasks
     set due_at = timestamptz '2030-06-01 09:00:00+00',
         overdue_notified_at = timestamptz '2030-01-01 00:00:00+00'
   where id = t1;
  update public.general_milestones set due_reminded_at = timestamptz '2030-01-01 00:00:00+00' where id = m1;
  perform pg_temp.act_as(v_pm);
  update public.general_sprints set end_reminded_at = null, goal = 'Zz PNR goal' where id = s1;
  update public.general_tasks set overdue_notified_at = null where id = t1;
  update public.general_milestones set due_reminded_at = null, name = 'Zz PNR goal renamed' where id = m1;
  perform pg_temp.must_be('a signed-in person cannot write a reminder stamp',
    b1 and b2
    and (select end_reminded_at = timestamptz '2030-01-01 00:00:00+00' and goal = 'Zz PNR goal'
           from public.general_sprints where id = s1)
    and (select overdue_notified_at = timestamptz '2030-01-01 00:00:00+00'
           from public.general_tasks where id = t1)
    and (select due_reminded_at = timestamptz '2030-01-01 00:00:00+00' and name = 'Zz PNR goal renamed'
           from public.general_milestones where id = m1));

  ------------------------------------------------------------ stamps: a later date clears them
  update public.general_sprints set ends_on = ends_on - 1 where id = s1;
  b1 := (select end_reminded_at is not null from public.general_sprints where id = s1);
  update public.general_sprints set ends_on = ends_on + 3 where id = s1;
  perform pg_temp.must_be('moving a date later clears its stamp, moving it earlier keeps it (sprint end)',
    b1 and (select end_reminded_at is null from public.general_sprints where id = s1));

  update public.general_tasks set due_at = timestamptz '2030-06-10 09:00:00+00' where id = t1;
  b1 := (select overdue_notified_at is null from public.general_tasks where id = t1);
  perform pg_temp.act_as_service();
  update public.general_tasks set overdue_notified_at = timestamptz '2030-06-11 00:00:00+00' where id = t1;
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set due_at = timestamptz '2030-06-09 09:00:00+00' where id = t1;
  b2 := (select overdue_notified_at is not null from public.general_tasks where id = t1);
  update public.general_tasks set due_at = timestamptz '2030-06-12 09:00:00+00' where id = t1;
  b2 := b2 and (select overdue_notified_at is null from public.general_tasks where id = t1);
  perform pg_temp.act_as_service();
  update public.general_tasks set overdue_notified_at = timestamptz '2030-06-13 00:00:00+00' where id = t1;
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set due_at = null where id = t1;
  perform pg_temp.must_be('moving a date later clears its stamp, moving it earlier keeps it (task due)',
    b1 and b2 and (select overdue_notified_at is null from public.general_tasks where id = t1));

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
end;
$$;

rollback;
