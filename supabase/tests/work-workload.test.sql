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
  insert into public.general_members(project_id, user_id) values (cb, u[6]) on conflict do nothing;
  perform pg_temp.act_as(u[6]);
  perform pg_temp.check('context blocks a class board',
    (public.general_breakdown_context(t_class, date '2026-11-23', date '2026-11-27') ->> 'blocked')
      like '%work projects only%'
    and public.general_breakdown_context(t_class, date '2026-11-23', date '2026-11-27') -> 'candidates' = '[]'::jsonb);
  perform pg_temp.service();

  -- Who may estimate, asked before Suggest estimate runs.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('can estimate: pm', public.can_estimate_work_task(t));
  perform pg_temp.check('can estimate: archived task is no',
    not public.can_estimate_work_task(t_arch));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('can estimate: coordinator', public.can_estimate_work_task(t));
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('can estimate: holder', public.can_estimate_work_task(t));
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('can estimate: non-holder is no', not public.can_estimate_work_task(t));
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('can estimate: class board is no', not public.can_estimate_work_task(t_class));
  perform pg_temp.check('can estimate: missing task is no', not public.can_estimate_work_task(gen_random_uuid()));
  perform pg_temp.service();
  perform pg_temp.check('can estimate: signed out is no', not public.can_estimate_work_task(t));

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
  -- Today, or the next Monday on a weekend, and the Monday of its week.
  v_anchor date := v_today + case extract(isodow from v_today)::int when 6 then 2 when 7 then 1 else 0 end;
  v_amon date := v_anchor - (extract(isodow from v_anchor)::int - 1);
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

  -- Overdue and undated work counts on the anchored day: today, or Monday on a
  -- weekend. X holds only these two, so the anchored week's load is exactly theirs.
  perform pg_temp.service();
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl overdue', 'released', u[6], 100,
      ((v_anchor - 10) + time '09:00') at time zone 'Asia/Manila',
      ((v_anchor - 3) + time '17:00') at time zone 'Asia/Manila') returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[6], u[6]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes)
    values(p, 'Zz wl undated', 'released', u[6], 50) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[6], u[6]);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('overdue and undated count in the current week',
    (select sum(load_minutes) = 150
       from public.general_space_people_load(s, v_amon, v_amon + 4) where user_id = u[6])
    and (select sum(load_minutes) = 150
           from public.general_space_people_load(s, v_anchor, v_anchor) where user_id = u[6]));

  -- Ten weekdays from the window's Monday: half the share falls in each week.
  perform pg_temp.service();
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz wl two weeks', 'released', u[6], 200, v_start,
      ((v_mon + 11) + time '17:00') at time zone 'Asia/Manila') returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[5], u[6]);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('a ten-weekday task counts half in one week',
    (select sum(load_minutes) = 220 from public.general_space_people_load(s, v_mon, v_fri) where user_id = u[5])
    and (select sum(load_minutes) = 100
           from public.general_space_people_load(s, v_mon + 7, v_mon + 11) where user_id = u[5]));

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

------------------------------------------------------------ breakdown context
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 coordinator, 3 team lead, 4 team member, 5 member on no team,
  -- 6 QA on the team, 7 stakeholder, 8 member outside the space
  s uuid; p uuid; team uuid; par uuid; pos uuid; sub uuid;
  ctx jsonb;
  w_from date := date '2026-11-23';
  w_to date := date '2026-11-27';
