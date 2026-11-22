-- supabase/tests/work-workload.test.sql
-- Space workload: task estimates are written only through set_work_task_estimate
-- (planners and the task's holder, with a history row), weekly hours per space
-- membership through set_space_weekly_minutes, and personal time off that only
-- its owner reads or writes. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/work-workload.test.sql
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

------------------------------------------------------------ estimates, hours, time off
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 space pm + project pm, 2 space coordinator + project coordinator,
  -- 3 member holding T, 4 member not holding T, 5 teacher, 6 student
  s uuid; p uuid; t uuid; t_arch uuid;
  v_syl uuid; v_class uuid; v_cproj uuid; v_board uuid; cb uuid; t_class uuid;
  ev record;
  n int;
begin
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-load-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-load-'||k||'@example.test', 'Load', k::text,
        (case when k = 6 then 'student' else 'member' end)::public.user_role, 'active', k = 5, k = 1)
      on conflict(id) do update set role = excluded.role, status = 'active',
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz load space', '')).id;
  p := (public.create_general_project('Zz load project', '', null, null, null, null, s)).id;

  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member');
  insert into public.general_tasks(project_id, title, routing_state, created_by)
    values(p, 'Zz load task', 'released', u[1]) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[1]);
  insert into public.general_tasks(project_id, title, routing_state, created_by)
    values(p, 'Zz load archived', 'released', u[1]) returning id into t_arch;
  update public.general_tasks set archived_at = now(), archived_by = u[1] where id = t_arch;

  -- A class board task.
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
    values (u[5], 'syllabus', 'Zz load syllabus', 'x/load.pdf', 'load.pdf') returning id into v_syl;
  insert into public.syllabus_weeks (resource_id, week_no, title) values (v_syl, 1, 'Week 1');
  perform pg_temp.act_as(u[5]);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (u[5], 'Zz load class', 'ZZL', 'ZZLOAD-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_syl)
  returning id into v_class;
  perform pg_temp.service();
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience)
    values (v_class, u[5], 'Zz load class project', 'activity', 1, 1, 'individual') returning id into v_cproj;
  insert into public.project_boards (project_id, student_id) values (v_cproj, u[6]) returning id into v_board;
  insert into public.general_projects (name, space_id, class_board_id, created_by, preset)
    select 'Zz load class Files', c.space_id, v_board, u[5], 'class-board'
      from public.classes c where c.id = v_class
    returning id into cb;
  insert into public.general_tasks (project_id, title) values (cb, 'Zz load class task') returning id into t_class;

  -- Estimates.
  perform pg_temp.act_as(u[1]);
  perform public.set_work_task_estimate(t, 360);
  perform pg_temp.service();
  select * into ev from public.general_task_events
   where task_id = t and kind = 'updated' and detail -> 'fields' = '["estimated_minutes"]'::jsonb;
  get diagnostics n = row_count;
  perform pg_temp.check('planner sets estimate',
    (select estimated_minutes = 360 from public.general_tasks where id = t)
    and n = 1
    and (select count(*) = 1 from public.general_task_events
          where task_id = t and kind = 'updated' and detail -> 'fields' = '["estimated_minutes"]'::jsonb)
    and ev.detail ->> 'estimate_from' is null
    and ev.detail ->> 'estimate_to' = '360'
    and ev.actor_id = u[1]);

  perform pg_temp.act_as(u[1]);
  perform public.set_work_task_estimate(t, 360);
  perform pg_temp.service();
  perform pg_temp.check('same estimate is a no-op',
    (select count(*) = 1 from public.general_task_events
      where task_id = t and kind = 'updated' and detail -> 'fields' = '["estimated_minutes"]'::jsonb));

  perform pg_temp.act_as(u[3]);
  perform public.set_work_task_estimate(t, 300);
  perform pg_temp.service();
  perform pg_temp.check('holder sets estimate',
    (select estimated_minutes = 300 from public.general_tasks where id = t)
    and exists(select 1 from public.general_task_events
                where task_id = t and kind = 'updated' and actor_id = u[3]
                  and detail ->> 'estimate_from' = '360' and detail ->> 'estimate_to' = '300'));

  perform pg_temp.act_as(u[2]);
  perform public.set_work_task_estimate(t, 240);
  perform pg_temp.service();
  perform pg_temp.check('coordinator sets estimate',
    (select estimated_minutes = 240 from public.general_tasks where id = t));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('non-holder refused',
    format('select public.set_work_task_estimate(%L, 120)', t),
    'Only the project manager, coordinators or the task''s holder');

  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('direct update refused',
    format('update public.general_tasks set estimated_minutes = 10 where id = %L', t),
    'Use the estimate field');
  perform pg_temp.refuse('direct insert with an estimate refused',
    format('insert into public.general_tasks(project_id, title, estimated_minutes) values(%L, %L, 60)', p, 'Zz load direct'),
    'Use the estimate field');
  perform pg_temp.refuse('out of range refused',
    format('select public.set_work_task_estimate(%L, 60001)', t), 'between 1 minute and 1000 hours');
  perform pg_temp.refuse('zero refused',
    format('select public.set_work_task_estimate(%L, 0)', t), 'between 1 minute and 1000 hours');
  perform pg_temp.refuse('archived task refused',
    format('select public.set_work_task_estimate(%L, 60)', t_arch), 'archived');

  perform pg_temp.refuse('class board refused',
    format('select public.set_work_task_estimate(%L, 60)', t_class), 'work projects only');
  perform pg_temp.service();
  perform pg_temp.refuse('class board refused for the service role too',
    format('update public.general_tasks set estimated_minutes = 60 where id = %L', t_class), 'work projects only');

  perform pg_temp.act_as(u[1]);
  perform public.set_work_task_estimate(t, null);
  perform pg_temp.service();
  perform pg_temp.check('clear estimate',
    (select estimated_minutes is null from public.general_tasks where id = t)
    and exists(select 1 from public.general_task_events
                where task_id = t and kind = 'updated' and actor_id = u[1]
                  and detail ->> 'estimate_from' = '240' and detail ->> 'estimate_to' is null
                  and detail ? 'estimate_to'));

  -- Weekly hours.
  perform pg_temp.act_as(u[3]);
  perform public.set_space_weekly_minutes(s, u[3], 960);
  perform pg_temp.service();
  perform pg_temp.check('own weekly hours',
    exists(select 1 from public.general_space_capacity
            where space_id = s and user_id = u[3] and weekly_minutes = 960 and updated_by = u[3]));

  perform pg_temp.act_as(u[2]);
  perform public.set_space_weekly_minutes(s, u[4], 960);
  perform public.set_space_weekly_minutes(s, u[3], 1200);
  perform pg_temp.service();
  perform pg_temp.check('space planner sets hours',
    exists(select 1 from public.general_space_capacity where space_id = s and user_id = u[4] and weekly_minutes = 960)
    and exists(select 1 from public.general_space_capacity
                where space_id = s and user_id = u[3] and weekly_minutes = 1200 and updated_by = u[2]));

  perform pg_temp.act_as(u[1]);
  perform public.set_space_weekly_minutes(s, u[4], null);
  perform pg_temp.service();
  perform pg_temp.check('null stores not set',
    exists(select 1 from public.general_space_capacity where space_id = s and user_id = u[4] and weekly_minutes is null));

  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('member cannot set others',
    format('select public.set_space_weekly_minutes(%L, %L, 600)', s, u[4]),
    'Only the space''s project manager or coordinators');
  perform pg_temp.refuse('hours out of range refused',
    format('select public.set_space_weekly_minutes(%L, %L, 10081)', s, u[3]), 'between 0 and 168 hours');
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('non-member refused',
    format('select public.set_space_weekly_minutes(%L, %L, 600)', s, u[6]), 'not in this space');
  perform pg_temp.act_as(u[5]);
  perform pg_temp.refuse('class space refused',
    format('select public.set_space_weekly_minutes((select space_id from public.classes where id = %L), %L, 600)',
      v_class, u[5]), 'work spaces only');

  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('hours read closed', (select count(*) = 0 from public.general_space_capacity));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('hours read closed to the space pm', (select count(*) = 0 from public.general_space_capacity));

  perform pg_temp.service();
  delete from public.general_space_members where space_id = s and user_id = u[4];
  perform pg_temp.check('hours leave with the member',
    not exists(select 1 from public.general_space_capacity where space_id = s and user_id = u[4]));

  -- Time off.
  perform pg_temp.act_as(u[3]);
  insert into public.user_time_off(off_on) values (date '2026-12-01');
  insert into public.user_time_off(off_on, minutes) values (date '2026-12-02', 240);
  perform pg_temp.check('own time off',
    (select count(*) = 2 from public.user_time_off where user_id = u[3]));
  update public.user_time_off set minutes = 120 where off_on = date '2026-12-02';
  perform pg_temp.check('own time off edits',
    (select minutes = 120 from public.user_time_off where user_id = u[3] and off_on = date '2026-12-02'));
  perform pg_temp.refuse('one entry per date',
    'insert into public.user_time_off(off_on) values (date ''2026-12-01'')', 'user_time_off');
  perform pg_temp.refuse('time off for someone else refused',
    format('insert into public.user_time_off(user_id, off_on) values (%L, date ''2026-12-03'')', u[4]),
    'row-level security');

  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('time off own only',
    (select count(*) = 0 from public.user_time_off where user_id = u[3]));
  update public.user_time_off set minutes = 60 where user_id = u[3];
  delete from public.user_time_off where user_id = u[3];
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('time off closed to planners',
    (select count(*) = 0 from public.user_time_off where user_id = u[3]));
  perform pg_temp.service();
  perform pg_temp.check('others cannot change time off',
    (select count(*) = 2 from public.user_time_off where user_id = u[3])
    and (select minutes = 120 from public.user_time_off where user_id = u[3] and off_on = date '2026-12-02'));

  perform pg_temp.act_as(u[3]);
  delete from public.user_time_off where off_on = date '2026-12-01';
  perform pg_temp.check('own time off deletes',
    (select count(*) = 1 from public.user_time_off where user_id = u[3]));
