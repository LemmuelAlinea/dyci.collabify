-- supabase/tests/work-leave.test.sql
-- Leave and cover: away days recorded as a range by the person or a space
-- planner, leaves as runs of weekdays, away ranges for the space, the impact
-- check and its notices, and temporary cover. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/work-leave.test.sql
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

-- A fixed Monday well in the future, so weekday maths is predictable.
create or replace function pg_temp.mon() returns date language sql as $$
  select ((now() at time zone 'Asia/Manila')::date + 28)
         - (extract(isodow from (now() at time zone 'Asia/Manila')::date + 28)::int - 1);
$$;

------------------------------------------------------------ recording leave
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 space A pm, 2 space A coordinator, 3 Ann (A and B), 4 Bo (A), 5 space B pm, 6 outsider
  a uuid; b uuid; m date := pg_temp.mon(); n int;
begin
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-leave-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-leave-'||k||'@example.test', 'Leave', k::text, 'member', 'active', false, k in (1, 5, 6))
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  a := (public.create_general_space('Zz leave A', '')).id;
  perform pg_temp.act_as(u[5]);
  b := (public.create_general_space('Zz leave B', '')).id;
  perform pg_temp.act_as(u[6]);
  perform public.create_general_space('Zz leave outside', '');
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (a, u[2], 'coordinator'), (a, u[3], 'member'), (a, u[4], 'member'), (b, u[3], 'member');

  perform pg_temp.act_as(u[3]);
  n := public.save_time_off_range(u[3], m, m + 4, null);
  perform pg_temp.check('person saves own range',
    n = 5 and (select count(*) = 5 from public.user_time_off where user_id = u[3] and added_by is null));
  n := public.save_time_off_range(u[3], m + 11, m + 14, 120);
  perform pg_temp.check('weekend skipped',
    n = 2 and (select count(*) = 2 from public.user_time_off where user_id = u[3] and off_on between m + 11 and m + 14)
    and (select bool_and(minutes = 120) from public.user_time_off where user_id = u[3] and off_on between m + 11 and m + 14));

  perform pg_temp.act_as(u[2]);
  n := public.save_time_off_range(u[4], m, m + 2, null);
  perform pg_temp.service();
  perform pg_temp.check('planner saves range',
    n = 3 and (select bool_and(added_by = u[2]) from public.user_time_off where user_id = u[4]));

  perform pg_temp.act_as(u[5]);
  perform public.save_time_off_range(u[3], m + 21, m + 21, null);
  perform pg_temp.service();
  perform pg_temp.check('planner from other space',
    exists (select 1 from public.user_time_off where user_id = u[3] and off_on = m + 21 and added_by = u[5]));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('member refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m), 'You can''t mark this person away.');
  perform pg_temp.act_as(u[6]);
  perform pg_temp.refuse('outsider planner refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m), 'You can''t mark this person away.');
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('bad range refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m + 3, m), 'Choose a start date on or before the end date.');
  perform pg_temp.refuse('long range refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m + 120), 'Choose 60 days or fewer.');

  -- Planners remove only what planners added.
  perform pg_temp.act_as(u[4]);
  perform public.save_time_off_range(u[4], m + 7 + 2, m + 7 + 2, null);
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[4], m + 7, m + 7 + 1, null);
  perform public.save_time_off_range(u[4], m + 7 + 3, m + 7 + 4, null);
  n := public.remove_time_off_range(u[4], m + 7, m + 7 + 4);
  perform pg_temp.service();
  perform pg_temp.check('planner removes only planner rows',
    n = 4 and (select array_agg(off_on) = array[m + 9] from public.user_time_off
                where user_id = u[4] and off_on between m + 7 and m + 11));
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[4], m + 9, m + 9, 60);
  n := public.remove_time_off_range(u[4], m + 9, m + 9);
  perform pg_temp.service();
  perform pg_temp.check('planner overwrite keeps person row',
    n = 0 and (select added_by is null and minutes is null from public.user_time_off where user_id = u[4] and off_on = m + 9));
  perform pg_temp.act_as(u[4]);
  n := public.remove_time_off_range(u[4], m, m + 13);
  perform pg_temp.check('person removes any',
    n = 4 and not exists (select 1 from public.user_time_off where user_id = u[4]));

  -- Runs.
  perform pg_temp.service();
  delete from public.user_time_off where user_id = u[3];
  insert into public.user_time_off(user_id, off_on) values (u[3], m + 3), (u[3], m + 4), (u[3], m + 7);
  perform pg_temp.check('runs join over weekend',
    (select count(*) = 1 from public.work_leave_runs(u[3], m))
    and (select first_day = m + 3 and last_day = m + 7 and not part_day from public.work_leave_runs(u[3], m)));
  insert into public.user_time_off(user_id, off_on, minutes) values (u[3], m + 9, 60);
  perform pg_temp.check('runs split by a weekday',
    (select count(*) = 2 from public.work_leave_runs(u[3], m))
    and (select part_day from public.work_leave_runs(u[3], m) where first_day = m + 9));
  perform pg_temp.check('runs before a date dropped',
    (select count(*) = 1 from public.work_leave_runs(u[3], m + 8)));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('away ranges readable in space',
    (select count(*) = 2 from public.space_away_ranges(a) where user_id = u[3]));
  perform pg_temp.check('own rows policy unchanged',
    not exists (select 1 from public.user_time_off where user_id = u[3]));
  perform pg_temp.act_as(u[6]);
  perform pg_temp.check('outside space sees none',
    not exists (select 1 from public.space_away_ranges(a)));
  perform pg_temp.service();
end $$;

------------------------------------------------------------ impact check and notices
create or replace function pg_temp.at(p_day date) returns timestamptz language sql as $$
  select (p_day + time '12:00') at time zone 'Asia/Manila';
$$;
create or replace function pg_temp.notices(p_user uuid, p_project uuid) returns int language sql as $$
  select count(*)::int from public.notifications
   where user_id = p_user and type = 'leave_impact' and general_project_id = p_project;
$$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 pm (space S, project P), 2 coordinator (pref off), 3 Ann, 4 Bo, 5 pm of space B / project Q, 6 coordinator
  s uuid; b uuid; p uuid; q uuid; m date := pg_temp.mon();
  t_due uuid; t_fit uuid; t_block uuid; t_dep uuid; t_free uuid; t_done uuid; t_q uuid; t_new uuid; t_today uuid;
  d date := (now() at time zone 'Asia/Manila')::date;
  js jsonb;
begin
  d := d + case extract(isodow from d)::int when 6 then 2 when 7 then 1 else 0 end;
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-impact-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-impact-'||k||'@example.test', 'Impact', k::text, 'member', 'active', false, k in (1, 5))
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
    insert into public.notification_prefs(user_id) values (u[k]) on conflict do nothing;
  end loop;
  update public.notification_prefs set leave_and_cover = false where user_id = u[2];
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz impact S', '')).id;
  p := (public.create_general_project('Zz impact P', '', null, null, null, null, s)).id;
  perform pg_temp.act_as(u[5]);
  b := (public.create_general_space('Zz impact B', '')).id;
  q := (public.create_general_project('Zz impact Q', '', null, null, null, null, b)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[6], 'coordinator'), (b, u[3], 'member');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[6], 'coordinator'), (q, u[3], 'member');
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[3], 960);

  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz due during', 'released', now(), u[1], pg_temp.at(m + 1), 60) returning id into t_due;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz too big', 'released', now(), u[1], pg_temp.at(m + 4), 9000) returning id into t_fit;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz blocker', 'released', now(), u[1], pg_temp.at(m - 3), 60) returning id into t_block;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz waits', 'released', now(), u[1]) returning id into t_dep;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz no date', 'released', now(), u[1]) returning id into t_free;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes, status)
    values (p, 'Zz finished', 'released', now(), u[1], pg_temp.at(m + 1), 60, 'done') returning id into t_done;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (q, 'Zz other space', 'released', now(), u[5], pg_temp.at(m + 1), 60) returning id into t_q;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (t_due, p, u[3], u[1]), (t_fit, p, u[3], u[1]), (t_block, p, u[3], u[1]), (t_dep, p, u[4], u[1]),
    (t_free, p, u[3], u[1]), (t_done, p, u[3], u[1]), (t_q, q, u[3], u[5]);
  insert into public.general_task_dependencies(task_id, depends_on_id, project_id) values (t_dep, t_block, p);

  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m, m + 2, null);
  perform pg_temp.service();

  perform pg_temp.check('due during leave flagged',
    (select status = 'due_during' from public.work_leave_task_status(u[3], m, m + 2) where task_id = t_due));
  perform pg_temp.check('wont fit flagged',
    (select status = 'wont_fit' and short_minutes > 0 and remaining_minutes = 9000
       from public.work_leave_task_status(u[3], m, m + 2) where task_id = t_fit));
  perform pg_temp.check('blocks flagged',
    (select status = 'blocks' from public.work_leave_task_status(u[3], m, m + 2) where task_id = t_block));
  perform pg_temp.check('no due date fine',
    (select status = 'fine' and no_estimate from public.work_leave_task_status(u[3], m, m + 2) where task_id = t_free));
  perform pg_temp.check('done task left out',
    not exists (select 1 from public.work_leave_task_status(u[3], m, m + 2) where task_id = t_done));

  perform pg_temp.check('notice once',
    pg_temp.notices(u[1], p) = 1 and pg_temp.notices(u[6], p) = 1 and pg_temp.notices(u[3], p) = 0
    and (select title from public.notifications where user_id = u[1] and type = 'leave_impact')
          like 'Impact 3 is away %'
    and (select preview from public.notifications where user_id = u[1] and type = 'leave_impact')
          = '3 tasks in Zz impact P need a look.');
  perform pg_temp.check('pref off respected', pg_temp.notices(u[2], p) = 0);
  perform pg_temp.check('other space notified', pg_temp.notices(u[5], q) = 1 and pg_temp.notices(u[1], q) = 0);

  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m + 3, m + 3, null);
  perform pg_temp.service();
  perform pg_temp.check('extend without change sends nothing',
    pg_temp.notices(u[1], p) = 1
    and (select last_day = m + 3 from public.general_leave_notices where user_id = u[3] and project_id = p));

  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz next week', 'released', now(), u[1], pg_temp.at(m + 7), 60) returning id into t_new;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_new, p, u[3], u[1]);
  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m + 4, m + 7, null);
  perform pg_temp.service();
  perform pg_temp.check('extend with change notifies',
    pg_temp.notices(u[1], p) = 2
    and (select count(*) = 1 from public.general_leave_notices where user_id = u[3] and project_id = p));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('review planners only',
    format('select * from public.general_project_leaves(%L)', p), 'Only the project manager and coordinators can review leave.');
  perform pg_temp.check('notice rows hidden from members',
    not exists (select 1 from public.general_leave_notices));
  perform pg_temp.act_as(u[1]);
  select tasks into js from public.general_project_leaves(p) where user_id = u[3];
  perform pg_temp.check('review lists flagged first',
    jsonb_array_length(js) = 5
    and js -> 0 ->> 'status' <> 'fine'
    and js -> 4 ->> 'status' = 'fine'
    and js -> 4 ->> 'title' = 'Zz no date'
    and (select bool_or(e ->> 'status' = 'blocks' and e -> 'blocks' ->> 0 = 'Zz waits') from jsonb_array_elements(js) e));

  perform pg_temp.act_as(u[3]);
  perform public.remove_time_off_range(u[3], m, m + 7);
  perform pg_temp.service();
  perform pg_temp.check('leave removed clears row',
    not exists (select 1 from public.general_leave_notices where user_id = u[3]));

  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz today', 'released', now(), u[1], pg_temp.at(d), 60) returning id into t_today;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_today, p, u[3], u[1]);
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[3], d, d, null);
  perform pg_temp.service();
  perform pg_temp.check('leave already started',
    (select first_day = d and t_today = any (flagged) from public.general_leave_notices where user_id = u[3] and project_id = p));