begin
  perform pg_temp.service();
  for k in 1..8 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-bd-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-bd-'||k||'@example.test', 'Bd', k::text, 'member', 'active', false, k = 1)
      on conflict(id) do update set role = excluded.role, status = 'active',
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz bd space', '')).id;
  p := (public.create_general_project('Zz bd project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'member'),
    (s, u[6], 'qa'), (s, u[7], 'stakeholder');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'member'),
    (p, u[6], 'qa'), (p, u[7], 'stakeholder'), (p, u[8], 'member');
  -- Joining the project seats u8 in the space too; take that seat away again.
  delete from public.general_space_members where space_id = s and user_id = u[8];
  perform pg_temp.check('u8 stays on the project outside the space',
    exists (select 1 from public.general_members where project_id = p and user_id = u[8]));
  insert into public.general_teams(project_id, name) values (p, 'Zz bd team') returning id into team;
  insert into public.general_team_members(project_id, team_id, user_id) values
    (p, team, u[3]), (p, team, u[4]), (p, team, u[6]);
  update public.general_teams set leader_id = u[3] where id = team;
  insert into public.general_member_skills(project_id, user_id, tag) values
    (p, u[3], 'Auth'), (p, u[4], 'auth'), (p, u[4], 'UI');
  insert into public.general_positions(project_id, name) values (p, 'Developer') returning id into pos;
  insert into public.general_position_holders(position_id, project_id, user_id) values (pos, p, u[3]);
  insert into public.general_tasks(project_id, title, description, team_id, routing_state, created_by)
    values (p, 'Zz bd login', 'Build the login module', team, 'planning', u[1]) returning id into par;

  perform pg_temp.act_as(u[1]);
  ctx := public.general_breakdown_context(par, w_from, w_to);
  perform pg_temp.check('context blocks unreleased planned parent',
    (ctx ->> 'blocked') like '%Plan & route%'
    and ctx -> 'parent' ->> 'routing_state' = 'planning');

  perform pg_temp.service();
  update public.general_tasks set routing_state = 'released', sent_at = now() where id = par;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (par, p, u[4], u[3]);

  perform pg_temp.act_as(u[1]);
  ctx := public.general_breakdown_context(par, w_from, w_to);
  perform pg_temp.check('context for a released planned parent',
    ctx -> 'blocked' = 'null'::jsonb
    and ctx -> 'parent' ->> 'title' = 'Zz bd login'
    and ctx -> 'parent' ->> 'description' = 'Build the login module'
    and ctx -> 'parent' ->> 'task_flow' = 'planned'
    and (ctx -> 'parent' ->> 'team_id')::uuid = team
    and ctx -> 'parent' -> 'has_subtasks' = 'false'::jsonb
    and ctx -> 'parent' -> 'allow_subtasks' = 'true'::jsonb
    and ctx -> 'parent' -> 'holder_ids' = jsonb_build_array(u[4])
    and ctx -> 'tags' = '["Auth", "UI"]'::jsonb
    and ctx -> 'positions' = jsonb_build_array(jsonb_build_object('id', pos, 'name', 'Developer')));
  perform pg_temp.check('planned candidates are receiving team only',
    (select array_agg((c ->> 'user_id')::uuid order by c ->> 'user_id')
       from jsonb_array_elements(ctx -> 'candidates') c)
      = (select array_agg(x order by x::text) from unnest(array[u[3], u[4]]) x)
    and exists (select 1 from jsonb_array_elements(ctx -> 'candidates') c
                 where (c ->> 'user_id')::uuid = u[3] and c ->> 'name' = 'Bd 3'
                   and c -> 'tags' = '["Auth"]'::jsonb and c -> 'position_ids' = jsonb_build_array(pos))
    and exists (select 1 from jsonb_array_elements(ctx -> 'candidates') c
                 where (c ->> 'user_id')::uuid = u[4] and c -> 'tags' = '["auth", "UI"]'::jsonb
                   and c -> 'position_ids' = '[]'::jsonb));

  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('context for a coordinator',
    public.general_breakdown_context(par, w_from, w_to) -> 'blocked' = 'null'::jsonb);

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('context refuses member',
    format('select public.general_breakdown_context(%L, %L, %L)', par, w_from, w_to),
    'Only the project manager or coordinators break down tasks.');
  perform pg_temp.act_as(u[7]);
  perform pg_temp.refuse('context refuses stakeholder',
    format('select public.general_breakdown_context(%L, %L, %L)', par, w_from, w_to),
    'Only the project manager or coordinators break down tasks.');
  perform pg_temp.service();
  perform pg_temp.refuse('context refuses signed out',
    format('select public.general_breakdown_context(%L, %L, %L)', par, w_from, w_to), 'Sign in');
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('context refuses a bad window',
    format('select public.general_breakdown_context(%L, %L, %L)', par, w_to, w_from), 'start date on or before');
  perform pg_temp.refuse('context refuses a missing task',
    format('select public.general_breakdown_context(%L, %L, %L)', gen_random_uuid(), w_from, w_to), 'Task not found');

  perform pg_temp.service();
  update public.general_teams set leader_id = null where id = team;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('context blocks a team with no active lead',
    (public.general_breakdown_context(par, w_from, w_to) ->> 'blocked') like '%no active lead%');
  perform pg_temp.service();
  update public.general_teams set leader_id = u[3] where id = team;
  update public.profiles set status = 'pending' where id = u[3];
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('context blocks a team whose lead is inactive',
    (public.general_breakdown_context(par, w_from, w_to) ->> 'blocked') like '%no active lead%');
  perform pg_temp.service();
  update public.profiles set status = 'active' where id = u[3];

  update public.general_projects set task_flow = 'open' where id = p;
  perform pg_temp.act_as(u[1]);
  ctx := public.general_breakdown_context(par, w_from, w_to);
  perform pg_temp.check('context candidates exclude QA and stakeholder',
    ctx -> 'blocked' = 'null'::jsonb
    and ctx -> 'parent' ->> 'task_flow' = 'open'
    and (select array_agg((c ->> 'user_id')::uuid order by c ->> 'user_id')
           from jsonb_array_elements(ctx -> 'candidates') c)
        = (select array_agg(x order by x::text) from unnest(array[u[1], u[2], u[3], u[4], u[5]]) x));
  perform pg_temp.check('open candidates are space members only',
    not exists (select 1 from jsonb_array_elements(ctx -> 'candidates') c where (c ->> 'user_id')::uuid = u[8]));

  perform pg_temp.service();
  update public.general_tasks set status = 'done' where id = par;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('context blocks a done parent',
    (public.general_breakdown_context(par, w_from, w_to) ->> 'blocked') like '%done%');
  perform pg_temp.service();
  update public.general_tasks set status = 'todo' where id = par;
  update public.general_projects set allow_subtasks = false where id = p;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('context blocks when subtasks are off',
    (public.general_breakdown_context(par, w_from, w_to) ->> 'blocked') like 'Subtasks are off%');
  perform pg_temp.service();
  update public.general_projects set allow_subtasks = true where id = p;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, created_by)
    values (p, par, 'Zz bd sub', 'released', u[1]) returning id into sub;
  perform pg_temp.act_as(u[1]);
  ctx := public.general_breakdown_context(par, w_from, w_to);
  perform pg_temp.check('context blocks a parent with subtasks',
    (ctx ->> 'blocked') like '%already has subtasks%'
    and ctx -> 'parent' -> 'has_subtasks' = 'true'::jsonb);
  perform pg_temp.check('context blocks a subtask',
    (public.general_breakdown_context(sub, w_from, w_to) ->> 'blocked') like 'This is a subtask%');
end $$;

------------------------------------------------------------ apply a breakdown
-- The defense fixture: A (Auth, 360 min load), B (UI, 240), C (Testing, 120),
-- 960 a week each; seven rows owned A, B, C, A, B, C, C with five links.
create or replace function pg_temp.load_of(p_space uuid, p_from date, p_to date, p_user uuid, p_skip uuid default null)
returns int language sql as $$
  select coalesce(sum(load_minutes), 0)::int
    from public.general_space_people_load(p_space, p_from, p_to, array[p_user], p_skip);
$$;

create or replace function pg_temp.unest_of(p_space uuid, p_from date, p_to date, p_user uuid, p_skip uuid default null)
returns int language sql as $$
  select coalesce(sum(unestimated), 0)::int
    from public.general_space_people_load(p_space, p_from, p_to, array[p_user], p_skip);
$$;

create or replace function pg_temp.defense_rows(a uuid, b uuid, c uuid, p_space uuid, p_from date, p_to date)
returns jsonb language plpgsql as $$
declare
  la int := pg_temp.load_of(p_space, p_from, p_to, a);
  lb int := pg_temp.load_of(p_space, p_from, p_to, b);
  lc int := pg_temp.load_of(p_space, p_from, p_to, c);