end $$;

------------------------------------------------------------ load
-- The window is next Monday to Friday in Manila (2026-11-23 to 2026-11-27 when
-- run on 2026-11-22), so the tasks below stay inside it on any run date.
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 space pm (pm of Q), 2 space coordinator (on no project), 3 A, 4 B, 5 C (developers),
  -- 6 X: a space member who is the pm of P
  s uuid; p uuid; q uuid; ta uuid; t uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_mon date;
  v_fri date;
  v_start timestamptz;
  v_due timestamptz;
  v_class uuid; v_syl uuid;
begin
  v_mon := v_today + (8 - extract(isodow from v_today)::int);
  v_fri := v_mon + 4;
  v_start := (v_mon + time '09:00') at time zone 'Asia/Manila';
  v_due := (v_fri + time '17:00') at time zone 'Asia/Manila';

  perform pg_temp.service();
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-wl-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-wl-'||k||'@example.test', 'Wl', k::text, 'member', 'active', false, k in (1, 6))
      on conflict(id) do update set role = excluded.role, status = 'active',
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz wl space', '')).id;
  q := (public.create_general_project('Zz wl other', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'member'), (s, u[6], 'member');
  perform pg_temp.act_as(u[6]);
  p := (public.create_general_project('Zz wl project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  update public.general_projects set visibility = 'private' where id in (p, q);
  insert into public.general_members(project_id, user_id, role) values
    (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'member'), (q, u[3], 'member');
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values
    (s, u[3], 960), (s, u[4], 960), (s, u[5], 960);
  insert into public.user_time_off(user_id, off_on, minutes) values (u[3], v_mon + 1, 240);

  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl A', 'released', u[6], 360, v_start, v_due) returning id into ta;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(ta, p, u[3], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl B', 'released', u[6], 240, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[4], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl C', 'released', u[6], 120, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[5], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, starts_at, due_at)
    values(p, 'Zz wl C unestimated', 'released', u[6], v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[5], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl A and B', 'released', u[6], 120, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (t, p, u[3], u[6]), (t, p, u[4], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, status, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl done', 'released', 'done', u[6], 600, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl planning', 'planning', u[6], 600, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl trashed', 'released', u[6], 600, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[6]);
  update public.general_tasks
     set archived_at = now(), archived_by = u[6], trashed_at = now(), trashed_by = u[6] where id = t;
  perform pg_temp.check('trashed seed holds',
    (select trashed_at is not null from public.general_tasks where id = t));

  perform pg_temp.act_as(u[1]);
  -- Weekly 960 is 192 a weekday; 240 off on one day removes that day's 192, never more.
  perform pg_temp.check('available with time off',
    (select available_minutes = 768 and time_off_minutes = 192 and weekly_minutes = 960
       from public.general_space_people_hours(s, v_mon, v_fri) where user_id = u[3])
    and (select available_minutes = 960 and time_off_minutes = 0
           from public.general_space_people_hours(s, v_mon, v_fri) where user_id = u[4]));
  perform pg_temp.check('not set stays null',
    (select weekly_minutes is null and available_minutes is null
       from public.general_space_people_hours(s, v_mon, v_fri) where user_id = u[6]));
  perform pg_temp.check('load sums estimates',
    (select sum(load_minutes) = 420 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[3])
    and (select sum(load_minutes) = 300 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[4])
    and (select sum(load_minutes) = 120 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[5]));
  perform pg_temp.check('unestimated counted',
    (select unestimated = 1 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[5])
    and (select sum(unestimated) = 0 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[3]));

  perform pg_temp.service();
  insert into public.general_tasks(project_id, parent_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, ta, 'Zz wl A sub', 'released', u[6], 60, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[6]);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('parent with subtasks ignored',
    (select sum(load_minutes) = 120 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[3]));

  perform pg_temp.check('weekend window',
    (select count(*) = 3 and bool_and(available_minutes = 0)
       from public.general_space_people_hours(s, v_mon + 5, v_mon + 6) where weekly_minutes is not null)
    and not exists(select 1 from public.general_space_people_load(s, v_mon + 5, v_mon + 6)));
  perform pg_temp.refuse('work_weekdays not granted',
    format('select public.work_weekdays(%L, %L)', v_mon, v_fri), 'permission denied');
  perform pg_temp.service();
  perform pg_temp.check('work_weekdays',
    public.work_weekdays(v_mon, v_fri) = 5 and public.work_weekdays(v_mon, v_mon + 13) = 10
    and public.work_weekdays(v_mon + 5, v_mon + 6) = 0 and public.work_weekdays(v_fri, v_mon) = 0
    and public.work_weekdays(v_mon + 4, v_mon + 7) = 2);

  perform pg_temp.service();
  insert into public.user_time_off(user_id, off_on)
    select u[5], d::date from generate_series(v_mon, v_fri, interval '1 day') d;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('time off floors at zero',
    (select available_minutes = 0 and time_off_minutes = 960
       from public.general_space_people_hours(s, v_mon, v_fri) where user_id = u[5]));

  -- A's other work, in Q (the space pm's project).
  perform pg_temp.service();
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(q, 'Zz wl A other', 'released', u[1], 90, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, q, u[3], u[1]);

  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('layered: a member sees only themselves',
    (select count(*) > 0 and bool_and(user_id = u[4] and project_id = p)
       from public.general_space_people_load(s, v_mon, v_fri))
    and (select array_agg(user_id) = array[u[4]] from public.general_space_people_hours(s, v_mon, v_fri)));

  perform pg_temp.act_as(u[6]);
  perform pg_temp.check('layered: a project pm sees their people',
    (select count(distinct user_id) = 3 from public.general_space_people_load(s, v_mon, v_fri))
    and (select load_minutes = 120 from public.general_space_people_load(s, v_mon, v_fri)
          where user_id = u[3] and project_id = p)
    and (select load_minutes = 90 from public.general_space_people_load(s, v_mon, v_fri)
          where user_id = u[3] and project_id is null)
    and not exists(select 1 from public.general_space_people_load(s, v_mon, v_fri) where project_id = q)
    and (select count(*) = 4 and bool_and(user_id = any(array[u[3], u[4], u[5], u[6]]))
           from public.general_space_people_hours(s, v_mon, v_fri)));

  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('layered: a space coordinator gets private projects folded',
    (select count(distinct user_id) = 3 and bool_and(project_id is null)
       from public.general_space_people_load(s, v_mon, v_fri))
    and (select load_minutes = 210 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[3])
    and (select count(*) = 6 from public.general_space_people_hours(s, v_mon, v_fri)));

  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('layered: the space pm sees every project named',
    (select load_minutes = 120 from public.general_space_people_load(s, v_mon, v_fri)
      where user_id = u[3] and project_id = p)
    and (select load_minutes = 90 from public.general_space_people_load(s, v_mon, v_fri)
          where user_id = u[3] and project_id = q)
    and not exists(select 1 from public.general_space_people_load(s, v_mon, v_fri) where project_id is null));
  perform pg_temp.check('users filter',
    (select array_agg(distinct user_id) = array[u[4]]
       from public.general_space_people_load(s, v_mon, v_fri, array[u[4]]))
    and (select array_agg(user_id) = array[u[4]]
           from public.general_space_people_hours(s, v_mon, v_fri, array[u[4]])));

  -- Class spaces are refused.
  perform pg_temp.service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
    values (u[1], 'syllabus', 'Zz wl syllabus', 'x/wl.pdf', 'wl.pdf') returning id into v_syl;
  update public.profiles set can_teach = true where id = u[1];
  perform pg_temp.act_as(u[1]);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (u[1], 'Zz wl class', 'ZZW', 'ZZWL-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_syl)
  returning id into v_class;
  perform pg_temp.refuse('class space refused',
    format('select * from public.general_space_people_load((select space_id from public.classes where id = %L), %L, %L)',
      v_class, v_mon, v_fri), 'work spaces only');
  perform pg_temp.refuse('class space hours refused',
    format('select * from public.general_space_people_hours((select space_id from public.classes where id = %L), %L, %L)',
      v_class, v_mon, v_fri), 'work spaces only');
  perform pg_temp.service();
  perform pg_temp.refuse('signed out refused',
    format('select * from public.general_space_people_load(%L, %L, %L)', s, v_mon, v_fri), 'Sign in');
end $$;

rollback;