end $$;

------------------------------------------------------------ cover and reminders
create or replace function pg_temp.holders(p_task uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(user_id order by user_id), '{}') from public.general_task_assignees where task_id = p_task;
$$;
create or replace function pg_temp.sent(p_user uuid, p_type text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and type::text = p_type;
$$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 coordinator, 3 Ann (away), 4 Keneth (cover), 5 Bo
  s uuid; p uuid; o uuid; m date := pg_temp.mon();
  d date := (now() at time zone 'Asia/Manila')::date;
  tp uuid; t_open uuid; tb uuid; tq uuid; tr uuid; tc uuid; t_end uuid;
  c_p uuid; c_o uuid; c_q uuid; c_r uuid; c_c uuid;
begin
  d := d + case extract(isodow from d)::int when 6 then 2 when 7 then 1 else 0 end;
  for k in 1..5 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-cover-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-cover-'||k||'@example.test', 'Cover', k::text, 'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
    insert into public.notification_prefs(user_id) values (u[k]) on conflict do nothing;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz cover S', '')).id;
  p := (public.create_general_project('Zz cover planned', '', null, null, null, null, s)).id;
  o := (public.create_general_project('Zz cover open', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  update public.general_projects set task_flow = 'open' where id = o;
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'member');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'member'),
    (o, u[2], 'coordinator'), (o, u[3], 'member'), (o, u[4], 'member');
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz planned work', 'released', now(), u[1]) returning id into tp;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (o, 'Zz open work', 'released', now(), u[1]) returning id into t_open;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz Bo work', 'released', now(), u[1]) returning id into tb;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz finishing', 'released', now(), u[1]) returning id into tq;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz remind', 'released', now(), u[1]) returning id into tr;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz moving', 'released', now(), u[1]) returning id into tc;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (tp, p, u[3], u[1]), (t_open, o, u[3], u[1]), (tb, p, u[5], u[1]), (tq, p, u[3], u[1]),
    (tr, p, u[3], u[1]), (tc, p, u[3], u[1]);
  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m, m + 2, null);

  perform pg_temp.act_as(u[1]);
  c_p := public.start_work_cover(tp, u[3], u[4]);
  perform pg_temp.service();
  perform pg_temp.check('cover swaps holders',
    pg_temp.holders(tp) = array[u[4]]
    and (select until = m + 2 and closed_at is null and away_id = u[3] and cover_id = u[4]
           from public.general_task_covers where id = c_p)
    and exists (select 1 from public.general_task_events where task_id = tp and kind = 'updated'
                 and detail ->> 'cover' = 'started' and actor_id = u[1]));

  perform pg_temp.act_as(u[2]);
  c_o := public.start_work_cover(t_open, u[3], u[4]);
  perform pg_temp.service();
  perform pg_temp.check('cover in open flow', pg_temp.holders(t_open) = array[u[4]]);

  perform pg_temp.act_as(u[5]);
  perform pg_temp.refuse('member cannot cover',
    format('select public.start_work_cover(%L, %L, %L)', tq, u[3], u[4]),
    'Only the project manager and coordinators can arrange cover.');
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('no leave refused',
    format('select public.start_work_cover(%L, %L, %L)', tb, u[5], u[4]), 'has no leave coming up.');
  perform pg_temp.refuse('one open cover per task',
    format('select public.start_work_cover(%L, %L, %L)', tp, u[4], u[5]), 'This task is already covered.');

  perform pg_temp.act_as(u[4]);
  perform public.hand_back_work_cover(c_p);
  perform pg_temp.service();
  perform pg_temp.check('hand back restores',
    pg_temp.holders(tp) = array[u[3]]
    and (select closed_how = 'handed_back' and closed_at is not null from public.general_task_covers where id = c_p)
    and exists (select 1 from public.general_task_events where task_id = tp and detail ->> 'cover' = 'handed_back'));

  perform pg_temp.act_as(u[1]);
  perform public.keep_work_cover(c_o);
  perform pg_temp.service();
  perform pg_temp.check('keep closes',
    pg_temp.holders(t_open) = array[u[4]]
    and (select closed_how = 'kept' from public.general_task_covers where id = c_o));
  perform pg_temp.act_as(u[5]);
  perform pg_temp.refuse('others cannot hand back',
    format('select public.hand_back_work_cover(%L)', c_o), 'This cover has already ended.');

  perform pg_temp.act_as(u[1]);
  c_q := public.start_work_cover(tq, u[3], u[4]);
  perform pg_temp.service();
  update public.general_tasks set status = 'done' where id = tq;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('hand back refused when done',
    format('select public.hand_back_work_cover(%L)', c_q), 'Reopen it before changing who holds it.');

  -- Leave changes move the cover's end.
  c_c := public.start_work_cover(tc, u[3], u[4]);
  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m + 3, m + 4, null);
  perform pg_temp.service();
  perform pg_temp.check('extended leave moves until',
    (select until = m + 4 and reminded_on is null from public.general_task_covers where id = c_c));
  perform pg_temp.act_as(u[3]);
  perform public.remove_time_off_range(u[3], m, m + 4);
  perform pg_temp.service();
  perform pg_temp.check('cancelled leave reminds hand back',
    (select until = m + 4 and closed_at is null from public.general_task_covers where id = c_c));

  -- Reminders.
  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], m, m, null);
  perform pg_temp.act_as(u[1]);
  c_r := public.start_work_cover(tr, u[3], u[4]);
  perform pg_temp.service();
  update public.general_task_covers set until = d - 1 where id in (c_r, c_c);
  perform public.send_leave_reminders();
  perform pg_temp.check('done closes cover',
    (select closed_how = 'dropped' from public.general_task_covers where id = c_q));
  perform pg_temp.check('reminder after leave',
    pg_temp.sent(u[4], 'cover_hand_back') = 2 and pg_temp.sent(u[1], 'cover_hand_back') = 2
    and pg_temp.sent(u[2], 'cover_hand_back') = 0
    and (select reminded_on = d from public.general_task_covers where id = c_r)
    and (select title from public.notifications where user_id = u[4] and type = 'cover_hand_back'
          and general_task_id = tr) = 'Cover 3 is back'
    and (select preview from public.notifications where user_id = u[4] and type = 'cover_hand_back'
          and general_task_id = tr) = 'Hand Zz remind back, or keep it with Cover 4.');
  perform public.send_leave_reminders();
  perform pg_temp.check('reminder sent once', pg_temp.sent(u[4], 'cover_hand_back') = 2);

  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at)
    values (p, 'Zz ends today', 'released', now(), u[1], pg_temp.at(d)) returning id into t_end;
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_end, p, u[3], u[1]);
  perform pg_temp.act_as(u[3]);
  perform public.save_time_off_range(u[3], d, d, null);
  perform pg_temp.service();
  perform public.send_leave_reminders();
  perform public.send_leave_reminders();
  perform pg_temp.check('one reminder per last day',
    pg_temp.sent(u[1], 'leave_ending') = 1 and pg_temp.sent(u[2], 'leave_ending') = 0
    and (select ended_reminded_on = d from public.general_leave_notices where user_id = u[3] and project_id = p
           and first_day = d)
    and (select title from public.notifications where user_id = u[1] and type = 'leave_ending') = 'Cover 3''s leave ends today');

  -- Review fixes.
  declare
    t_stale uuid; t_ar uuid; ar uuid; c_s uuid; c_a uuid; ok boolean;
  begin
    insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
      values (p, 'Zz stale', 'released', now(), u[1]) returning id into t_stale;
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_stale, p, u[3], u[1]);
    perform pg_temp.act_as(u[1]);
    c_s := public.start_work_cover(t_stale, u[3], u[4]);
    perform pg_temp.service();
    delete from public.general_task_assignees where task_id = t_stale and user_id = u[4];
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_stale, p, u[5], u[1]);
    perform pg_temp.act_as(u[4]);
    ok := public.hand_back_work_cover(c_s);
    perform pg_temp.service();
    perform pg_temp.check('stale cover not handed back',
      ok = false and pg_temp.holders(t_stale) = array[u[5]]
      and (select closed_how = 'dropped' from public.general_task_covers where id = c_s));

    perform pg_temp.act_as(u[1]);
    ar := (public.create_general_project('Zz cover archived', '', null, null, null, null, s)).id;
    perform pg_temp.service();
    insert into public.general_members(project_id, user_id, role) values (ar, u[3], 'member'), (ar, u[4], 'member');
    insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
      values (ar, 'Zz archived work', 'released', now(), u[1]) returning id into t_ar;
    insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_ar, ar, u[3], u[1]);
    perform pg_temp.act_as(u[1]);
    c_a := public.start_work_cover(t_ar, u[3], u[4]);
    perform pg_temp.service();
    update public.general_projects set archived_at = now(), archived_by = u[1] where id = ar;
    perform pg_temp.act_as(u[1]);
    perform pg_temp.refuse('archived project refuses hand back',
      format('select public.hand_back_work_cover(%L)', c_a), 'This project is archived.');
    perform pg_temp.service();
    perform public.send_leave_reminders();
    perform pg_temp.check('archived project drops cover',
      (select closed_how = 'dropped' from public.general_task_covers where id = c_a));

    perform pg_temp.act_as(u[1]);
    perform pg_temp.refuse('record cannot forge',
      format('select public.work_cover_record(%L, %L, %L, %L)', tb, u[3], u[5], d),
      'The cover could not be set up.');

    perform pg_temp.service();
    insert into public.general_members(project_id, user_id, role) values (o, u[5], 'coordinator');
    perform pg_temp.act_as(u[5]);
    perform public.save_time_off_range(u[3], m + 14, m + 14, null);
    perform pg_temp.service();
    perform pg_temp.check('project planner marks away',
      exists (select 1 from public.user_time_off where user_id = u[3] and off_on = m + 14 and added_by = u[5]));

    -- A cover lasts to the end of the leave it was made for, not the next one.
    declare
      t_two uuid; c_two uuid;
    begin
      insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
        values (p, 'Zz later leave', 'released', now(), u[1]) returning id into t_two;
      insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values (t_two, p, u[3], u[1]);
      perform pg_temp.act_as(u[1]);
      c_two := public.start_work_cover(t_two, u[3], u[4], m + 14);
      perform pg_temp.service();
      perform pg_temp.check('cover follows the leave it was made for',
        (select until = m + 14 from public.general_task_covers where id = c_two));
      perform pg_temp.act_as(u[3]);
      perform public.save_time_off_range(u[3], m + 1, m + 1, null);
      perform pg_temp.service();
      perform pg_temp.check('other leave leaves the cover alone',
        (select until = m + 14 from public.general_task_covers where id = c_two));
      perform pg_temp.act_as(u[3]);
      perform public.save_time_off_range(u[3], m + 15, m + 15, null);
      perform pg_temp.service();
      perform pg_temp.check('its own leave moves the cover',
        (select until = m + 15 from public.general_task_covers where id = c_two));
      perform pg_temp.act_as(u[1]);
      perform pg_temp.refuse('cover for a day with no leave refused',
        format('select public.start_work_cover(%L, %L, %L, %L)', tb, u[5], u[4], m + 20), 'has no leave coming up.');
    end;
  end;