begin
  return jsonb_build_array(
    jsonb_build_object('key', 'contract', 'title', 'Agree the API contract', 'description', 'Endpoints and errors',
      'minutes', 120, 'owner', a, 'depends_on', '[]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', la),
    jsonb_build_object('key', 'page', 'title', 'Design the login page', 'description', '',
      'minutes', 120, 'owner', b, 'depends_on', '[]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', lb),
    jsonb_build_object('key', 'cases', 'title', 'Write test cases', 'description', '',
      'minutes', 180, 'owner', c, 'depends_on', '[]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', lc),
    jsonb_build_object('key', 'auth', 'title', 'Build sign-in', 'description', '',
      'minutes', 360, 'owner', a, 'depends_on', '["contract"]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', la),
    jsonb_build_object('key', 'ui', 'title', 'Build the interface', 'description', '',
      'minutes', 480, 'owner', b, 'depends_on', '["contract"]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', lb),
    jsonb_build_object('key', 'integration', 'title', 'Integrate', 'description', '',
      'minutes', 240, 'owner', c, 'depends_on', '["auth", "ui"]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', lc),
    jsonb_build_object('key', 'e2e', 'title', 'End-to-end tests', 'description', '',
      'minutes', 300, 'owner', c, 'depends_on', '["integration"]'::jsonb, 'starts_on', p_from, 'due_on', p_to, 'shown_load_minutes', lc));
end $$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 coordinator, 3 A (team lead), 4 B, 5 C (the team), 6 D (member on no team), 7 QA
  names text[] := array['Pia', 'Cora', 'Ana', 'Ben', 'Carlo', 'Dina', 'Quinn'];
  s uuid; p uuid; team uuid; par uuid; par2 uuid; t uuid; extra uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_mon date;
  v_fri date;
  v_start timestamptz;
  v_due timestamptz;
  v_sent timestamptz;
  v_rows jsonb;
  v_ids uuid[];
  call text;
begin
  v_mon := v_today + (8 - extract(isodow from v_today)::int);
  v_fri := v_mon + 4;
  v_start := (v_mon + time '09:00') at time zone 'Asia/Manila';
  v_due := (v_fri + time '17:00') at time zone 'Asia/Manila';

  perform pg_temp.service();
  for k in 1..7 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-ap-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-ap-'||k||'@example.test', names[k], 'Zz', 'member', 'active', false, k = 1)
      on conflict(id) do update set first_name = excluded.first_name, role = excluded.role, status = 'active',
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;
  end loop;

  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz ap space', '')).id;
  p := (public.create_general_project('Zz ap project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  update public.general_projects set task_flow = 'planned', allow_subtasks = true, allow_dependencies = true
   where id = p;
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'member'),
    (s, u[6], 'member'), (s, u[7], 'qa');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'member'),
    (p, u[6], 'member'), (p, u[7], 'qa');
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values
    (s, u[3], 960), (s, u[4], 960), (s, u[5], 960), (s, u[6], 960);
  insert into public.general_teams(project_id, name) values (p, 'Zz ap team') returning id into team;
  insert into public.general_team_members(project_id, team_id, user_id) values
    (p, team, u[3]), (p, team, u[4]), (p, team, u[5]);
  update public.general_teams set leader_id = u[3] where id = team;

  -- Existing load: A 360, B 240, C 120.
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz ap A load', 'released', u[1], 360, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[3], u[1]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz ap B load', 'released', u[1], 240, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[4], u[1]);
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz ap C load', 'released', u[1], 120, v_start, v_due) returning id into t;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(t, p, u[5], u[1]);

  -- The parent: released to the team, held by A.
  insert into public.general_tasks(project_id, title, description, team_id, routing_state, sent_at, created_by)
    values(p, 'Zz ap login', 'Develop the login module', team, 'released', now() - interval '1 day', u[1])
    returning id into par;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(par, p, u[3], u[1]);
  select sent_at into v_sent from public.general_tasks where id = par;

  perform pg_temp.act_as(u[1]);
  v_rows := pg_temp.defense_rows(u[3], u[4], u[5], s, v_mon, v_fri);
  perform pg_temp.check('defense loads as shown',
    (v_rows -> 0 ->> 'shown_load_minutes')::int = 360 and (v_rows -> 1 ->> 'shown_load_minutes')::int = 240
    and (v_rows -> 2 ->> 'shown_load_minutes')::int = 120);
  call := format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri, v_rows);

  -- Refusals save nothing.
  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('member refused', call, 'Only the project manager or coordinators break down tasks.');

  perform pg_temp.service();
  delete from public.general_team_members where team_id = team and user_id = u[5];
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('owner left team', call, 'Carlo can no longer take tasks from this team. Review again.');
  perform pg_temp.service();
  perform pg_temp.check('owner left team saves nothing',
    (select count(*) = 0 from public.general_tasks where parent_id = par));
  insert into public.general_team_members(project_id, team_id, user_id) values (p, team, u[5]);

  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes, starts_at, due_at)
    values(p, 'Zz ap A extra', 'released', u[1], 60, v_start, v_due) returning id into extra;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values(extra, p, u[3], u[1]);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('load rose refused', call, 'Ana''s work changed since you reviewed it. Review again.');
  perform pg_temp.service();
  perform pg_temp.check('load rose saves nothing',
    (select count(*) = 0 from public.general_tasks where parent_id = par));
  update public.general_tasks set archived_at = now(), archived_by = u[1] where id = extra;

  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('bad link rolls back',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{6,depends_on}', '["nope"]'::jsonb)),
    '"End-to-end tests" depends on "nope", which isn''t in the plan.');
  perform pg_temp.refuse('cycle refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{0,depends_on}', '["e2e"]'::jsonb)),
    'is part of a circular dependency.');
  perform pg_temp.refuse('self link refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{1,depends_on}', '["page"]'::jsonb)),
    '"Design the login page" depends on itself.');
  perform pg_temp.refuse('duplicate key refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{1,key}', '"contract"'::jsonb)),
    'reuses the key "contract".');
  perform pg_temp.refuse('minutes out of range refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{2,minutes}', '4801'::jsonb)),
    '"Write test cases" needs an estimate from 15 minutes to 80 hours.');
  perform pg_temp.refuse('one row refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_build_array(v_rows -> 1)),
    'A breakdown needs 2 to 12 subtasks; this one has 1.');
  perform pg_temp.refuse('QA owner refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par, v_mon, v_fri,
      jsonb_set(v_rows, '{1,owner}', to_jsonb(u[7]))),
    'Quinn can no longer take tasks from this team. Review again.');
  perform pg_temp.service();
  perform pg_temp.check('bad plans save nothing',
    (select count(*) = 0 from public.general_tasks where parent_id = par));

  update public.general_projects set allow_subtasks = false where id = p;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('subtasks off refused', call, 'The task changed since you reviewed it. Review again.');
  perform pg_temp.service();
  update public.general_projects set allow_subtasks = true where id = p;

  -- The parent, dated in the window, counts in Ana's load until it has
  -- subtasks; the review and the recheck both leave it out.
  update public.general_tasks set starts_at = v_start, due_at = v_due where id = par;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('unestimated parent skipped',
    pg_temp.unest_of(s, v_mon, v_fri, u[3]) = 1
    and pg_temp.unest_of(s, v_mon, v_fri, u[3], par) = 0
    and pg_temp.load_of(s, v_mon, v_fri, u[3], par) = 360);
  perform pg_temp.service();
  update public.general_tasks set estimated_minutes = 600 where id = par;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('estimated parent skipped in the review load',
    pg_temp.load_of(s, v_mon, v_fri, u[3]) = 960
    and pg_temp.load_of(s, v_mon, v_fri, u[3], par) = 360
    and pg_temp.unest_of(s, v_mon, v_fri, u[3], par) = 0
    and pg_temp.load_of(s, v_mon, v_fri, u[4], par) = 240);

  -- The plan saves whole, against the loads the review showed without the parent.
  perform pg_temp.act_as(u[1]);
  v_ids := public.apply_work_breakdown(par, v_mon, v_fri, v_rows);
  perform pg_temp.service();
  perform pg_temp.check('apply creates all',
    cardinality(v_ids) = 7
    and (select count(*) = 7 from public.general_tasks where parent_id = par)
    and (select array_agg(g.title order by x.n) from unnest(v_ids) with ordinality x(id, n)
           join public.general_tasks g on g.id = x.id)
        = array['Agree the API contract', 'Design the login page', 'Write test cases', 'Build sign-in',
                'Build the interface', 'Integrate', 'End-to-end tests']
    and (select count(*) = 7 from public.general_task_assignees where task_id = any(v_ids))
    and (select array_agg(a.user_id order by x.n) from unnest(v_ids) with ordinality x(id, n)
           join public.general_task_assignees a on a.task_id = x.id)
        = array[u[3], u[4], u[5], u[3], u[4], u[5], u[5]]
    and (select count(*) = 5 from public.general_task_dependencies where task_id = any(v_ids))
    and exists (select 1 from public.general_task_dependencies where task_id = v_ids[4] and depends_on_id = v_ids[1])
    and exists (select 1 from public.general_task_dependencies where task_id = v_ids[6] and depends_on_id = v_ids[4])
    and exists (select 1 from public.general_task_dependencies where task_id = v_ids[6] and depends_on_id = v_ids[5])
    and exists (select 1 from public.general_task_dependencies where task_id = v_ids[7] and depends_on_id = v_ids[6])
    and (select array_agg(g.estimated_minutes order by x.n) from unnest(v_ids) with ordinality x(id, n)
           join public.general_tasks g on g.id = x.id)
        = array[120, 120, 180, 360, 480, 240, 300]
    and (select bool_and(g.starts_at = (v_mon + time '00:00') at time zone 'Asia/Manila'
                         and g.due_at = (v_fri + time '23:59') at time zone 'Asia/Manila'
                         and g.team_id = team and g.routing_state = 'released')
           from public.general_tasks g where g.id = any(v_ids))
    and (select g.description = 'Endpoints and errors' from public.general_tasks g where g.id = v_ids[1])
    and (select array_agg(a.user_id) = array[u[3]] from public.general_task_assignees a where a.task_id = par)
    and (select g.team_id = team and g.routing_state = 'released' and g.sent_at = v_sent
           from public.general_tasks g where g.id = par));
  perform pg_temp.check('planned flow apply assigns directly',
    (select bool_and(a.assigned_by = u[1]) from public.general_task_assignees a where a.task_id = any(v_ids))
    and (select count(*) = 7 from public.general_task_events e
          where e.task_id = any(v_ids) and e.kind = 'assigned' and e.actor_id = u[1])
    and (select count(*) = 7 from public.general_task_events e
          where e.task_id = any(v_ids) and e.kind = 'updated' and e.actor_id = u[1]
            and e.detail -> 'fields' = '["estimated_minutes"]'::jsonb)
    and (select count(*) = 2 from public.notifications n
          where n.user_id = u[4] and n.type = 'general_task_assigned' and n.general_task_id = any(v_ids)));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('subtasks count in the load',
    pg_temp.load_of(s, v_mon, v_fri, u[5]) = 120 + 180 + 240 + 300);
  perform pg_temp.refuse('second apply refused', call, 'This task already has subtasks. Reload it to see them.');
  perform pg_temp.service();
  perform pg_temp.check('second apply saves nothing',
    (select count(*) = 7 from public.general_tasks where parent_id = par));

  -- Open flow: anyone on the project who can hold tasks, applied by a coordinator.
  update public.general_projects set task_flow = 'open' where id = p;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values(p, 'Zz ap open parent', 'released', now(), u[1]) returning id into par2;
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('open flow QA owner refused',
    format('select public.apply_work_breakdown(%L, %L, %L, %L::jsonb)', par2, v_mon, v_fri, jsonb_build_array(
      jsonb_build_object('key', 'a', 'title', 'Open first', 'minutes', 60, 'owner', u[7], 'depends_on', '[]'::jsonb),
      jsonb_build_object('key', 'b', 'title', 'Open second', 'minutes', 60, 'owner', null, 'depends_on', '[]'::jsonb))),
    'Quinn can no longer take tasks in this project. Review again.');
  v_ids := public.apply_work_breakdown(par2, v_mon, v_fri, jsonb_build_array(
    jsonb_build_object('key', 'a', 'title', 'Open first', 'minutes', 60, 'owner', u[6],
      'depends_on', '[]'::jsonb, 'starts_on', v_mon, 'due_on', v_mon,
      'shown_load_minutes', pg_temp.load_of(s, v_mon, v_fri, u[6])),
    jsonb_build_object('key', 'b', 'title', 'Open second', 'minutes', 90, 'owner', u[4],
      'depends_on', '["a"]'::jsonb, 'starts_on', v_mon + 1, 'due_on', v_fri,
      'shown_load_minutes', pg_temp.load_of(s, v_mon, v_fri, u[4])),
    jsonb_build_object('key', 'c', 'title', 'Open unassigned', 'minutes', 30, 'owner', null,
      'depends_on', '[]'::jsonb, 'starts_on', v_mon, 'due_on', v_fri, 'shown_load_minutes', null)));
  perform pg_temp.service();
  perform pg_temp.check('open flow apply',
    cardinality(v_ids) = 3
    and (select count(*) = 3 from public.general_tasks where parent_id = par2)
    and (select array_agg(a.user_id order by x.n) from unnest(v_ids) with ordinality x(id, n)
           join public.general_task_assignees a on a.task_id = x.id) = array[u[6], u[4]]
    and not exists (select 1 from public.general_task_assignees where task_id = v_ids[3])
    and exists (select 1 from public.general_task_dependencies where task_id = v_ids[2] and depends_on_id = v_ids[1])
    and (select starts_at = ((v_mon + 1) + time '00:00') at time zone 'Asia/Manila'
           from public.general_tasks where id = v_ids[2])
    and (select bool_and(assigned_by = u[2]) from public.general_task_assignees where task_id = any(v_ids)));