end $$;

------------------------------------------------------------ phase 2: context, forecast, sprint hours
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 Ann (16 h), 3 Bo (16 h), 4 Cy (no hours), 5 Dee (member), 6 outsider
  s uuid; p uuid; m date := pg_temp.mon();
  t_big uuid; t_none uuid; t_shared uuid; sp uuid; n_id uuid; ctx jsonb; f_short int; t_par uuid; t_part uuid;
begin
  perform pg_temp.service();
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-fore-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-fore-'||k||'@example.test', 'Fore', k::text, 'member', 'active', false, k in (1, 6))
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
    insert into public.notification_prefs(user_id) values (u[k]) on conflict do nothing;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz fore S', '')).id;
  p := (public.create_general_project('Zz fore P', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'member'), (s, u[3], 'member'), (s, u[4], 'member'), (s, u[5], 'member');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'member'), (p, u[3], 'member'), (p, u[4], 'member'), (p, u[5], 'member');
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[2], 960), (s, u[3], 960);
  insert into public.general_member_skills(project_id, user_id, tag) values (p, u[3], 'auth');
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz fore big', 'released', now(), u[1], pg_temp.at(m + 4), 9000) returning id into t_big;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz fore no hours', 'released', now(), u[1], pg_temp.at(m + 4), 9000) returning id into t_none;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz fore shared', 'released', now(), u[1], pg_temp.at(m + 4), 18000) returning id into t_shared;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (t_big, p, u[2], u[1]), (t_none, p, u[4], u[1]), (t_shared, p, u[2], u[1]), (t_shared, p, u[3], u[1]);

  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('forecast for planner',
    (select count(*) = 1 and bool_and(user_id = u[2] and short_minutes > 0 and remaining_minutes = 9000)
       from public.general_task_forecast(t_big)));
  perform pg_temp.check('fits on the 40 h default', not exists (select 1 from public.general_task_forecast(t_none)));
  perform pg_temp.check('shared task split',
    (select count(*) = 2 and bool_and(remaining_minutes = 9000) from public.general_task_forecast(t_shared)));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('forecast for holder', exists (select 1 from public.general_task_forecast(t_big)));
  select short_minutes into f_short from public.general_task_forecast(t_big);
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('forecast co-holder sees only own',
    (select array_agg(user_id) = array[u[3]] from public.general_task_forecast(t_shared)));
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('forecast hidden from others', not exists (select 1 from public.general_task_forecast(t_big)));
  perform pg_temp.service();
  perform pg_temp.check('room helper matches status',
    (select status = 'wont_fit' and short_minutes = f_short
       from public.work_leave_task_status(u[2], m - 7, m - 7) where task_id = t_big));

  -- A broken-down task's work is its subtasks': neither check judges the parent's own estimate.
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, 'Zz fore parent', 'released', now(), u[1], pg_temp.at(m + 4), 9000) returning id into t_par;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, due_at, estimated_minutes)
    values (p, t_par, 'Zz fore part', 'released', now(), u[1], pg_temp.at(m + 4), 60) returning id into t_part;
  perform set_config('collabify.estimate_write', 'off', true);
  insert into public.general_task_assignees(task_id, project_id, user_id, assigned_by) values
    (t_par, p, u[2], u[1]), (t_part, p, u[3], u[1]);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('no forecast on a broken-down task', not exists (select 1 from public.general_task_forecast(t_par)));
  perform pg_temp.service();
  perform pg_temp.check('leave check skips a broken-down task',
    not exists (select 1 from public.work_leave_task_status(u[2], m - 7, m - 7) where task_id = t_par)
    and exists (select 1 from public.work_leave_task_status(u[3], m - 7, m - 7) where task_id = t_part));
  delete from public.general_task_assignees where task_id in (t_par, t_part);
  delete from public.general_tasks where id = t_part;
  delete from public.general_tasks where id = t_par;

  -- Suggestion context.
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[2], m + 3, m + 4, null);
  perform pg_temp.act_as(u[5]);
  perform public.save_time_off_range(u[5], m + 4, m + 4, null);
  perform pg_temp.service();
  select id into n_id from public.general_leave_notices where user_id = u[2] and project_id = p;
  perform pg_temp.act_as(u[1]);
  ctx := public.general_leave_suggest_context(n_id);
  perform pg_temp.check('context lists flagged and people',
    ctx ->> 'user_id' = u[2]::text
    and (select count(*) = 2 from jsonb_array_elements(ctx -> 'tasks') e
          where e ->> 'task_id' in (t_big::text, t_shared::text) and e ->> 'status' = 'due_during')
    and not exists (select 1 from jsonb_array_elements(ctx -> 'people') e where e ->> 'user_id' = u[2]::text)
    and (select e -> 'skills' = '["auth"]'::jsonb and e ->> 'free_minutes' is not null
           from jsonb_array_elements(ctx -> 'people') e where e ->> 'user_id' = u[3]::text)
    and (select e ->> 'free_minutes' is not null from jsonb_array_elements(ctx -> 'people') e where e ->> 'user_id' = u[4]::text));
  perform pg_temp.check('context lists holders',
    (select e -> 'holders' @> to_jsonb(array[u[2]::text, u[3]::text]) and jsonb_array_length(e -> 'holders') = 2
       from jsonb_array_elements(ctx -> 'tasks') e where e ->> 'task_id' = t_shared::text));
  perform pg_temp.check('away candidate marked',
    (select (e ->> 'away')::boolean from jsonb_array_elements(ctx -> 'people') e where e ->> 'user_id' = u[5]::text)
    and not (select (e ->> 'away')::boolean from jsonb_array_elements(ctx -> 'people') e where e ->> 'user_id' = u[4]::text));
  perform pg_temp.act_as(u[5]);
  perform pg_temp.refuse('context planners only',
    format('select public.general_leave_suggest_context(%L)', n_id), 'Only the project manager and coordinators can review leave.');

  -- Sprint hours: Ann away two of the five days, one task with no holder, Cy on the 40 h default.
  perform pg_temp.service();
  insert into public.general_sprints(project_id, name, starts_on, ends_on) values (p, 'Zz sprint', m, m + 4) returning id into sp;
  update public.general_tasks set sprint_id = sp where id in (t_big, t_none);
  perform set_config('collabify.estimate_write', 'on', true);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, sprint_id)
    values (p, 'Zz fore nobody', 'released', now(), u[1], 120, sp);
  perform set_config('collabify.estimate_write', 'off', true);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('sprint hours',
    (select available_minutes = 576 + 2400 and away_minutes = 384 and planned_minutes = 18120
            and unassigned = 1 and people_without_hours = 0
       from public.general_sprint_hours(sp)));
  perform pg_temp.act_as(u[6]);
  perform pg_temp.check('sprint hours members only', not exists (select 1 from public.general_sprint_hours(sp)));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('sprint hours planners only', not exists (select 1 from public.general_sprint_hours(sp)));
  perform pg_temp.service();
end $$;

rollback;