end $$;

------------------------------------------------------------ phase 2: helper and room
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 space pm + project pm, 2 member M, 3 B (team 1, 16 h), 4 C (16 h),
  -- 5 lead L of team 1, 6 stakeholder, 7 team 2 member with no hours
  s uuid; p uuid; t1 uuid; t2 uuid; x uuid; y uuid; z uuid; w uuid;
  v_anchor date := (now() at time zone 'Asia/Manila')::date
    + case extract(isodow from (now() at time zone 'Asia/Manila')::date)::int when 6 then 2 when 7 then 1 else 0 end;
  v_mon date; v_fri date; st timestamptz; du timestamptz;
begin
  v_mon := v_anchor - (extract(isodow from v_anchor)::int - 1);
  v_fri := v_mon + 4;
  st := (v_mon + time '09:00') at time zone 'Asia/Manila';
  du := (v_fri + time '17:00') at time zone 'Asia/Manila';
  for k in 1..7 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-room-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-room-'||k||'@example.test', (array['Pat','Mia','Ben','Cy','Lee','Sol','Quin'])[k], 'Zz',
        'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', first_name = excluded.first_name,
        can_teach = false, can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz room space', '')).id;
  p := (public.create_general_project('Zz room project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role)
    select s, u[k], 'member' from generate_series(2, 7) k;
  insert into public.general_members(project_id, user_id, role)
    select p, u[k], (case when k = 6 then 'stakeholder' else 'member' end)::public.general_role from generate_series(2, 7) k;
  insert into public.general_teams(project_id, name) values (p, 'Zz team one') returning id into t1;
  insert into public.general_teams(project_id, name) values (p, 'Zz team two') returning id into t2;
  insert into public.general_team_members(team_id, project_id, user_id) values (t1, p, u[3]), (t1, p, u[5]), (t2, p, u[7]);
  update public.general_teams set leader_id = u[5] where id = t1;
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[3], 960), (s, u[4], 960);
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes, team_id)
    values (p, 'Zz room held', 'released', now(), st, du, u[1], 840, t1) returning id into x;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (x, p, u[3], u[1]);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes, team_id)
    values (p, 'Zz room target', 'released', now(), st, du, u[1], 180, t1) returning id into y;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by)
    values (p, 'Zz room no estimate', 'released', now(), st, du, u[1]) returning id into z;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (p, 'Zz room shared', 'released', now(), st, du, u[1], 180) returning id into w;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (w, p, u[4], u[1]), (w, p, u[7], u[1]);
  perform set_config('collabify.estimate_write', 'off', true);

  -- The lead of team one sees that team's members, the project named, and nobody else.
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('lead sees team',
    exists (select 1 from public.general_space_people_load(s, v_mon, v_fri) l where l.user_id = u[3] and l.project_id = p)
    and exists (select 1 from public.general_space_people_hours(s, v_mon, v_fri) h where h.user_id = u[3]));
  perform pg_temp.check('lead not other teams',
    not exists (select 1 from public.general_space_people_load(s, v_mon, v_fri) l where l.user_id in (u[4], u[7]))
    and not exists (select 1 from public.general_space_people_hours(s, v_mon, v_fri) h where h.user_id in (u[2], u[4], u[7])));

  -- Room for the 3 h target task this week.
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('room ok',
    (select room from public.general_task_holder_room(y, array[u[4]])) = 'ok');
  perform pg_temp.check('room full',
    (select room from public.general_task_holder_room(y, array[u[3]])) = 'full');
  perform pg_temp.check('room unknown no estimate',
    (select room from public.general_task_holder_room(z, array[u[4]])) = 'unknown');
  perform pg_temp.check('room unknown no hours',
    (select room from public.general_task_holder_room(y, array[u[7]])) = 'unknown');
  perform pg_temp.check('room counts shared share',
    (select room from public.general_task_holder_room(w, array[u[3]])) = 'ok');
  perform pg_temp.check('room only project members',
    (select count(*) from public.general_task_holder_room(y, array[u[3], gen_random_uuid()])) = 1);
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('room for a lead',
    (select room from public.general_task_holder_room(y, array[u[3]])) = 'full');
  perform pg_temp.act_as(u[6]);
  perform pg_temp.refuse('room refuses stakeholder',
    format('select * from public.general_task_holder_room(%L, %L)', y, array[u[3]]),
    'You can''t assign tasks in this project.');
  perform pg_temp.service();
end $$;

------------------------------------------------------------ phase 2: overload
-- The room check is deferred to commit; these helpers run a statement and then
-- fire pending deferred checks at once, as a commit would.
create or replace function pg_temp.refuse_at_commit(p_label text, p_sql text, p_needle text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    set constraints all immediate;
  exception when others then
    set constraints all deferred;
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS %', p_label;
      return;
    end if;
    raise exception 'FAIL % (refused for another reason: %)', p_label, sqlerrm;
  end;
  set constraints all deferred;
  raise exception 'FAIL % (not refused)', p_label;
end $$;

create or replace function pg_temp.commit_checks() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end $$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid()];
  -- 1 pm, 2 Member Mia, 3 Ben (16 h, 15 h held), 4 Cy (16 h, free), 5 coordinator
  s uuid; p uuid; pl uuid; tm uuid; x uuid; t uuid; t2 uuid; nt uuid; lt uuid;
  v_anchor date := (now() at time zone 'Asia/Manila')::date
    + case extract(isodow from (now() at time zone 'Asia/Manila')::date)::int when 6 then 2 when 7 then 1 else 0 end;
  v_mon date; v_fri date; st timestamptz; du timestamptz;
begin
  v_mon := v_anchor - (extract(isodow from v_anchor)::int - 1);
  v_fri := v_mon + 4;
  st := (v_mon + time '09:00') at time zone 'Asia/Manila';
  du := (v_fri + time '17:00') at time zone 'Asia/Manila';
  for k in 1..5 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-over-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-over-'||k||'@example.test', (array['Pat','Mia','Ben','Cy','Coe'])[k], 'Zz',
        'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', first_name = excluded.first_name,
        can_teach = false, can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz over space', '')).id;
  p := (public.create_general_project('Zz over open', '', null, null, null, null, s)).id;
  pl := (public.create_general_project('Zz over planned', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role)
    select s, u[k], 'member' from generate_series(2, 5) k;
  insert into public.general_members(project_id, user_id, role)
    select q, u[k], (case when k = 5 then 'coordinator' else 'member' end)::public.general_role
      from generate_series(2, 5) k, unnest(array[p, pl]) q;
  perform pg_temp.act_as(u[1]);
  perform public.set_general_task_flow(p, 'open');
  perform pg_temp.service();
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[3], 960), (s, u[4], 960);
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (p, 'Zz over held', 'released', now(), st, du, u[1], 900) returning id into x;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (x, p, u[3], u[1]);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (p, 'Zz over target', 'released', now(), st, du, u[1], 180) returning id into t;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by)
    values (p, 'Zz over no estimate', 'released', now(), st, du, u[1]) returning id into nt;
  perform set_config('collabify.estimate_write', 'off', true);
  perform pg_temp.commit_checks();

  -- A Member can't load Ben, who has 1 h left this week.
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse_at_commit('member over capacity refused',
    format('select public.create_work_open_task(%L, %L, %L, %L, %L, null, null, %L, %L::uuid[], null, 180)',
      p, 'Zz over new', '', st, du, 'task', array[u[3]]),
    'Ben has no room this week. Pick someone else or ask a project manager.');
  perform pg_temp.service();
  perform pg_temp.check('refused task not saved',
    not exists (select 1 from public.general_tasks where project_id = p and title = 'Zz over new'));

  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse_at_commit('member set holders refused',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t, array[u[3]]),
    'Ben has no room this week.');
  perform pg_temp.refuse_at_commit('member multi-holder refused whole',
    format('select public.set_general_task_holders(%L, %L::uuid[])', t, array[u[4], u[3]]),
    'Ben has no room this week.');
  perform pg_temp.service();
  perform pg_temp.check('holders unchanged after refusal',
    not exists (select 1 from public.general_task_assignees where task_id = t));

  -- Cy has room; a Member may add Cy.
  perform pg_temp.act_as(u[2]);
  perform public.set_general_task_holders(t, array[u[4]]);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  perform pg_temp.check('member adds holder with room',
    exists (select 1 from public.general_task_assignees where task_id = t and user_id = u[4]));

  -- Picking yourself is allowed even when full.
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[2], 60);
  perform pg_temp.act_as(u[2]);
  perform public.set_general_task_holders(t, array[u[4], u[2]]);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  perform pg_temp.check('member picks self over capacity',
    exists (select 1 from public.general_task_assignees where task_id = t and user_id = u[2]));

  -- A coordinator may assign over capacity.
  perform pg_temp.act_as(u[5]);
  perform public.set_general_task_holders(t, array[u[3]]);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  perform pg_temp.check('planner over capacity allowed',
    exists (select 1 from public.general_task_assignees where task_id = t and user_id = u[3]));

  -- No estimate, or no weekly hours: nothing to check.
  perform pg_temp.act_as(u[2]);
  perform public.set_general_task_holders(nt, array[u[3]]);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  delete from public.general_space_capacity where space_id = s and user_id = u[3];
  perform pg_temp.act_as(u[2]);
  perform public.set_general_task_holders(t, array[u[3], u[4]]);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  perform pg_temp.check('unknown never blocks',
    exists (select 1 from public.general_task_assignees where task_id = nt and user_id = u[3])
    and exists (select 1 from public.general_task_assignees where task_id = t and user_id = u[3]));
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[3], 960);

  -- A Planned project's holders are not checked.
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (pl, 'Zz over planned task', 'released', now(), st, du, u[1], 600) returning id into lt;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (lt, pl, u[3], u[2]);
  perform pg_temp.commit_checks();
  perform pg_temp.check('planned project untouched',
    exists (select 1 from public.general_task_assignees where task_id = lt and user_id = u[3]));

  -- The wrapper saves the estimate with a history row.
  perform pg_temp.act_as(u[2]);
  t2 := public.create_work_open_task(p, 'Zz over with estimate', '', st, du, null, null, 'task', array[u[4]], null, 90);
  perform pg_temp.commit_checks();
  perform pg_temp.service();
  perform pg_temp.check('wrapper sets estimate',
    (select estimated_minutes = 90 from public.general_tasks where id = t2)
    and exists (select 1 from public.general_task_events where task_id = t2 and kind = 'updated'
                 and detail ->> 'estimate_to' = '90' and actor_id = u[2]));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('wrapper refuses a bad estimate',
    format('select public.create_work_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[], null, 0)',
      p, 'Zz over zero', '', 'task', '{}'::uuid[]),
    'Estimates run between 1 minute and 1000 hours.');
  perform pg_temp.service();
end $$;

------------------------------------------------------------ phase 2: workload tab reads
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid()];
  -- 1 space pm, 2 pm of project A only, 3 Ben (A and private B), 4 Cy (A), 5 space coordinator
  s uuid; a uuid; b uuid; ta uuid; tb uuid; tu uuid;
  v_anchor date := (now() at time zone 'Asia/Manila')::date
    + case extract(isodow from (now() at time zone 'Asia/Manila')::date)::int when 6 then 2 when 7 then 1 else 0 end;
  v_mon date; v_fri date; st timestamptz; du timestamptz;
begin
  v_mon := v_anchor - (extract(isodow from v_anchor)::int - 1);
  v_fri := v_mon + 4;
  st := (v_mon + time '09:00') at time zone 'Asia/Manila';
  du := (v_fri + time '17:00') at time zone 'Asia/Manila';
  for k in 1..5 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-tab-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-tab-'||k||'@example.test', 'Tab', k::text, 'member', 'active', false, k in (1, 2))
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz tab space', '')).id;
  b := (public.create_general_project('Zz tab private B', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'member'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'coordinator');
  insert into public.general_projects(name, space_id, created_by) values ('Zz tab A', s, u[2]) returning id into a;
  insert into public.general_members(project_id, user_id, role) values
    (a, u[2], 'pm'), (a, u[3], 'member'), (a, u[4], 'member'), (b, u[3], 'member')
    on conflict (project_id, user_id) do update set role = excluded.role;
  update public.general_projects set visibility = 'private' where id = b;
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[3], 960);
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (a, 'Zz tab A work', 'released', now(), st, du, u[2], 300) returning id into ta;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by, estimated_minutes)
    values (b, 'Zz tab B secret', 'released', now(), st, du, u[1], 360) returning id into tb;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, starts_at, due_at, created_by)
    values (a, 'Zz tab A unestimated', 'released', now(), st, du, u[2]) returning id into tu;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (ta, a, u[3], u[2]), (tb, b, u[3], u[1]), (tu, a, u[3], u[2]), (tu, a, u[4], u[2]);

  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('person tasks for planner',
    (select array_agg(title order by title) from public.general_space_person_tasks(s, u[3], v_mon, v_fri))
      = array['Zz tab A unestimated', 'Zz tab A work', 'Zz tab B secret']
    and (select minutes from public.general_space_person_tasks(s, u[3], v_mon, v_fri) where title = 'Zz tab A work') = 300
    and (select unestimated from public.general_space_person_tasks(s, u[3], v_mon, v_fri) where title = 'Zz tab A unestimated'));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('tab tasks hidden outside reads',
    (select array_agg(title order by title) from public.general_space_person_tasks(s, u[3], v_mon, v_fri))
      = array['Zz tab A unestimated', 'Zz tab A work']);
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('coordinator folds a private project',
    not exists (select 1 from public.general_space_person_tasks(s, u[3], v_mon, v_fri) where project_id = b));
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('member own tasks',
    (select count(*) from public.general_space_person_tasks(s, u[3], v_mon, v_fri)) = 3);
  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('member refused for others',
    format('select * from public.general_space_person_tasks(%L, %L, %L, %L)', s, u[3], v_mon, v_fri),
    'You can''t see this person''s workload.');
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('summary distinct',
    (select unestimated_tasks from public.general_space_workload_summary(s, v_mon, v_fri)) = 1
    and (select people_without_hours from public.general_space_workload_summary(s, v_mon, v_fri)) = 4);
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('summary no hours',
    (select unestimated_tasks from public.general_space_workload_summary(s, v_mon, v_fri)) = 1
    and (select people_without_hours from public.general_space_workload_summary(s, v_mon, v_fri)) = 1);
  perform pg_temp.service();
end $$;

------------------------------------------------------------ phase 3: timer and estimate accuracy
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 Ann (times work), 3 Bo (shares tasks with Ann), 4 Cy (plain member)
  s uuid; p uuid; ta uuid; tb uuid; tc uuid; td uuid; x uuid;
  v_day date := ((now() - interval '90 minutes') at time zone 'Asia/Manila')::date;
  m int;
begin
  for k in 1..4 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-timer-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-timer-'||k||'@example.test', 'Timer', k::text, 'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz timer space', '')).id;
  p := (public.create_general_project('Zz timer project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'member'), (s, u[3], 'member'), (s, u[4], 'member');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'member'), (p, u[3], 'member'), (p, u[4], 'member');
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz timer A', 'released', now(), u[1]) returning id into ta;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz timer B', 'released', now(), u[1]) returning id into tb;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz timer C', 'released', now(), u[1]) returning id into tc;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz timer D', 'released', now(), u[1]) returning id into td;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (ta, p, u[2], u[1]), (tb, p, u[2], u[1]), (tc, p, u[2], u[1]), (td, p, u[2], u[1]);

  -- Start, run 90 minutes, stop.
  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(ta);
  perform pg_temp.service();
  update public.general_task_timers set started_at = now() - interval '90 minutes' where user_id = u[2];
  perform pg_temp.act_as(u[2]);
  m := public.stop_work_task_timer(ta);
  perform pg_temp.service();
  perform pg_temp.check('start and stop logs',
    m = 90
    and (select count(*) = 1 from public.general_task_logs where task_id = ta and user_id = u[2])
    and (select minutes = 90 and logged_on = v_day and note = ''
           from public.general_task_logs where task_id = ta and user_id = u[2])
    and not exists (select 1 from public.general_task_timers where user_id = u[2]));

  -- Starting B while A runs logs A.
  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(ta);
  perform pg_temp.service();
  update public.general_task_timers set started_at = now() - interval '30 minutes' where user_id = u[2];
  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(tb);
  perform pg_temp.service();
  perform pg_temp.check('one timer per person',
    (select count(*) = 2 from public.general_task_logs where task_id = ta and user_id = u[2])
    and exists (select 1 from public.general_task_logs where task_id = ta and minutes = 30)
    and (select task_id = tb from public.general_task_timers where user_id = u[2])
    and (select count(*) = 1 from public.general_task_timers where user_id = u[2]));

  update public.general_task_timers set started_at = now() - interval '5 minutes' where user_id = u[2];
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('start again same task keeps start',
    public.start_work_task_timer(tb) = now() - interval '5 minutes'
    and not exists (select 1 from public.general_task_logs where task_id = tb));
  perform public.cancel_work_task_timer(tb);

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('non-holder refused',
    format('select public.start_work_task_timer(%L)', ta), 'Only the task''s holder can time it.');

  -- Past 8 hours, Stop asks; a confirmed time logs.
  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(tc);
  perform pg_temp.service();
  update public.general_task_timers set started_at = now() - interval '10 hours' where user_id = u[2];
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('stop past 8 hours asks',
    format('select public.stop_work_task_timer(%L)', tc), 'This timer ran past 8 hours.');
  perform pg_temp.check('long timer kept',
    exists (select 1 from public.general_task_timers where user_id = u[2] and task_id = tc));
  perform pg_temp.refuse('confirmed time in range',
    format('select public.stop_work_task_timer(%L, 0)', tc), 'Log between 1 minute and 24 hours.');
  m := public.stop_work_task_timer(tc, 480);
  perform pg_temp.service();
  perform pg_temp.check('confirmed long timer logs',
    m = 480 and (select sum(minutes) = 480 from public.general_task_logs where task_id = tc)
    and not exists (select 1 from public.general_task_timers where user_id = u[2]));

  -- Switching from a 10-hour timer logs 8 hours.
  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(td);
  perform pg_temp.service();
  update public.general_task_timers set started_at = now() - interval '10 hours' where user_id = u[2];
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('switch past 8 hours asks',
    format('select public.start_work_task_timer(%L)', ta), 'This timer ran past 8 hours.');
  perform pg_temp.service();
  perform pg_temp.check('switch past 8 hours keeps the timer',
    exists (select 1 from public.general_task_timers where user_id = u[2] and task_id = td)
    and not exists (select 1 from public.general_task_logs where task_id = td));
  perform pg_temp.act_as(u[2]);
  perform public.stop_work_task_timer(td, 480);
  perform public.start_work_task_timer(ta);
  perform pg_temp.service();
  perform pg_temp.check('switch after confirming',
    (select sum(minutes) = 480 from public.general_task_logs where task_id = td)
    and exists (select 1 from public.general_task_timers where user_id = u[2] and task_id = ta));

  -- A stale view of another task can't stop or discard the running timer.
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('stop refuses another task',
    format('select public.stop_work_task_timer(%L)', tb), 'The timer moved to another task.');
  perform pg_temp.refuse('discard refuses another task',
    format('select public.cancel_work_task_timer(%L)', tb), 'The timer moved to another task.');
  perform pg_temp.service();
  perform pg_temp.check('stale stop and discard keep the timer',
    exists (select 1 from public.general_task_timers where user_id = u[2] and task_id = ta)
    and (select count(*) = 2 from public.general_task_logs where task_id = ta));

  -- Losing the task while the timer runs: nothing logs and the timer clears.
  delete from public.general_task_assignees where task_id = ta and user_id = u[2];
  perform pg_temp.act_as(u[2]);
  m := public.stop_work_task_timer(ta);
  perform pg_temp.service();
  perform pg_temp.check('stop after losing the task',
    m = 0
    and (select count(*) = 2 from public.general_task_logs where task_id = ta)
    and not exists (select 1 from public.general_task_timers where user_id = u[2]));

  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(tb);
  perform public.stop_work_task_timer(tb);
  perform pg_temp.refuse('second stop logs nothing',
    format('select public.stop_work_task_timer(%L)', tb), 'No timer is running.');
  perform pg_temp.service();
  perform pg_temp.check('one log from the first stop',
    (select count(*) = 1 from public.general_task_logs where task_id = tb));

  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(tb);
  perform public.cancel_work_task_timer(tb);
  perform pg_temp.service();
  perform pg_temp.check('cancel logs nothing',
    (select count(*) = 1 from public.general_task_logs where task_id = tb)
    and not exists (select 1 from public.general_task_timers where user_id = u[2]));

  perform pg_temp.act_as(u[2]);
  perform public.start_work_task_timer(tb);
  perform pg_temp.check('timer row own',
    (select count(*) = 1 from public.general_task_timers));
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('timer row own only',
    (select count(*) = 0 from public.general_task_timers));
  perform pg_temp.refuse('no direct timer writes',
    format('insert into public.general_task_timers(user_id, task_id, project_id) values (%L, %L, %L)', u[4], tb, p),
    'permission denied');
  perform pg_temp.act_as(u[2]);
  perform public.cancel_work_task_timer(tb);

  -- Estimate accuracy: Done tasks with an estimate and the person's own logs.
  perform pg_temp.service();
  perform set_config('collabify.estimate_write', 'on', true);
  for k in 1..4 loop
    insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, status, estimated_minutes)
      values (p, 'Zz acc solo '||k, 'released', now(), u[1], 'done', 60) returning id into x;
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (x, p, u[2], u[1]);
    insert into public.general_task_logs(task_id, project_id, user_id, minutes) values (x, p, u[2], 72);
  end loop;
  -- Shared tasks: 120 minutes over two holders counts 60 for each.
  for k in 1..5 loop
    insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, status, estimated_minutes)
      values (p, 'Zz acc shared '||k, 'released', now(), u[1], 'done', 120) returning id into x;
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
      (x, p, u[2], u[1]), (x, p, u[3], u[1]);
    insert into public.general_task_logs(task_id, project_id, user_id, minutes) values (x, p, u[3], 72);
  end loop;
  perform set_config('collabify.estimate_write', 'off', true);

  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('accuracy needs five',
    not exists (select 1 from public.general_space_estimate_accuracy(s) where user_id = u[2]));
  perform pg_temp.service();
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, status, estimated_minutes)
    values (p, 'Zz acc solo 5', 'released', now(), u[1], 'done', 60) returning id into x;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (x, p, u[2], u[1]);
  insert into public.general_task_logs(task_id, project_id, user_id, minutes) values (x, p, u[2], 72);
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('accuracy at five',
    (select ratio = 1.2 and tasks = 5 from public.general_space_estimate_accuracy(s) where user_id = u[2]));
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('accuracy shared estimate',
    (select ratio = 1.2 and tasks = 5 from public.general_space_estimate_accuracy(s, array[u[3]])));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('planner reads accuracy',
    (select count(*) = 2 from public.general_space_estimate_accuracy(s)));
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('accuracy hidden from others',
    not exists (select 1 from public.general_space_estimate_accuracy(s, array[u[2], u[3]])));
  perform pg_temp.service();
end $$;

rollback;
